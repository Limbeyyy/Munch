"""Building a programme from a spreadsheet instead of a form.

A day with ten sessions is ten passes through a form, and the details -
each speaker's name, address and number - are usually already in a
spreadsheet somebody keeps. So: a template to fill in, and a reader that
turns it back into the same programme the form would have made.

The sheet is two tables, one under the other: the events, then the
sessions. Each row is one thing, and the tables are joined by id - a
session names the event it belongs to. It used to be one very wide table
with the event repeated on every session's row, which meant columns to
scroll through sideways and the same title typed ten times, with nothing
to stop the tenth disagreeing with the first.

Two files, the same shape in both. The CSV opens anywhere and survives
being emailed round an office. The Excel one adds what a CSV cannot
carry: the id column in the sessions table is a dropdown, filled from
the events typed above, so a session cannot point at an event that is
not there. Either can be filled in and sent back.

Nothing here validates a programme itself. The rows are turned into the
same payload the form sends and handed to the same serializer, so the
rules about speakers, spacing, the first session and the plan's limits
apply exactly once, in the place that already owns them.
"""
import csv
import io
import logging
from datetime import datetime

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone

logger = logging.getLogger(__name__)

#: The three tables the sheet is made of, in the order they appear.
EVENT_COLUMNS = [
    'event_id', 'event_title', 'event_date', 'venue',
    'event_starts_at', 'event_duration_minutes',
]

SESSION_COLUMNS = [
    'session_id', 'event_id', 'session_title',
    'session_starts_at', 'session_duration_minutes', 'hall',
    'speaker_name', 'speaker_email', 'speaker_phone', 'speaker_visibility',
]

TABLES = [
    ('EVENTS', EVENT_COLUMNS),
    ('SESSIONS', SESSION_COLUMNS),
]

#: How many blank rows each table is given to be filled in. Enough for a
#: long day; more can be added underneath, and the reader does not count.
ROOM_TO_FILL = {'EVENTS': 10, 'SESSIONS': 30}

#: Said once at the top rather than in a note under every column, so the
#: tables themselves are the clean thing the eye lands on.
HOW_TO = [
    'Two tables: the events, and the sessions inside them.',
    'Give every event an id - 1, 2, 3 will do - and use those ids to say '
    'which event each session belongs to.',
    'A session names its event_id.',
    'Dates and times are YYYY-MM-DD HH:MM, on the 24-hour clock: '
    '2026-09-14 14:40. They are read as the clock in the hall, so type '
    'the time the thing actually happens.',
    'The first session of an event starts when the event starts.',
    'speaker_name, speaker_email and speaker_phone are required; the email '
    'is what makes them a presenter when they sign in.',
    'speaker_visibility is private or public, and private if left blank.',
    'session_duration_minutes is 30 if left blank; an event is as long as '
    'the sessions in it.',
    'Lines beginning with # are ignored, so this guidance can stay where it is.',
]

#: One filled-in programme, so the shape is obvious before anything is typed.
EXAMPLE_ROWS = {
    'EVENTS': [
        ['1', 'National Health Workers Conference', '2026-10-02',
         'National Assembly Hall', '2026-10-02 09:00', '240'],
    ],
    'SESSIONS': [
        ['1001', '1', 'Health service delivery in federalism',
         '2026-10-02 09:00', '60', 'Hall A', 'Dr Sarita Poudel',
         'sarita.poudel@example.org', '9800000001', 'private'],
        ['1002', '1', 'Digital health records', '2026-10-02 10:15', '45',
         'Hall A', 'Bikash Shrestha', 'bikash.shrestha@example.org',
         '9800000002', 'public'],
    ],
}

#: The old shape: one very wide table, the event repeated on every
#: session's row. Sheets already filled in against it are still read, so
#: nobody is stranded halfway through one.
#: The columns, in the order the template lays them out.
COLUMNS = [
    'event_title',
    'event_date',
    'venue',
    'event_starts_at',
    'event_duration_minutes',
    'session_title',
    'session_starts_at',
    'session_duration_minutes',
    'hall',
    'speaker_name',
    'speaker_email',
    'speaker_phone',
    'speaker_visibility',
]

#: What each column is for, written into the template so the person
#: filling it in does not have to be told separately.
NOTES = {
    'event_title': 'The event this belongs to. Repeat it on every row of the event.',
    'event_date': 'YYYY-MM-DD, the day the programme runs.',
    'venue': 'Where it is held. Optional.',
    'event_starts_at': 'YYYY-MM-DD HH:MM. The first session must start at this time.',
    'event_duration_minutes': 'Optional; the sessions decide the real length.',
    'session_title': 'One row per session.',
    'session_starts_at': 'YYYY-MM-DD HH:MM.',
    'session_duration_minutes': 'How long the session runs. 30 if left blank.',
    'hall': 'Which hall. Optional.',
    'speaker_name': 'Required.',
    'speaker_email': 'Required. This is what makes them a presenter when they sign in.',
    'speaker_phone': 'Required.',
    'speaker_visibility': 'private or public. private if left blank.',
}

#: An example programme, so the shape is obvious before anything is typed.
EXAMPLE = [
    {
        'event_title': 'National Health Workers Conference',
        'event_date': '2026-10-02',
        'venue': 'National Assembly Hall',
        'event_starts_at': '2026-10-02 09:00',
        'event_duration_minutes': '240',
        'session_title': 'Health service delivery in federalism',
        'session_starts_at': '2026-10-02 09:00',
        'session_duration_minutes': '60',
        'hall': 'Hall A',
        'speaker_name': 'Dr Sarita Poudel',
        'speaker_email': 'sarita.poudel@example.org',
        'speaker_phone': '9800000001',
        'speaker_visibility': 'private',
    },
    {
        'event_title': 'National Health Workers Conference',
        'event_date': '2026-10-02',
        'venue': 'National Assembly Hall',
        'event_starts_at': '2026-10-02 09:00',
        'event_duration_minutes': '240',
        'session_title': 'Digital health records',
        'session_starts_at': '2026-10-02 10:15',
        'session_duration_minutes': '45',
        'hall': 'Hall A',
        'speaker_name': 'Bikash Shrestha',
        'speaker_email': 'bikash.shrestha@example.org',
        'speaker_phone': '9800000002',
        'speaker_visibility': 'public',
    },
]


class ImportProblem(Exception):
    """The sheet cannot be read, with the row and column at fault."""

    def __init__(self, message, *, row=None, column=None):
        super().__init__(message)
        self.row = row
        self.column = column

    def as_json(self):
        return {
            'error': str(self),
            'code': 'bad_sheet',
            'row': self.row,
            'column': self.column,
        }


def _layout():
    """The sheet, row by row, as plain values.

    One description of the layout, used to write the CSV and the workbook
    alike, so the two cannot drift apart. Each entry is a list of cells;
    the second value says what kind of row it is, which the workbook uses
    to decide what to make bold and where the dropdowns go.
    """
    rows = [(['Manch programme template'], 'title'), ([], 'blank')]
    for line in HOW_TO:
        rows.append(([f'# {line}'], 'note'))

    for name, columns in TABLES:
        rows.append(([], 'blank'))
        rows.append(([name], 'marker'))
        rows.append((list(columns), 'header'))
        for example in EXAMPLE_ROWS[name]:
            rows.append((list(example), 'example'))
        for _ in range(ROOM_TO_FILL[name]):
            rows.append(([''] * len(columns), 'empty'))
    return rows


def template_csv() -> bytes:
    """The blank template: three tables, an example in each, and how to fill it.

    The guidance is comment rows rather than a separate sheet, since a CSV
    has only one - and lines beginning with # are skipped on the way back
    in, so the file can be filled in as it stands and returned.
    """
    out = io.StringIO()
    writer = csv.writer(out)
    for cells, _kind in _layout():
        writer.writerow(cells)
    # A byte-order mark, so Excel opens Nepali text as UTF-8.
    return b'\xef\xbb\xbf' + out.getvalue().encode('utf-8')


class WorkbookUnavailable(Exception):
    """The Excel template needs openpyxl, and it is not installed."""


def template_workbook() -> bytes:
    """The same template as a workbook, with the id columns as dropdowns.

    This is the one thing a CSV cannot carry. The sessions table has to
    name the event each session belongs to, and typing an id by hand is
    exactly the sort of thing that goes wrong quietly - a 2 where a 3 was
    meant points a session at the wrong event and nothing looks amiss.
    So in the workbook those two cells are lists, drawn from the ids typed
    into the tables above: you pick an event rather than remembering one.
    """
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.datavalidation import DataValidation
    except ImportError as missing:  # pragma: no cover - depends on the install
        raise WorkbookUnavailable(str(missing))

    book = Workbook()
    sheet = book.active
    sheet.title = 'Programme'

    grey = Font(color='6E7C8E', italic=True)
    heading = Font(bold=True, color='0A2550')
    banner = Font(bold=True, size=13, color='0A2550')
    header_fill = PatternFill('solid', fgColor='EFE8D8')

    # Where each table's id column lives, so the dropdowns can point at it.
    id_ranges = {}
    widest = {}

    for index, (cells, kind) in enumerate(_layout(), start=1):
        for column, value in enumerate(cells, start=1):
            cell = sheet.cell(row=index, column=column, value=value)
            if kind == 'title':
                cell.font = banner
            elif kind == 'note':
                cell.font = grey
            elif kind == 'marker':
                cell.font = heading
            elif kind == 'header':
                cell.font = heading
                cell.fill = header_fill
                cell.alignment = Alignment(vertical='center')
            widest[column] = max(widest.get(column, 10), len(str(value or '')) + 2)

        if kind == 'header':
            name = sheet.cell(row=index - 1, column=1).value
            first = index + 1
            last = index + len(EXAMPLE_ROWS[name]) + ROOM_TO_FILL[name]
            id_ranges[name] = (first, last)

    for column, width in widest.items():
        sheet.column_dimensions[get_column_letter(column)].width = min(width, 42)

    # The dropdown: a session's event is picked from the ids typed above
    # rather than typed again.
    session_first, session_last = id_ranges['SESSIONS']
    picks = (
        ('EVENTS', 'event_id', 'event', 'Events'),
    )
    for name, column_name, thing, table in picks:
        source_first, source_last = id_ranges[name]
        source = get_column_letter(1)
        validation = DataValidation(
            type='list',
            formula1=f'=${source}${source_first}:${source}${source_last}',
            allowBlank=True,
            # openpyxl passes this through to Excel, where it is inverted:
            # False is what puts the arrow on the cell.
            showDropDown=False,
            # Without these two the list is decoration - the arrow appears
            # but anything typed is accepted, which is the whole thing this
            # is here to prevent.
            showErrorMessage=True,
            showInputMessage=True,
            errorStyle='stop',
        )
        validation.errorTitle = 'Not one of the ids above'
        validation.error = (
            f'Pick the {thing} from the {table} table above. '
            'If it is not there yet, add it there first.'
        )
        validation.promptTitle = f'Which {thing}?'
        validation.prompt = f'Choose one of the ids in the {table} table above.'
        sheet.add_data_validation(validation)

        at = get_column_letter(SESSION_COLUMNS.index(column_name) + 1)
        validation.add(f'{at}{session_first}:{at}{session_last}')

    sheet.freeze_panes = 'A2'

    stream = io.BytesIO()
    book.save(stream)
    return stream.getvalue()


def _clean(value):
    return (value or '').strip()


def _is_guidance(row) -> bool:
    """The notes row, and any row somebody has commented out."""
    first = _clean(row.get('event_title')) or _clean(row.get('session_title'))
    return first.startswith('#')


def sheet_timezone():
    """The clock a time written into the sheet is on.

    Not the server's. Everything is stored in UTC and rendered in each
    reader's own zone, which is right for a time the app itself recorded -
    but a time somebody typed into a spreadsheet carries no zone with it.
    "2026-09-14 15:00" in the event_starts_at column means three in the
    afternoon in the hall, and reading it as UTC put every imported
    programme five and three quarter hours out: a three o'clock event
    turned up on the organizer's screen at a quarter to nine.
    """
    from django.conf import settings

    name = getattr(settings, 'LOCAL_TIME_ZONE', None)
    if not name:
        return timezone.get_current_timezone()
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:  # pragma: no cover - a misconfigured server
        logger.warning(f"LOCAL_TIME_ZONE {name!r} is not a timezone; using the server's")
        return timezone.get_current_timezone()


def _moment(raw, *, row, column):
    """A date and time from the sheet, on the clock in the hall.

    Accepts what a spreadsheet is likely to produce rather than one exact
    shape: a T or a space, seconds or none, and a date on its own.
    """
    text = _clean(raw)
    if not text:
        raise ImportProblem('This needs a date and time.', row=row, column=column)

    text = text.replace('/', '-')
    for shape in (
        '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%dT%H:%M', '%Y-%m-%d %I:%M %p', '%Y-%m-%d',
    ):
        try:
            naive = datetime.strptime(text, shape)
        except ValueError:
            continue
        return timezone.make_aware(naive, sheet_timezone())

    raise ImportProblem(
        f'“{text}” is not a date and time. Use 2026-10-02 09:00.',
        row=row, column=column,
    )


def _day(raw, *, row):
    text = _clean(raw)
    if not text:
        raise ImportProblem('The programme needs a date.', row=row, column='event_date')
    return _moment(text, row=row, column='event_date').date()


def _minutes(raw, default, *, row, column):
    text = _clean(raw)
    if not text:
        return default
    try:
        value = int(float(text))
    except ValueError:
        raise ImportProblem(
            f'“{text}” is not a number of minutes.', row=row, column=column
        )
    if value < 5:
        raise ImportProblem(
            'A session runs for at least 5 minutes.', row=row, column=column
        )
    return value


def _text_of(value):
    """One cell as the sheet would show it.

    A workbook hands back real dates and real numbers where a CSV hands
    back the text somebody typed. Both end up as that text, so there is one
    parser after this and not two.
    """
    if value is None:
        return ''
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d %H:%M')
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _rows_from_workbook(raw_bytes):
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise ImportProblem(
            'That looks like a workbook rather than a CSV. In Excel choose '
            'File → Save As → CSV UTF-8, then send that file.'
        )

    try:
        book = load_workbook(io.BytesIO(raw_bytes), data_only=True, read_only=True)
    except Exception:
        raise ImportProblem('That workbook could not be opened.')

    sheet = book.active
    return [[_text_of(cell) for cell in row] for row in sheet.iter_rows(values_only=True)]


def _rows_from(raw_bytes):
    """The sheet as rows of text, whether it arrived as a CSV or a workbook."""
    if raw_bytes[:2] == b'PK':
        return _rows_from_workbook(raw_bytes)

    try:
        text = raw_bytes.decode('utf-8-sig')
    except UnicodeDecodeError:
        try:
            text = raw_bytes.decode('utf-16')
        except UnicodeDecodeError:
            raise ImportProblem(
                'That file is not a CSV saved as UTF-8. In Excel choose '
                '"CSV UTF-8" when saving.'
            )

    if '\x00' in text[:400]:
        raise ImportProblem(
            'That looks like a workbook rather than a CSV. In Excel choose '
            'File → Save As → CSV UTF-8, then send that file.'
        )

    return [row for row in csv.reader(io.StringIO(text))]


TABLE_NAMES = {name for name, _ in TABLES}


def _blank(cells) -> bool:
    return not any(_clean(cell) for cell in cells)


def _marker(cells):
    """The name of the table this row announces, if it announces one."""
    if not cells:
        return None
    first = _clean(cells[0]).upper().strip(':')
    if first in TABLE_NAMES and _blank(cells[1:]):
        return first
    return None


def read_sheet(raw_bytes) -> list:
    """Turn a filled-in template into programmes ready for the serializer.

    Two shapes are read. The three tables the template is made of now, and
    the one wide table it used to be - a sheet somebody started filling in
    last week is still a sheet, and telling them to start again because the
    template has changed would be a poor way to repay the typing.
    """
    rows = _rows_from(raw_bytes)
    if not rows:
        raise ImportProblem('The sheet is empty.')

    if any(_marker(cells) for cells in rows):
        return _read_tables(rows)
    return _read_flat(rows)


def _read_tables(rows) -> list:
    """Read the three tables and join them by the ids they carry."""
    gathered = {name: [] for name in TABLE_NAMES}
    table = None
    header = None

    for number, cells in enumerate(rows, start=1):
        marker = _marker(cells)
        if marker:
            table, header = marker, None
            continue
        if table is None or _blank(cells):
            continue
        if _clean(cells[0]).startswith('#'):
            continue
        if header is None:
            header = [_clean(cell).lower() for cell in cells]
            continue
        gathered[table].append(
            (number, {name: cells[i] if i < len(cells) else ''
                      for i, name in enumerate(header) if name})
        )

    events = []
    by_event_id = {}

    for number, row in gathered['EVENTS']:
        title = _clean(row.get('event_title'))
        if not title:
            raise ImportProblem(
                'Every programme needs a title.', row=number, column='event_title'
            )
        entry = {
            'title': title,
            'description': '',
            'venue': _clean(row.get('venue')),
            'event_date': _day(row.get('event_date'), row=number),
            # Optional: an event can be set up before its hours are
            # settled, the same as through the form. The day it runs is
            # what is compulsory.
            'scheduled_start': (
                _moment(row.get('event_starts_at'), row=number, column='event_starts_at')
                if _clean(row.get('event_starts_at'))
                else None
            ),
            'duration_minutes': _minutes(
                row.get('event_duration_minutes'), 60,
                row=number, column='event_duration_minutes',
            ),
            'sessions': [],
        }
        key = _clean(row.get('event_id')) or title.lower()
        if key in by_event_id:
            raise ImportProblem(
                f'Two events share the id “{key}”. Each needs its own.',
                row=number, column='event_id',
            )
        by_event_id[key] = entry
        events.append(entry)

    if not events:
        raise ImportProblem('There are no events in that sheet.')

    def the_event(key, *, number, column):
        """The event an id points at, forgiving a blank when there is one."""
        key = _clean(key)
        if not key:
            if len(events) == 1:
                return events[0]
            raise ImportProblem(
                'Which event does this belong to? Put its event_id here.',
                row=number, column=column,
            )
        found = by_event_id.get(key)
        if found is None:
            raise ImportProblem(
                f'There is no event with the id “{key}” in the EVENTS table.',
                row=number, column=column,
            )
        return found

    for number, row in gathered['SESSIONS']:
        title = _clean(row.get('session_title'))
        if not title:
            raise ImportProblem(
                'Every session needs a title.', row=number, column='session_title'
            )

        event = the_event(row.get('event_id'), number=number, column='event_id')

        visibility = _clean(row.get('speaker_visibility')).lower() or 'private'
        if visibility not in ('private', 'public'):
            raise ImportProblem(
                f'“{visibility}” should be private or public.',
                row=number, column='speaker_visibility',
            )

        event['sessions'].append({
            'title': title,
            'description': '',
            'speaker_name': _clean(row.get('speaker_name')),
            'speaker_email': _clean(row.get('speaker_email')),
            'speaker_phone': _clean(row.get('speaker_phone')),
            'speaker_visibility': visibility,
            'hall': _clean(row.get('hall')),
            'starts_at': _moment(
                row.get('session_starts_at'), row=number, column='session_starts_at'
            ),
            'duration_minutes': _minutes(
                row.get('session_duration_minutes'), 30,
                row=number, column='session_duration_minutes',
            ),
            'position': len(event['sessions']) + 1,
        })

    # An event with nothing under it yet is allowed: set it up now, fill
    # in the running order later, exactly as the form permits. Its hours
    # are taken from the first session when it was not typed.
    for event in events:
        if event['scheduled_start'] is None:
            event['scheduled_start'] = (
                event['sessions'][0]['starts_at'] if event['sessions']
                else _moment(f'{event["event_date"]} 09:00', row=0, column='event_date')
            )

    return events


def _read_flat(rows) -> list:
    """The old shape: one wide row per session, everything repeated.

    Kept so a sheet filled in against the previous template still imports.
    """
    fieldnames = [(name or '').strip() for name in rows[0]]
    if not any(fieldnames):
        raise ImportProblem('The sheet is empty.')

    got = {name.lower() for name in fieldnames}
    missing = [c for c in COLUMNS if c not in got and c not in (
        'venue', 'event_duration_minutes', 'session_duration_minutes',
        'hall', 'speaker_visibility',
    )]
    if missing:
        raise ImportProblem(
            f'The sheet is missing these columns: {", ".join(missing)}. '
            'Download the template and fill that in.'
        )

    events = []
    by_event = {}

    for number, cells in enumerate(rows[1:], start=2):
        row = {
            name.strip().lower(): (cells[i] if i < len(cells) else '')
            for i, name in enumerate(fieldnames) if name
        }
        if _is_guidance(row):
            continue
        if not any(_clean(v) for v in row.values()):
            continue

        session_title = _clean(row.get('session_title'))
        if not session_title:
            raise ImportProblem(
                'Every row is one session, so it needs a session title.',
                row=number, column='session_title',
            )

        event_title = _clean(row.get('event_title'))
        if not event_title:
            raise ImportProblem(
                'Which event does this session belong to?',
                row=number, column='event_title',
            )

        key = event_title.lower()
        if key not in by_event:
            entry = {
                'title': event_title,
                'description': '',
                'venue': _clean(row.get('venue')),
                'event_date': _day(row.get('event_date'), row=number),
                'scheduled_start': _moment(
                    row.get('event_starts_at'),
                    row=number, column='event_starts_at',
                ),
                'duration_minutes': _minutes(
                    row.get('event_duration_minutes'), 60,
                    row=number, column='event_duration_minutes',
                ),
                'sessions': [],
            }
            by_event[key] = entry
            events.append(entry)
        event = by_event[key]

        visibility = _clean(row.get('speaker_visibility')).lower() or 'private'
        if visibility not in ('private', 'public'):
            raise ImportProblem(
                f'“{visibility}” should be private or public.',
                row=number, column='speaker_visibility',
            )

        event['sessions'].append({
            'title': session_title,
            'description': '',
            'speaker_name': _clean(row.get('speaker_name')),
            'speaker_email': _clean(row.get('speaker_email')),
            'speaker_phone': _clean(row.get('speaker_phone')),
            'speaker_visibility': visibility,
            'hall': _clean(row.get('hall')),
            'starts_at': _moment(
                row.get('session_starts_at'), row=number, column='session_starts_at'
            ),
            'duration_minutes': _minutes(
                row.get('session_duration_minutes'), 30,
                row=number, column='session_duration_minutes',
            ),
            'position': len(event['sessions']) + 1,
        })

    if not events:
        raise ImportProblem('There are no sessions in that sheet.')

    return events

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

#: The two tables the sheet is made of, in the order they appear.
#:
#: There are no id columns any more. A sheet carries one event, so every
#: session in it belongs to that event and there was nothing for an id to
#: tell apart - it was a column to fill in twice and get wrong once.
EVENT_COLUMNS = [
    'event_title', 'event_date', 'venue',
    'event_starts_at', 'event_duration_minutes',
]

SESSION_COLUMNS = [
    'session_title', 'session_starts_at', 'session_duration_minutes',
    'speaker_name', 'speaker_email', 'speaker_phone', 'speaker_visibility',
]

TABLES = [
    ('EVENTS', EVENT_COLUMNS),
    ('SESSIONS', SESSION_COLUMNS),
]

#: How many blank rows each table is given to be filled in. One for the
#: event, because a sheet holds one; enough for a long day of sessions,
#: and more can be added underneath - the reader does not count them.
ROOM_TO_FILL = {'EVENTS': 1, 'SESSIONS': 30}

#: Said once at the top rather than in a note under every column, so the
#: tables themselves are the clean thing the eye lands on.
HOW_TO = [
    'ONE EVENT PER SHEET. Fill the EVENTS table in once. The SESSIONS '
    'table takes as many rows as the day needs.',
    'Dates and times are YYYY-MM-DD HH:MM on the 24-hour clock - '
    '2026-10-02 14:40 - and are read as the clock in the room.',
    'The first session starts when the event starts.',
    'session_duration_minutes is 30 if left blank. The event is as long '
    'as the sessions in it.',
    'speaker_name, speaker_email and speaker_phone are required. The '
    'email is what makes them a presenter when they sign in.',
    'speaker_visibility is private or public, and private if left blank.',
    'venue and event_duration_minutes are optional.',
    'Lines beginning with # are ignored, so this guidance can stay where '
    'it is.',
]

#: One filled-in programme, so the shape is obvious before anything is typed.
EXAMPLE_ROWS = {
    'EVENTS': [
        ['National Health Workers Conference', '2026-10-02',
         'National Assembly Hall', '2026-10-02 09:00', '240'],
    ],
    'SESSIONS': [
        ['Health service delivery in federalism', '2026-10-02 09:00', '60',
         'Dr Sarita Poudel', 'sarita.poudel@example.org',
         '9800000001', 'private'],
        ['Digital health records', '2026-10-02 10:15', '45',
         'Bikash Shrestha', 'bikash.shrestha@example.org',
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
    rows = [(['Manch event registration'], 'title'), ([], 'blank')]
    rows.append((['# HOW TO FILL THIS IN'], 'rubric'))
    for at, line in enumerate(HOW_TO, start=1):
        rows.append(([f'# {at}. {line}'], 'note'))

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
    """The same template as a workbook, set so it can be read at a glance.

    The rules at the top are the thing people get wrong, so they are set
    in ordinary ink rather than the grey italics that say "skip me", and
    the column headings are white on navy so the eye finds where to type.
    """
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError as missing:  # pragma: no cover - depends on the install
        raise WorkbookUnavailable(str(missing))

    book = Workbook()
    sheet = book.active
    sheet.title = 'Programme'

    # The rules are the first thing anybody reads and the thing they get
    # wrong, so they are set in the same ink as everything else rather
    # than in the grey italics that say "skip me".
    rule = Font(color='1F2937')
    rubric = Font(bold=True, size=11, color='0A2550')
    heading = Font(bold=True, color='0A2550')
    banner = Font(bold=True, size=14, color='0A2550')
    header_font = Font(bold=True, color='FFFFFF')
    header_fill = PatternFill('solid', fgColor='12386E')
    example = Font(color='6E7C8E', italic=True)

    widest = {}

    for index, (cells, kind) in enumerate(_layout(), start=1):
        for column, value in enumerate(cells, start=1):
            cell = sheet.cell(row=index, column=column, value=value)
            if kind == 'title':
                cell.font = banner
            elif kind == 'rubric':
                cell.font = rubric
            elif kind == 'note':
                cell.font = rule
            elif kind == 'marker':
                cell.font = heading
            elif kind == 'header':
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = Alignment(vertical='center')
            elif kind == 'example':
                cell.font = example
            # The guidance runs the width of the sheet and would set every
            # column to the width of a sentence, so it is left out of the
            # measuring.
            if kind not in ('title', 'rubric', 'note'):
                widest[column] = max(widest.get(column, 12), len(str(value or '')) + 2)

    for column, width in widest.items():
        sheet.column_dimensions[get_column_letter(column)].width = min(width, 38)

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
    second_event_row = None

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
        if len(events) == 2:
            second_event_row = number

    if not events:
        raise ImportProblem('There are no events in that sheet.')
    if len(events) > 1:
        # One sheet, one event. Several at once meant every session had
        # to name which one it belonged to, and a sheet that quietly
        # created four events is not something anybody asked for twice.
        raise ImportProblem(
            'A sheet holds one event. There are '
            f'{len(events)} in the EVENTS table - put the rest in sheets '
            'of their own.',
            row=second_event_row, column='event_title',
        )

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
        'speaker_visibility',
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

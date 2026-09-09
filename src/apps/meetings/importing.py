"""Building a programme from a spreadsheet instead of a form.

A day with ten sessions is ten passes through a form, and the details -
each speaker's name, address and number - are usually already in a
spreadsheet somebody keeps. So: a template to fill in, and a reader that
turns it back into the same programme the form would have made.

Deliberately CSV. It opens and saves in Excel, in LibreOffice and in
Google Sheets, needs no library on either side, and survives being
emailed round an office. A .xlsx reader would mean a new dependency for a
format every one of those tools can already export.

Nothing here validates a programme itself. The rows are turned into the
same payload the form sends and handed to the same serializer, so the
rules about speakers, spacing, the first session and the plan's limits
apply exactly once, in the place that already owns them.
"""
import csv
import io
import logging
from datetime import datetime

from django.utils import timezone

logger = logging.getLogger(__name__)

#: The columns, in the order the template lays them out.
COLUMNS = [
    'event_title',
    'event_date',
    'venue',
    'meeting_title',
    'meeting_starts_at',
    'meeting_duration_minutes',
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
    'event_title': 'The programme this belongs to. Repeat it on every row of the programme.',
    'event_date': 'YYYY-MM-DD, the day the programme runs.',
    'venue': 'Where it is held. Optional.',
    'meeting_title': 'The meeting. Repeat it on every row of the meeting.',
    'meeting_starts_at': 'YYYY-MM-DD HH:MM. The first session must start at this time.',
    'meeting_duration_minutes': 'Optional; the sessions decide the real length.',
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
        'meeting_title': 'Opening day',
        'meeting_starts_at': '2026-10-02 09:00',
        'meeting_duration_minutes': '240',
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
        'meeting_title': 'Opening day',
        'meeting_starts_at': '2026-10-02 09:00',
        'meeting_duration_minutes': '240',
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


def template_csv() -> bytes:
    """The blank template: the columns, what each is for, and an example.

    The notes and the example are rows rather than a separate sheet, since
    a CSV has only one - and they are removed on the way back in, so the
    file can be filled in underneath them and returned as it stands.
    """
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(COLUMNS)
    writer.writerow([f'# {NOTES[column]}' for column in COLUMNS])
    for row in EXAMPLE:
        writer.writerow([row[column] for column in COLUMNS])
    # A byte-order mark, so Excel opens Nepali text as UTF-8.
    return b'\xef\xbb\xbf' + out.getvalue().encode('utf-8')


def _clean(value):
    return (value or '').strip()


def _is_guidance(row) -> bool:
    """The notes row, and any row somebody has commented out."""
    first = _clean(row.get('event_title')) or _clean(row.get('meeting_title'))
    return first.startswith('#')


def _moment(raw, *, row, column):
    """A date and time from the sheet, in the server's own timezone.

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
        return timezone.make_aware(naive, timezone.get_current_timezone())

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


def read_sheet(raw_bytes) -> list:
    """Turn a filled-in template into programmes ready for the serializer.

    Rows are grouped by programme and then by meeting, in the order they
    appear, so the sheet reads the way the day runs.
    """
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

    if '\x00' in text[:400] or text[:2] == 'PK':
        raise ImportProblem(
            'That looks like a workbook rather than a CSV. In Excel choose '
            'File → Save As → CSV UTF-8, then send that file.'
        )

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ImportProblem('The sheet is empty.')

    got = {(name or '').strip().lower() for name in reader.fieldnames}
    missing = [c for c in COLUMNS if c not in got and c not in (
        'venue', 'meeting_duration_minutes', 'session_duration_minutes',
        'hall', 'speaker_visibility',
    )]
    if missing:
        raise ImportProblem(
            f'The sheet is missing these columns: {", ".join(missing)}. '
            'Download the template and fill that in.'
        )

    events = []
    by_event = {}

    for number, raw in enumerate(reader, start=2):
        row = {(k or '').strip().lower(): v for k, v in raw.items()}
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
        meeting_title = _clean(row.get('meeting_title'))
        if not meeting_title:
            raise ImportProblem(
                'Which meeting does this session belong to?',
                row=number, column='meeting_title',
            )

        key = event_title.lower()
        if key not in by_event:
            entry = {
                'title': event_title,
                'description': '',
                'venue': _clean(row.get('venue')),
                'event_date': _day(row.get('event_date'), row=number),
                'meetings': [],
                '_by_meeting': {},
            }
            by_event[key] = entry
            events.append(entry)
        event = by_event[key]

        meeting_key = meeting_title.lower()
        if meeting_key not in event['_by_meeting']:
            meeting = {
                'title': meeting_title,
                'description': '',
                'scheduled_start': _moment(
                    row.get('meeting_starts_at'),
                    row=number, column='meeting_starts_at',
                ),
                'duration_minutes': _minutes(
                    row.get('meeting_duration_minutes'), 60,
                    row=number, column='meeting_duration_minutes',
                ),
                'sessions': [],
            }
            event['_by_meeting'][meeting_key] = meeting
            event['meetings'].append(meeting)
        meeting = event['_by_meeting'][meeting_key]

        visibility = _clean(row.get('speaker_visibility')).lower() or 'private'
        if visibility not in ('private', 'public'):
            raise ImportProblem(
                f'“{visibility}” should be private or public.',
                row=number, column='speaker_visibility',
            )

        meeting['sessions'].append({
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
            'position': len(meeting['sessions']) + 1,
        })

    if not events:
        raise ImportProblem('There are no sessions in that sheet.')

    for event in events:
        event.pop('_by_meeting', None)
    return events

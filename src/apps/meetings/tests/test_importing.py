"""Building a programme from a spreadsheet.

The reader's job is to turn rows into the payload the form sends. Its
job is *not* to decide whether a programme is legal - that is the
serializer's, and these tests check the sheet cannot get round it.
"""
import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.meetings.importing import (
    COLUMNS, EVENT_COLUMNS, SESSION_COLUMNS,
    ImportProblem, read_sheet, sheet_timezone, template_csv, template_workbook,
)
from src.apps.meetings.models import Event, Session
from src.apps.meetings.tests.factories import make_host

API = '/api/v1'

HEAD = ','.join(COLUMNS)


def sheet(*rows):
    """A CSV with the template's columns and these rows."""
    lines = [HEAD]
    for row in rows:
        lines.append(','.join(row.get(column, '') for column in COLUMNS))
    return ('\n'.join(lines)).encode('utf-8')


def a_session(**over):
    row = {
        'event_title': 'Health Conference',
        'event_date': '2026-10-02',
        'venue': 'Assembly Hall',
        'event_starts_at': '2026-10-02 09:00',
        'event_duration_minutes': '240',
        'session_title': 'Service delivery',
        'session_starts_at': '2026-10-02 09:00',
        'session_duration_minutes': '60',
        'speaker_name': 'Sarita Poudel',
        'speaker_email': 'sarita@example.org',
        'speaker_phone': '9800000001',
        'speaker_visibility': 'private',
    }
    row.update(over)
    return row


class TemplateTests(TestCase):
    def headers(self):
        """The header line under each of the three table markers."""
        lines = template_csv().decode('utf-8-sig').splitlines()
        found = {}
        for index, line in enumerate(lines):
            name = line.strip().rstrip(',').upper()
            if name in ('EVENTS', 'SESSIONS'):
                found[name] = lines[index + 1].split(',')
        return found

    def test_it_is_three_tables_one_under_the_other(self):
        found = self.headers()

        self.assertEqual(found['EVENTS'], EVENT_COLUMNS)
        self.assertEqual(found['SESSIONS'], SESSION_COLUMNS)

    def test_it_asks_for_nothing_twice(self):
        # A sheet holds one event, so there is nothing for an id to tell
        # apart: the columns went, and with them a thing to get wrong.
        self.assertNotIn('event_id', EVENT_COLUMNS)
        self.assertNotIn('event_id', SESSION_COLUMNS)
        self.assertNotIn('session_id', SESSION_COLUMNS)

    def test_it_says_at_the_top_that_a_sheet_holds_one_event(self):
        text = template_csv().decode('utf-8-sig')

        self.assertIn('ONE EVENT PER SHEET', text)

    def test_the_rules_are_numbered_so_one_can_be_pointed_at(self):
        lines = template_csv().decode('utf-8-sig').splitlines()

        self.assertTrue(any(line.startswith('# 1. ') for line in lines))
        self.assertTrue(any(line.startswith('# HOW TO FILL THIS IN') for line in lines))

    def test_it_says_how_to_fill_it_in(self):
        text = template_csv().decode('utf-8-sig')

        self.assertIn('# ', text.splitlines()[2])
        self.assertIn('YYYY-MM-DD', text)

    def test_it_leaves_room_to_type_in(self):
        # Blank rows under each table, so nothing has to be inserted.
        lines = template_csv().decode('utf-8-sig').splitlines()
        empty = [line for line in lines if line and set(line) == {','}]

        self.assertGreater(len(empty), 20)

    def test_it_opens_as_utf_eight_in_excel(self):
        self.assertTrue(template_csv().startswith(b'\xef\xbb\xbf'))

    def test_the_example_in_it_can_be_read_straight_back(self):
        # Whatever the template shows must be a thing the reader accepts,
        # or the first attempt anybody makes will fail.
        programmes = read_sheet(template_csv())

        self.assertEqual(len(programmes), 1)
        self.assertEqual(len(programmes[0]['sessions']), 2)

    def test_the_guidance_row_is_not_read_as_a_session(self):
        titles = [
            s['title']
            for s in read_sheet(template_csv())[0]['sessions']
        ]

        self.assertNotIn('# One row per session.', titles)


class ReadingTests(TestCase):
    def test_one_row_is_one_session(self):
        programmes = read_sheet(sheet(a_session()))

        self.assertEqual(len(programmes), 1)
        event = programmes[0]
        self.assertEqual(event['title'], 'Health Conference')
        self.assertEqual(event['venue'], 'Assembly Hall')
        self.assertEqual(event['sessions'][0]['title'], 'Service delivery')

    def test_rows_sharing_a_meeting_are_one_meeting(self):
        programmes = read_sheet(sheet(
            a_session(),
            a_session(session_title='Records', session_starts_at='2026-10-02 10:15'),
        ))

        events = programmes
        self.assertEqual(len(events), 1)
        self.assertEqual(len(events[0]['sessions']), 2)

    def test_two_events_in_one_sheet(self):
        programmes = read_sheet(sheet(
            a_session(),
            a_session(
                event_title='Afternoon', event_starts_at='2026-10-02 14:00',
                session_title='Panel', session_starts_at='2026-10-02 14:00',
            ),
        ))

        self.assertEqual(
            [m['title'] for m in programmes],
            ['Health Conference', 'Afternoon'],
        )

    def test_two_programmes_in_one_sheet(self):
        programmes = read_sheet(sheet(
            a_session(),
            a_session(
                event_title='District Review', event_date='2026-10-09',
                event_starts_at='2026-10-09 09:00',
                session_starts_at='2026-10-09 09:00',
            ),
        ))

        self.assertEqual([e['title'] for e in programmes],
                         ['Health Conference', 'District Review'])

    def test_the_running_order_is_the_order_of_the_rows(self):
        programmes = read_sheet(sheet(
            a_session(session_title='First'),
            a_session(session_title='Second', session_starts_at='2026-10-02 10:15'),
            a_session(session_title='Third', session_starts_at='2026-10-02 11:30'),
        ))

        sessions = programmes[0]['sessions']
        self.assertEqual([s['position'] for s in sessions], [1, 2, 3])

    def test_a_missing_duration_gets_the_default(self):
        programmes = read_sheet(sheet(a_session(session_duration_minutes='')))

        self.assertEqual(
            programmes[0]['sessions'][0]['duration_minutes'], 30
        )

    def test_the_shapes_a_spreadsheet_writes_dates_in(self):
        for written in (
            '2026-10-02 09:00', '2026-10-02T09:00', '2026-10-02 09:00:00',
            '2026/10/02 09:00', '2026-10-02 09:00 AM',
        ):
            programmes = read_sheet(sheet(a_session(session_starts_at=written)))
            when = programmes[0]['sessions'][0]['starts_at']
            # Nine as the hall's clock has it, whatever the server's is.
            self.assertEqual(when.astimezone(sheet_timezone()).hour, 9, written)

    def test_a_date_it_cannot_read_says_which_row_and_column(self):
        with self.assertRaises(ImportProblem) as problem:
            read_sheet(sheet(a_session(session_starts_at='next Tuesday')))

        self.assertEqual(problem.exception.row, 2)
        self.assertEqual(problem.exception.column, 'session_starts_at')
        self.assertIn('2026-10-02 09:00', str(problem.exception))

    def test_a_row_with_no_session_title_is_refused(self):
        with self.assertRaises(ImportProblem) as problem:
            read_sheet(sheet(a_session(session_title='')))

        self.assertEqual(problem.exception.column, 'session_title')

    def test_a_sheet_with_the_wrong_columns_says_which_are_missing(self):
        with self.assertRaises(ImportProblem) as problem:
            read_sheet(b'name,when\nSomething,today\n')

        self.assertIn('session_title', str(problem.exception))

    def test_an_empty_sheet_is_refused(self):
        with self.assertRaises(ImportProblem):
            read_sheet(sheet())

    def test_a_workbook_that_is_not_a_sheet_is_explained(self):
        with self.assertRaises(ImportProblem) as problem:
            read_sheet(b'PK\x03\x04' + b'\x00' * 40)

        self.assertIn('could not be opened', str(problem.exception))

    def test_blank_rows_between_meetings_are_ignored(self):
        raw = sheet(a_session()).decode('utf-8')
        with_gap = raw.replace('\n', '\n' + ',' * (len(COLUMNS) - 1) + '\n', 1)

        self.assertEqual(len(read_sheet(with_gap.encode('utf-8'))), 1)


class ImportEndpointTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')

    def as_host(self):
        from django.test import Client

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')

    def send(self, body, **extra):
        return self.as_host().post(
            f'{API}/events/import_sheet/',
            {'file': SimpleUploadedFile('plan.csv', body, content_type='text/csv'), **extra},
        )

    def test_the_template_downloads(self):
        response = self.as_host().get(f'{API}/events/import_template/')

        self.assertEqual(response.status_code, 200)
        self.assertIn('text/csv', response['Content-Type'])
        self.assertIn('attachment', response['Content-Disposition'])

    def test_the_workbook_downloads_too(self):
        response = self.as_host().get(f'{API}/events/import_template/?shape=xlsx')

        self.assertEqual(response.status_code, 200)
        self.assertIn('spreadsheetml', response['Content-Type'])
        self.assertIn('.xlsx', response['Content-Disposition'])
        self.assertTrue(response.content.startswith(b'PK'))

    def test_a_filled_in_workbook_is_accepted(self):
        # The loop closes at the endpoint too: what is handed out comes
        # back, dropdowns and all, without a detour through Save As.
        from src.apps.meetings.importing import template_workbook

        response = self.as_host().post(
            f'{API}/events/import_sheet/',
            {'file': SimpleUploadedFile(
                'plan.xlsx',
                template_workbook(),
                content_type=(
                    'application/vnd.openxmlformats-officedocument'
                    '.spreadsheetml.sheet'
                ),
            )},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Event.objects.count(), 1)

    def test_it_needs_signing_in(self):
        from django.test import Client

        self.assertEqual(
            Client().get(f'{API}/events/import_template/').status_code, 401
        )

    def test_a_sheet_becomes_a_programme(self):
        response = self.send(sheet(
            a_session(),
            a_session(session_title='Records', session_starts_at='2026-10-02 10:15'),
        ))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(Session.objects.count(), 2)
        self.assertEqual(
            Session.objects.order_by('starts_at').first().speaker_email,
            'sarita@example.org',
        )

    def test_a_dry_run_makes_nothing(self):
        response = self.send(sheet(a_session()), dry_run='true')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['dry_run'])
        self.assertEqual(Event.objects.count(), 0)
        self.assertEqual(
            response.json()['programmes'][0]['sessions'][0]['title'],
            'Service delivery',
        )

    def test_a_sheet_cannot_get_round_the_speaker_rules(self):
        # The form requires a name, an address and a number; so does this.
        response = self.send(sheet(a_session(speaker_email='')))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Event.objects.count(), 0)

    def test_the_first_session_is_pinned_to_the_meeting_as_the_form_does(self):
        self.send(sheet(a_session(session_starts_at='2026-10-02 09:30')))

        event = Event.objects.get()
        first = event.sessions.order_by('starts_at').first()
        self.assertEqual(first.starts_at, event.scheduled_start)

    def test_a_running_order_typed_too_tight_is_spaced_out(self):
        self.send(sheet(
            a_session(session_title='First', session_duration_minutes='60'),
            a_session(session_title='Second', session_starts_at='2026-10-02 10:00'),
        ))

        first, second = Event.objects.get().sessions.order_by('starts_at')
        gap = (second.starts_at - (first.starts_at + timezone.timedelta(
            minutes=first.duration_minutes
        ))).total_seconds() / 60
        self.assertGreaterEqual(gap, 15)

    def test_nothing_lands_when_one_row_is_wrong(self):
        # Half a programme is worse than a refusal: the half that landed
        # has to be found and undone by hand.
        response = self.send(sheet(
            a_session(),
            a_session(
                event_title='Second programme', event_date='2026-10-09',
                event_starts_at='2026-10-09 09:00',
                session_starts_at='2026-10-09 09:00',
                speaker_phone='',
            ),
        ))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Event.objects.count(), 0)

    def test_a_bad_date_is_reported_with_its_row(self):
        response = self.send(sheet(a_session(session_starts_at='soon')))

        body = response.json()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(body['code'], 'bad_sheet')
        self.assertEqual(body['row'], 2)

    def test_sending_no_file_says_so(self):
        response = self.as_host().post(f'{API}/events/import_sheet/', {})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'no_file')


def tables(events=(), sessions=()):
    """A sheet in the shape the template now has: two tables, one under
    the other, joined by the ids they carry."""
    lines = ['Manch programme template', '# guidance goes here', '']
    for name, columns, rows in (
        ('EVENTS', EVENT_COLUMNS, events),
        ('SESSIONS', SESSION_COLUMNS, sessions),
    ):
        lines += [name, ','.join(columns)]
        for row in rows:
            lines.append(','.join(row.get(column, '') for column in columns))
        lines += ['', ',' * (len(columns) - 1), '']
    return ('\n'.join(lines)).encode('utf-8')


AN_EVENT = {
    'event_id': '1', 'event_title': 'Nepal Can Move',
    'event_date': '2026-09-14', 'venue': 'National Assembly Hall',
    'event_starts_at': '2026-09-14 12:40', 'event_duration_minutes': '30',
}


def a_row(**over):
    row = {
        'session_id': '1001', 'event_id': '1',
        'session_title': 'Health service delivery in federalism',
        'session_starts_at': '2026-09-14 12:40', 'session_duration_minutes': '5',
        'speaker_name': 'Dr Sarita Poudel',
        'speaker_email': 'sarita@example.org', 'speaker_phone': '9800000001',
        'speaker_visibility': 'private',
    }
    row.update(over)
    return row


class TwoTablesTests(TestCase):
    """The sheet as two tables, joined by id.

    One row is one thing - one event, one session - and nothing is typed
    twice. What used to hold an event together was repeating its title on
    every session's row, which meant the tenth row could quietly disagree
    with the first.
    """

    def test_it_reads_the_shape_the_template_is_in(self):
        events = read_sheet(template_csv())

        self.assertEqual(len(events), 1)
        self.assertEqual(len(events[0]['sessions']), 2)

    def test_a_second_event_in_the_table_is_refused(self):
        # One sheet, one event. Several at once meant every session had to
        # name which one it belonged to, and a sheet that quietly created
        # four events is not something anybody asked for twice.
        raw = tables(
            events=[
                AN_EVENT,
                {'event_title': 'Nepal Cannot Move', 'event_date': '2026-09-14'},
            ],
            sessions=[a_row()],
        )

        with self.assertRaises(ImportProblem) as problem:
            read_sheet(raw)

        self.assertIn('A sheet holds one event', str(problem.exception))
        self.assertEqual(problem.exception.column, 'event_title')

    def test_it_points_at_the_row_the_second_one_is_on(self):
        raw = tables(
            events=[AN_EVENT, {'event_title': 'Second', 'event_date': '2026-09-14'}],
            sessions=[a_row()],
        )

        with self.assertRaises(ImportProblem) as problem:
            read_sheet(raw)

        self.assertIsNotNone(problem.exception.row)

    def test_there_is_no_ceiling_on_the_sessions(self):
        raw = tables(
            events=[AN_EVENT],
            sessions=[
                a_row(session_title=f'Talk {n}',
                      session_starts_at=f'2026-09-14 {9 + n:02d}:00')
                for n in range(12)
            ],
        )

        [programme] = read_sheet(raw)
        self.assertEqual(len(programme['sessions']), 12)

    def test_an_event_with_nothing_under_it_yet_is_still_made(self):
        # Set the event up now, fill in its day later. The form allows
        # that, so the sheet does too.
        raw = tables(events=[AN_EVENT], sessions=[])

        programmes = read_sheet(raw)
        self.assertEqual([p['title'] for p in programmes], ['Nepal Can Move'])
        self.assertEqual(programmes[0]['sessions'], [])

    def test_the_order_of_the_rows_is_the_order_of_the_day(self):
        raw = tables(
            events=[AN_EVENT], sessions=[
                a_row(session_id='1', session_title='One'),
                a_row(session_id='2', session_title='Two',
                      session_starts_at='2026-09-14 13:00'),
            ],
        )

        [programme] = read_sheet(raw)
        sessions = programme['sessions']
        self.assertEqual([s['title'] for s in sessions], ['One', 'Two'])
        self.assertEqual([s['position'] for s in sessions], [1, 2])

    def test_a_session_needs_no_id_typed_at_all(self):
        # There is one event, so there is nothing to be ambiguous about.
        raw = tables(
            events=[{'event_title': 'Small day', 'event_date': '2026-09-14'}],
            sessions=[a_row(session_starts_at='2026-09-14 09:00')],
        )

        [programme] = read_sheet(raw)
        self.assertEqual(len(programme['sessions']), 1)

    def test_the_row_number_of_a_bad_cell_is_the_one_in_the_spreadsheet(self):
        raw = tables(events=[AN_EVENT], sessions=[a_row(session_starts_at='the afternoon')])
        lines = raw.decode('utf-8').splitlines()
        expected = lines.index(
            [line for line in lines if 'the afternoon' in line][0]
        ) + 1

        with self.assertRaises(ImportProblem) as problem:
            read_sheet(raw)

        self.assertEqual(problem.exception.row, expected)

    def test_the_old_wide_sheet_is_still_read(self):
        # Somebody halfway through filling in last week's template is not
        # made to start again.
        programmes = read_sheet(sheet(a_session()))

        self.assertEqual(len(programmes), 1)
        self.assertEqual(len(programmes[0]['sessions']), 1)


class WorkbookTests(TestCase):
    """The Excel template, which carries what a CSV cannot: the dropdowns."""

    def test_it_is_a_workbook(self):
        self.assertTrue(template_workbook().startswith(b'PK'))

    def test_it_holds_the_same_three_tables(self):
        from openpyxl import load_workbook

        book = load_workbook(io.BytesIO(template_workbook()))
        sheet_ = book.active
        markers = [
            row[0].value for row in sheet_.iter_rows(min_col=1, max_col=1)
            if row[0].value in ('EVENTS', 'SESSIONS')
        ]

        self.assertEqual(markers, ['EVENTS', 'SESSIONS'])

    def test_nothing_is_picked_from_a_list_any_more(self):
        # The dropdown existed to point a session at one of several
        # events. There is one, so it pointed at nothing.
        from openpyxl import load_workbook

        book = load_workbook(io.BytesIO(template_workbook()))

        self.assertEqual(len(book.active.data_validations.dataValidation), 0)

    def test_the_column_headings_stand_out_from_what_is_typed_under_them(self):
        from openpyxl import load_workbook

        sheet = load_workbook(io.BytesIO(template_workbook())).active
        headings = [
            cell
            for row in sheet.iter_rows()
            for cell in row
            if cell.value == 'session_title'
        ]

        self.assertTrue(headings)
        for cell in headings:
            self.assertTrue(cell.font.bold)
            self.assertEqual(cell.fill.fgColor.rgb[-6:], '12386E')

    def test_the_rules_are_set_to_be_read_rather_than_skipped(self):
        from openpyxl import load_workbook

        sheet = load_workbook(io.BytesIO(template_workbook())).active
        rules = [
            cell
            for row in sheet.iter_rows()
            for cell in row
            if isinstance(cell.value, str) and cell.value.startswith('# 1. ')
        ]

        self.assertTrue(rules)
        # Not the grey italics that say "skip me".
        self.assertFalse(rules[0].font.italic)

    def test_a_filled_in_workbook_can_be_read_straight_back(self):
        # The loop has to close: the file we hand out has to be one we
        # accept back, or the dropdowns are decoration.
        programmes = read_sheet(template_workbook())

        self.assertEqual(len(programmes), 1)
        self.assertEqual(len(programmes[0]['sessions']), 2)


class TheClockInTheHallTests(TestCase):
    """A time typed into a sheet carries no timezone with it.

    Everything is stored in UTC and rendered in each reader's own zone,
    which is right for a time the app recorded itself. But "2026-09-14
    15:00" in a spreadsheet means three in the afternoon in the hall, and
    reading it as UTC put every imported programme five and three quarter
    hours out - a three o'clock event arrived on the organizer's screen
    at a quarter to nine, matching nothing in the sheet it came from.
    """

    def in_the_hall(self, moment):
        from src.apps.meetings.importing import sheet_timezone

        return moment.astimezone(sheet_timezone())

    def test_three_in_the_afternoon_stays_three_in_the_afternoon(self):
        raw = tables(
            events=[{**AN_EVENT, 'event_starts_at': '2026-09-14 15:00'}],
            sessions=[a_row(session_starts_at='2026-09-14 15:00')],
        )

        [programme] = read_sheet(raw)
        event = programme

        self.assertEqual(self.in_the_hall(event['scheduled_start']).hour, 15)
        self.assertEqual(
            self.in_the_hall(event['sessions'][0]['starts_at']).hour, 15
        )

    def test_the_twelve_hour_clock_a_spreadsheet_writes_reads_the_same_way(self):
        # Excel hands back "3:00 PM" as often as "15:00".
        raw = tables(
            events=[{**AN_EVENT, 'event_starts_at': '2026-09-14 3:00 PM'}],
            sessions=[a_row(session_starts_at='2026-09-14 3:00 PM')],
        )

        [programme] = read_sheet(raw)

        self.assertEqual(
            self.in_the_hall(programme['scheduled_start']).hour, 15
        )

    def test_the_day_is_the_day_in_the_hall_too(self):
        # Late enough that reading it as UTC would land it on the 15th.
        raw = tables(
            events=[{**AN_EVENT, 'event_starts_at': '2026-09-14 23:30'}],
            sessions=[a_row(session_starts_at='2026-09-14 23:30')],
        )

        [programme] = read_sheet(raw)
        starts = self.in_the_hall(programme['scheduled_start'])

        self.assertEqual(starts.date().isoformat(), '2026-09-14')

    def test_the_old_wide_sheet_is_read_on_the_same_clock(self):
        [programme] = read_sheet(sheet(a_session(
            event_starts_at='2026-10-02 15:00',
            session_starts_at='2026-10-02 15:00',
        )))

        self.assertEqual(
            self.in_the_hall(programme['scheduled_start']).hour, 15
        )

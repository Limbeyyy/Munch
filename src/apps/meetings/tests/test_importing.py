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
    COLUMNS, ImportProblem, read_sheet, template_csv,
)
from src.apps.meetings.models import Event, Meeting, Session
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
        'meeting_title': 'Opening day',
        'meeting_starts_at': '2026-10-02 09:00',
        'meeting_duration_minutes': '240',
        'session_title': 'Service delivery',
        'session_starts_at': '2026-10-02 09:00',
        'session_duration_minutes': '60',
        'hall': 'Hall A',
        'speaker_name': 'Sarita Poudel',
        'speaker_email': 'sarita@example.org',
        'speaker_phone': '9800000001',
        'speaker_visibility': 'private',
    }
    row.update(over)
    return row


class TemplateTests(TestCase):
    def test_it_carries_every_column_the_reader_expects(self):
        text = template_csv().decode('utf-8-sig')
        header = text.splitlines()[0].split(',')

        self.assertEqual(header, COLUMNS)

    def test_it_says_what_each_column_is_for(self):
        text = template_csv().decode('utf-8-sig')

        self.assertIn('# ', text.splitlines()[1])
        self.assertIn('YYYY-MM-DD', text)

    def test_it_opens_as_utf_eight_in_excel(self):
        self.assertTrue(template_csv().startswith(b'\xef\xbb\xbf'))

    def test_the_example_in_it_can_be_read_straight_back(self):
        # Whatever the template shows must be a thing the reader accepts,
        # or the first attempt anybody makes will fail.
        programmes = read_sheet(template_csv())

        self.assertEqual(len(programmes), 1)
        self.assertEqual(len(programmes[0]['meetings'][0]['sessions']), 2)

    def test_the_guidance_row_is_not_read_as_a_session(self):
        titles = [
            s['title']
            for s in read_sheet(template_csv())[0]['meetings'][0]['sessions']
        ]

        self.assertNotIn('# One row per session.', titles)


class ReadingTests(TestCase):
    def test_one_row_is_one_session(self):
        programmes = read_sheet(sheet(a_session()))

        self.assertEqual(len(programmes), 1)
        event = programmes[0]
        self.assertEqual(event['title'], 'Health Conference')
        self.assertEqual(event['venue'], 'Assembly Hall')
        self.assertEqual(len(event['meetings']), 1)
        self.assertEqual(event['meetings'][0]['sessions'][0]['title'], 'Service delivery')

    def test_rows_sharing_a_meeting_are_one_meeting(self):
        programmes = read_sheet(sheet(
            a_session(),
            a_session(session_title='Records', session_starts_at='2026-10-02 10:15'),
        ))

        meetings = programmes[0]['meetings']
        self.assertEqual(len(meetings), 1)
        self.assertEqual(len(meetings[0]['sessions']), 2)

    def test_two_meetings_in_one_programme(self):
        programmes = read_sheet(sheet(
            a_session(),
            a_session(
                meeting_title='Afternoon', meeting_starts_at='2026-10-02 14:00',
                session_title='Panel', session_starts_at='2026-10-02 14:00',
            ),
        ))

        self.assertEqual(
            [m['title'] for m in programmes[0]['meetings']],
            ['Opening day', 'Afternoon'],
        )

    def test_two_programmes_in_one_sheet(self):
        programmes = read_sheet(sheet(
            a_session(),
            a_session(
                event_title='District Review', event_date='2026-10-09',
                meeting_starts_at='2026-10-09 09:00',
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

        sessions = programmes[0]['meetings'][0]['sessions']
        self.assertEqual([s['position'] for s in sessions], [1, 2, 3])

    def test_a_missing_duration_gets_the_default(self):
        programmes = read_sheet(sheet(a_session(session_duration_minutes='')))

        self.assertEqual(
            programmes[0]['meetings'][0]['sessions'][0]['duration_minutes'], 30
        )

    def test_the_shapes_a_spreadsheet_writes_dates_in(self):
        for written in (
            '2026-10-02 09:00', '2026-10-02T09:00', '2026-10-02 09:00:00',
            '2026/10/02 09:00', '2026-10-02 09:00 AM',
        ):
            programmes = read_sheet(sheet(a_session(session_starts_at=written)))
            when = programmes[0]['meetings'][0]['sessions'][0]['starts_at']
            self.assertEqual(timezone.localtime(when).hour, 9, written)

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

    def test_a_workbook_is_recognised_and_explained(self):
        # Somebody will send the .xlsx. Say what to do rather than failing
        # on a decode error.
        with self.assertRaises(ImportProblem) as problem:
            read_sheet(b'PK\x03\x04' + b'\x00' * 40)

        self.assertIn('CSV UTF-8', str(problem.exception))

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
        self.assertEqual(Meeting.objects.count(), 1)
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
            response.json()['programmes'][0]['meetings'][0]['sessions'][0]['title'],
            'Service delivery',
        )

    def test_a_sheet_cannot_get_round_the_speaker_rules(self):
        # The form requires a name, an address and a number; so does this.
        response = self.send(sheet(a_session(speaker_email='')))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Event.objects.count(), 0)

    def test_the_first_session_is_pinned_to_the_meeting_as_the_form_does(self):
        self.send(sheet(a_session(session_starts_at='2026-10-02 09:30')))

        meeting = Meeting.objects.get()
        first = meeting.sessions.order_by('starts_at').first()
        self.assertEqual(first.starts_at, meeting.scheduled_start)

    def test_a_running_order_typed_too_tight_is_spaced_out(self):
        self.send(sheet(
            a_session(session_title='First', session_duration_minutes='60'),
            a_session(session_title='Second', session_starts_at='2026-10-02 10:00'),
        ))

        first, second = Meeting.objects.get().sessions.order_by('starts_at')
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
                meeting_starts_at='2026-10-09 09:00',
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

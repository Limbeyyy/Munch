"""Exporting a report to the reader's own Google Sheets.

The Drive call itself is stubbed - what is worth pinning here is whose
credentials are used, what the file is called, and what the reader is told
when their Google sign-in cannot carry it.
"""
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.accounts.models import GoogleConnection
from src.apps.drive.services.sheets import SheetExportError, as_csv
from src.apps.meetings.tests.factories import make_host

API = '/api/v1'
ENDPOINT = f'{API}/exports/sheet/'
ROWS = [['Name', 'Sessions'], ['Bishnu', '3'], ['Sabina', '2']]


class SheetContentTests(TestCase):
    def test_the_file_says_it_is_utf_eight(self):
        # Without the mark, Sheets and Excel both read Nepali headings as
        # mojibake.
        written = as_csv([['नाम', 'सत्र']])

        self.assertTrue(written.startswith(b'\xef\xbb\xbf'))
        self.assertIn('नाम', written.decode('utf-8'))

    def test_a_comma_in_a_name_does_not_become_two_columns(self):
        written = as_csv([['Adhikari, Surya', '2']]).decode('utf-8')

        self.assertIn('"Adhikari, Surya"', written)

    def test_a_missing_cell_is_blank_rather_than_the_word_none(self):
        self.assertIn(',,', as_csv([['a', None, 'b']]).decode('utf-8'))


class ExportEndpointTests(TestCase):
    def setUp(self):
        self.user = make_host('host@example.com')
        self.client_kwargs = {
            'HTTP_AUTHORIZATION': f'Bearer {AccessToken.for_user(self.user)}',
        }

    def post(self, body):
        return self.client.post(
            ENDPOINT, body, content_type='application/json', **self.client_kwargs
        )

    def connect_google(self):
        connection = GoogleConnection.objects.create(
            user=self.user, provider_subject='google-123',
            token_expiry=timezone.now() + timezone.timedelta(hours=1),
        )
        connection.access_token = 'access'
        connection.refresh_token = 'refresh'
        connection.save()
        return connection

    def test_it_needs_signing_in(self):
        response = self.client.post(
            ENDPOINT, {'kind': 'attendance', 'rows': ROWS},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 401)

    def test_an_account_with_no_google_is_told_what_to_do_about_it(self):
        response = self.post({'kind': 'attendance', 'rows': ROWS})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'google_not_connected')

    def test_the_sheet_is_made_on_this_persons_own_credentials(self):
        self.connect_google()

        with patch('src.apps.drive.export_views.export_rows') as making:
            making.return_value = {'id': 'sheet-1', 'name': 'x', 'url': 'https://x'}
            response = self.post({'kind': 'attendance', 'rows': ROWS})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(making.call_args.args[0], self.user)
        self.assertEqual(making.call_args.kwargs['rows'], ROWS)

    def test_the_link_to_open_it_comes_back(self):
        self.connect_google()

        with patch('src.apps.drive.export_views.export_rows') as making:
            making.return_value = {
                'id': 'sheet-1', 'name': 'Manch attendance',
                'url': 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
            }
            body = self.post({'kind': 'attendance', 'rows': ROWS}).json()

        self.assertIn('docs.google.com/spreadsheets', body['url'])

    def test_the_caller_does_not_choose_the_name(self):
        # The title says which report it is and when it was taken, so two
        # people exporting the same thing recognise each other's file.
        self.connect_google()

        with patch('src.apps.drive.export_views.export_rows') as making:
            making.return_value = {'id': '1', 'name': 'x', 'url': 'https://x'}
            self.post({
                'kind': 'report', 'rows': ROWS,
                'title': 'anything I like', 'subject': 'Wedding day',
            })

        title = making.call_args.kwargs['title']
        self.assertTrue(title.startswith('Manch event report'))
        self.assertIn('Wedding day', title)
        self.assertNotIn('anything I like', title)

    def test_an_unknown_report_is_refused(self):
        self.connect_google()

        response = self.post({'kind': 'everything', 'rows': ROWS})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'unknown_kind')

    def test_rows_have_to_be_rows(self):
        self.connect_google()

        response = self.post({'kind': 'attendance', 'rows': 'Name,Sessions'})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'bad_rows')

    def test_google_refusing_is_reported_as_google_refusing(self):
        # A 502 rather than a 500: nothing here is broken, and the reader
        # should be told it was the other end.
        self.connect_google()

        with patch('src.apps.drive.export_views.export_rows') as making:
            making.side_effect = SheetExportError('Google would not: nope')
            response = self.post({'kind': 'attendance', 'rows': ROWS})

        self.assertEqual(response.status_code, 502)
        self.assertIn('nope', response.json()['error'])

    def test_an_expired_sign_in_with_nothing_to_refresh_asks_for_a_new_one(self):
        connection = self.connect_google()
        connection.token_expiry = timezone.now() - timezone.timedelta(hours=1)
        connection.refresh_token = None
        connection.save()

        response = self.post({'kind': 'attendance', 'rows': ROWS})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'google_reauth_needed')

    def test_nothing_to_export_is_said_plainly(self):
        self.connect_google()

        response = self.post({'kind': 'attendance', 'rows': []})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'nothing_to_export')

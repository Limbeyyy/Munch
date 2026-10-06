"""Taking a payment, from opening it to believing it was made.

What settles an order is the one thing worth pinning. The gateway's
notification and the customer's own return both arrive unauthenticated
and carry no amount and no status - so neither may mark anything paid.
Both only prompt a CheckTransactionStatus call, and that is believed.
"""
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.tests.factories import make_host
from src.apps.payments.models import PaymentOrder

API = '/api/payments'

CONFIGURED = dict(
    NEPALPAYMENT_MERCHANT_ID='5269',
    NEPALPAYMENT_MERCHANT_NAME='saroj01',
    NEPALPAYMENT_API_USERNAME='testapi',
    NEPALPAYMENT_API_PASSWORD='test#2211',
    NEPALPAYMENT_KEY='SecretKey',
    NEPALPAYMENT_API_URL='https://apisandbox.nepalpayment.com',
    NEPALPAYMENT_CHECKOUT_URL='https://gatewaysandbox.nepalpayment.com/Payment/Index',
)

PAID = {
    'GatewayReferenceNo': '100000035434',
    'Amount': '100',
    'ServiceCharge': '5',
    'ProcessId': '0E92183C_015D_4D1A_8467_8F11DFB136E0',
    'TransactionDate': '2023-08-08 14:01:56',
    'Status': 'Success',
    'Institution': 'Test Bank',
    'Instrument': 'Test MBanking',
}


@override_settings(**CONFIGURED)
class OpeningAPaymentTests(TestCase):
    def setUp(self):
        self.user = make_host('payer@example.com')
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_tokens(self.user)['access']}"
        )

    def open(self, **over):
        body = {'order_id': 'SUB-2026-01', 'amount': '100.00'}
        body.update(over)
        return self.client.post(f'{API}/initiate/', body, format='json')

    def test_a_process_id_is_fetched_before_the_browser_is_sent_anywhere(self):
        """The gateway refuses a transaction opened without one."""
        with mock.patch('src.apps.payments.onepg.process_id',
                        return_value='TOKEN123') as asked:
            response = self.open()

        self.assertEqual(response.status_code, 200, response.data)
        asked.assert_called_once()
        self.assertEqual(response.data['payload']['ProcessId'], 'TOKEN123')

    def test_the_form_goes_to_the_gateway_not_the_api(self):
        """Two different hosts. Posting the form at the API does nothing."""
        with mock.patch('src.apps.payments.onepg.process_id', return_value='T'):
            response = self.open()

        self.assertEqual(
            response.data['gateway_url'],
            'https://gatewaysandbox.nepalpayment.com/Payment/Index',
        )

    def test_the_order_remembers_its_token(self):
        with mock.patch('src.apps.payments.onepg.process_id', return_value='T0K'):
            self.open()

        self.assertEqual(
            PaymentOrder.objects.get(order_id='SUB-2026-01').process_id, 'T0K'
        )

    def test_the_amount_cannot_be_changed_once_opened(self):
        with mock.patch('src.apps.payments.onepg.process_id', return_value='T'):
            self.open()
            response = self.open(amount='1.00')

        self.assertEqual(response.status_code, 409)

    def test_somebody_elses_order_is_refused(self):
        with mock.patch('src.apps.payments.onepg.process_id', return_value='T'):
            self.open()

        other = APIClient()
        other.credentials(HTTP_AUTHORIZATION=(
            f"Bearer {issue_tokens(make_host('other@example.com'))['access']}"
        ))
        response = other.post(f'{API}/initiate/',
                              {'order_id': 'SUB-2026-01', 'amount': '100.00'},
                              format='json')

        self.assertEqual(response.status_code, 403)

    def test_a_paid_order_is_not_opened_again(self):
        with mock.patch('src.apps.payments.onepg.process_id', return_value='T'):
            self.open()
        PaymentOrder.objects.filter(order_id='SUB-2026-01').update(
            status=PaymentOrder.Status.SUCCESS
        )

        with mock.patch('src.apps.payments.onepg.process_id', return_value='T'):
            response = self.open()

        self.assertEqual(response.status_code, 409)

    def test_a_gateway_that_refuses_is_reported_rather_than_swallowed(self):
        from src.apps.payments.onepg import OnePGError

        with mock.patch('src.apps.payments.onepg.process_id',
                        side_effect=OnePGError('Duplicate Record')):
            response = self.open()

        self.assertEqual(response.status_code, 502)
        self.assertIn('Duplicate Record', str(response.data))

    def test_an_unconfigured_deployment_says_so(self):
        with override_settings(NEPALPAYMENT_KEY=''):
            response = self.open()

        self.assertEqual(response.status_code, 503)
        self.assertIn('NEPALPAYMENT_KEY', str(response.data))


@override_settings(**CONFIGURED)
class WhatSettlesAnOrderTests(TestCase):
    def setUp(self):
        self.user = make_host('payer@example.com')
        self.order = PaymentOrder.objects.create(
            order_id='SUB-2026-02', user=self.user,
            amount=Decimal('100.00'), transaction_id='MNCH-ABC',
        )
        self.client = APIClient()

    def notify(self, txn='MNCH-ABC'):
        return self.client.get(f'{API}/notification/', {'MerchantTxnId': txn})

    def test_a_notification_is_believed_only_after_the_gateway_confirms(self):
        with mock.patch('src.apps.payments.onepg.status',
                        return_value=PAID) as asked:
            response = self.notify()

        asked.assert_called_once_with('MNCH-ABC')
        self.assertEqual(response.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, PaymentOrder.Status.SUCCESS)
        self.assertEqual(self.order.transaction_reference, '100000035434')
        self.assertIsNotNone(self.order.paid_at)

    def test_the_gateway_is_answered_in_plain_text(self):
        """It reads the body. HTML would be retried forever."""
        with mock.patch('src.apps.payments.onepg.status', return_value=PAID):
            response = self.notify()

        self.assertEqual(response['Content-Type'].split(';')[0], 'text/plain')
        self.assertEqual(response.content, b'received')

    def test_and_told_the_second_time_that_it_already_was(self):
        with mock.patch('src.apps.payments.onepg.status', return_value=PAID):
            self.notify()
            again = self.notify()

        self.assertEqual(again.content, b'already received')

    def test_a_notification_alone_pays_nothing(self):
        """It carries no amount and no status, and is not authenticated.

        Anybody who knows a transaction id can send one; only
        CheckTransactionStatus decides.
        """
        with mock.patch('src.apps.payments.onepg.status',
                        return_value={**PAID, 'Status': 'Pending'}):
            self.notify()

        self.order.refresh_from_db()
        self.assertEqual(self.order.status, PaymentOrder.Status.PENDING)
        self.assertIsNone(self.order.paid_at)

    def test_a_gateway_that_cannot_be_reached_is_not_acknowledged(self):
        """Saying "received" here would lose the payment silently.

        Unacknowledged, OnePG tries again.
        """
        from src.apps.payments.onepg import OnePGError

        with mock.patch('src.apps.payments.onepg.status',
                        side_effect=OnePGError('timeout')):
            response = self.notify()

        self.assertEqual(response.status_code, 503)
        self.assertNotEqual(response.content, b'received')

    def test_an_unknown_transaction_is_refused_in_plain_text(self):
        response = self.notify(txn='MNCH-NOBODY')

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response['Content-Type'].split(';')[0], 'text/plain')

    def test_a_late_failure_does_not_unpay_a_paid_order(self):
        """The gateway talking about a different attempt."""
        with mock.patch('src.apps.payments.onepg.status', return_value=PAID):
            self.notify()
        with mock.patch('src.apps.payments.onepg.status',
                        return_value={**PAID, 'Status': 'Fail'}):
            self.notify()

        self.order.refresh_from_db()
        self.assertEqual(self.order.status, PaymentOrder.Status.SUCCESS)

    def test_a_failure_is_recorded_for_one_that_never_succeeded(self):
        with mock.patch('src.apps.payments.onepg.status',
                        return_value={**PAID, 'Status': 'Fail'}):
            self.notify()

        self.order.refresh_from_db()
        self.assertEqual(self.order.status, PaymentOrder.Status.FAILED)

    def test_the_customer_coming_back_proves_nothing_either(self):
        """Anybody can open that URL with any transaction id on it."""
        with mock.patch('src.apps.payments.onepg.status',
                        return_value=PAID) as asked:
            response = self.client.get(f'{API}/response/',
                                       {'MerchantTxnId': 'MNCH-ABC'})

        asked.assert_called_once()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], PaymentOrder.Status.SUCCESS)

    def test_the_address_the_old_integration_used_still_answers(self):
        """A gateway already configured with it must not be dropped."""
        with mock.patch('src.apps.payments.onepg.status', return_value=PAID):
            response = self.client.get(f'{API}/callback/',
                                       {'MerchantTxnId': 'MNCH-ABC'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'received')

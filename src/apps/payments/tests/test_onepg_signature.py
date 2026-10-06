"""The signature every OnePG request carries.

HMAC-SHA512 over the payload's values, concatenated in alphabetical
order of their keys, as lower-case hex. Get any part of that wrong and
the gateway answers "invalid signature", which says nothing about which
part.
"""
from django.test import TestCase, override_settings

from src.apps.payments import onepg


class TheDocumentsOwnExampleTests(TestCase):
    """Pinned against the worked example in the integration document.

    The document contradicts itself twice and this is what settles it.
    Its JSON gives MerchantTxnId as "00144900123" while the Value line
    beside it, and the C# comment below that, both hash "0014490123" -
    one digit shorter. And its prose says lower-case hex while the C#
    sample returns ToUpper().

    Reproducing the published hash exactly decides both: the shorter
    id is a typo in the JSON, and the output is lower case.
    """

    EXAMPLE = {
        'MerchantId': '9',
        'MerchantName': 'TestMerchant',
        'Amount': '231.00',
        'MerchantTxnId': '0014490123',
    }
    PUBLISHED = (
        '3817ec0ca32ce100d29e1895363350695ffaaf1cd8845ac1a203adc45dd0263b'
        '09022639dea89250886d52121255a6e9eaa912c38daab99fafa7c903d0ccb90e'
    )

    def test_it_reproduces_the_published_signature(self):
        self.assertEqual(onepg.sign(self.EXAMPLE, 'SecretKey'), self.PUBLISHED)

    def test_the_output_is_lower_case(self):
        signed = onepg.sign(self.EXAMPLE, 'SecretKey')

        self.assertEqual(signed, signed.lower())

    def test_it_is_a_full_sha512_digest(self):
        self.assertEqual(len(onepg.sign(self.EXAMPLE, 'SecretKey')), 128)


class HowThePayloadIsFoldedTests(TestCase):
    def test_the_order_fields_were_written_in_makes_no_difference(self):
        """Alphabetical by key, not however the dict happened to be built."""
        one = {'MerchantName': 'M', 'Amount': '10.00', 'MerchantId': '1'}
        other = {'Amount': '10.00', 'MerchantId': '1', 'MerchantName': 'M'}

        self.assertEqual(onepg.sign(one, 'k'), onepg.sign(other, 'k'))

    def test_the_signature_itself_is_not_signed(self):
        """It is the output. Including it would be circular."""
        payload = {'Amount': '10.00', 'MerchantId': '1'}
        signed = onepg.sign(payload, 'k')

        self.assertEqual(onepg.sign({**payload, 'Signature': signed}, 'k'), signed)

    def test_an_extra_field_changes_it(self):
        """Adding a field anybody forgot to sign must not go unnoticed."""
        base = {'Amount': '10.00', 'MerchantId': '1'}

        self.assertNotEqual(
            onepg.sign(base, 'k'),
            onepg.sign({**base, 'InstrumentCode': 'TEBANK'}, 'k'),
        )

    def test_a_different_secret_changes_it(self):
        payload = {'Amount': '10.00', 'MerchantId': '1'}

        self.assertNotEqual(onepg.sign(payload, 'k'), onepg.sign(payload, 'other'))

    def test_the_amount_is_formatted_before_it_is_signed(self):
        """"100" and "100.00" are different messages.

        Only one of them will match what is sent in the body, so the
        formatting has to happen once, before signing.
        """
        self.assertEqual(onepg.amount_string(100), '100.00')
        self.assertEqual(onepg.amount_string('100'), '100.00')
        self.assertEqual(onepg.amount_string('231.5'), '231.50')


@override_settings(
    NEPALPAYMENT_MERCHANT_ID='5269',
    NEPALPAYMENT_MERCHANT_NAME='saroj01',
    NEPALPAYMENT_API_USERNAME='testapi',
    NEPALPAYMENT_API_PASSWORD='test#2211',
    NEPALPAYMENT_KEY='SecretKey',
    NEPALPAYMENT_CHECKOUT_URL='https://gatewaysandbox.nepalpayment.com/Payment/Index',
)
class TheCheckoutFormTests(TestCase):
    """What the customer's browser posts, and what it must not carry."""

    def form(self, **over):
        return onepg.checkout(
            over.pop('amount', '100'),
            over.pop('txn', 'Trnx UAT1235'),
            over.pop('token', '0E92183C_015D_4D1A_8467_8F11DFB136E0'),
            **over,
        )

    def test_it_carries_every_field_the_gateway_asks_for(self):
        fields = self.form()['payload']

        self.assertEqual(set(fields), {
            'MerchantId', 'MerchantName', 'Amount', 'MerchantTxnId',
            'ProcessId', 'InstrumentCode', 'TransactionRemarks', 'Signature',
        })

    def test_it_never_carries_the_credentials(self):
        """The browser posts this. It has no business holding them."""
        fields = self.form()['payload']

        self.assertNotIn('testapi', str(fields))
        self.assertNotIn('test#2211', str(fields))
        self.assertNotIn('SecretKey', str(fields))

    def test_an_empty_instrument_is_a_real_answer(self):
        """It sends the customer to the gateway's own picker."""
        fields = self.form()['payload']

        self.assertEqual(fields['InstrumentCode'], '')
        self.assertEqual(
            fields['Signature'], onepg.sign(fields, 'SecretKey')
        )

    def test_choosing_an_instrument_changes_the_signature(self):
        without = self.form()['payload']['Signature']
        with_one = self.form(instrument_code='TEBANK')['payload']['Signature']

        self.assertNotEqual(without, with_one)

    def test_the_amount_is_sent_the_way_it_was_signed(self):
        fields = self.form(amount=100)['payload']

        self.assertEqual(fields['Amount'], '100.00')
        self.assertEqual(fields['Signature'], onepg.sign(fields, 'SecretKey'))


class WithoutCredentialsTests(TestCase):
    @override_settings(
        NEPALPAYMENT_MERCHANT_ID='', NEPALPAYMENT_MERCHANT_NAME='',
        NEPALPAYMENT_API_USERNAME='', NEPALPAYMENT_API_PASSWORD='',
        NEPALPAYMENT_KEY='',
    )
    def test_it_refuses_clearly_rather_than_signing_with_nothing(self):
        """An empty secret still produces a hash. It just never matches.

        Which the gateway reports as an invalid signature, sending
        somebody to check their signing code when what is missing is
        the configuration.
        """
        with self.assertRaises(onepg.NotConfigured) as caught:
            onepg.checkout('100', 'TXN1', 'TOKEN')

        self.assertIn('NEPALPAYMENT_MERCHANT_ID', str(caught.exception))
        self.assertIn('NEPALPAYMENT_KEY', str(caught.exception))

"""Nepal Payment Solution's OnePG gateway.

Five calls and a form, in the order the integration document sets out:

    instruments()       which banks and wallets this merchant may use
    service_charge()    what the gateway will add to an amount
    process_id()        a one-use token for this transaction
    checkout()          the form the browser posts to the gateway
    status()            what became of it

Two things are easy to get wrong and are therefore done in one place.

Every request is signed. The signature is HMAC-SHA512 over the payload's
*values*, concatenated in alphabetical order of their *keys* - so the
order the fields happen to be written in makes no difference, and adding
a field changes the signature whether or not anybody remembered to.

And the gateway authenticates the merchant with HTTP Basic, which is a
different credential from the signing secret: the username and password
say who is calling, the secret says the message was not altered on the
way. Sending one where the other belongs fails in a way that reads like
a wrong password.
"""
import base64
import hashlib
import hmac
import logging
from decimal import Decimal

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

#: The gateway answers slowly under load, and a merchant holding a
#: browser open is worse than one saying it could not be reached.
TIMEOUT_SECONDS = 30


class OnePGError(Exception):
    """The gateway refused, or could not be reached."""

    def __init__(self, message, code='', errors=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.errors = errors or []


class NotConfigured(OnePGError):
    """No credentials. A deployment that cannot take payments at all."""


#: The short name this module uses for each value, and the setting it
#: actually comes from. Spelled out rather than derived, because three
#: of the five do not match - and a refusal naming NEPALPAYMENT_SECRET,
#: which does not exist, sends somebody to add a setting that will
#: never be read.
_SETTINGS = {
    'merchant_id': 'NEPALPAYMENT_MERCHANT_ID',
    'merchant_name': 'NEPALPAYMENT_MERCHANT_NAME',
    'username': 'NEPALPAYMENT_API_USERNAME',
    'password': 'NEPALPAYMENT_API_PASSWORD',
    'secret': 'NEPALPAYMENT_KEY',
}


def _config():
    """The five values the gateway issues by email, or a clear refusal."""
    values = {
        name: (getattr(settings, setting, '') or '').strip()
        for name, setting in _SETTINGS.items()
    }
    missing = [_SETTINGS[name] for name, value in values.items() if not value]
    if missing:
        raise NotConfigured(
            'Nepal Payment is not configured: ' + ', '.join(missing)
        )
    return values


def sign(payload: dict, secret: str) -> str:
    """The signature for one request.

    The values, in alphabetical order of their keys, joined with
    nothing between them, hashed with the merchant's secret.

    Alphabetical by key rather than in the order written, so two
    callers building the same payload differently still sign the same
    string. ``Signature`` itself is excluded - it is the output, and
    including it would be circular.

    Lower-case hex. The document says so in prose and shows lower-case
    in every worked example; the C# sample beside them ends in
    ``ToUpper()``, which contradicts both. The examples are the thing
    that can be checked, so they win - and a test pins the document's
    own worked example to make sure.
    """
    ordered = sorted(k for k in payload if k != 'Signature')
    message = ''.join(str(payload[k]) for k in ordered)
    return hmac.new(
        secret.encode('utf-8'), message.encode('utf-8'), hashlib.sha512
    ).hexdigest()


def _authorization(username: str, password: str) -> str:
    raw = f'{username}:{password}'.encode('utf-8')
    return 'Basic ' + base64.b64encode(raw).decode('ascii')


def amount_string(value) -> str:
    """An amount as the gateway wants it: a decimal string, two places.

    It is signed as well as sent, so "100" and "100.00" are different
    messages and only one of them matches. Formatting it once here is
    what keeps the signature and the body agreeing.
    """
    return f'{Decimal(str(value)).quantize(Decimal("0.01"))}'


def _call(path: str, payload: dict) -> dict:
    """One signed, authenticated POST, and the data out of it."""
    config = _config()
    body = dict(payload)
    body['Signature'] = sign(body, config['secret'])

    url = (getattr(settings, 'NEPALPAYMENT_API_URL', '') or '').rstrip('/') + path
    try:
        response = requests.post(
            url,
            json=body,
            headers={
                'Authorization': _authorization(config['username'], config['password']),
                'Content-Type': 'application/json',
            },
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as e:
        raise OnePGError(f'Could not reach the payment gateway: {e}') from e

    try:
        answer = response.json()
    except ValueError:
        raise OnePGError(
            f'The payment gateway answered with something that was not JSON '
            f'({response.status_code})'
        )

    # The gateway reports failure in the body with code "1" and a 200,
    # so the HTTP status alone says almost nothing.
    if str(answer.get('code')) != '0':
        errors = answer.get('errors') or []
        detail = '; '.join(
            str(e.get('error_message') or e) for e in errors
        ) or str(answer.get('message') or 'the gateway refused the request')
        raise OnePGError(detail, code=str(answer.get('code')), errors=errors)

    return answer.get('data') or {}


# -- the calls ---------------------------------------------------------

def instruments() -> list:
    """The banks and wallets this merchant may send a customer to.

    Each carries an ``InstrumentCode``, which is what the checkout form
    takes to send somebody straight to their own bank instead of to the
    gateway's own picker.
    """
    config = _config()
    data = _call('/GetPaymentInstrumentDetails', {
        'MerchantId': config['merchant_id'],
        'MerchantName': config['merchant_name'],
    })
    return data if isinstance(data, list) else []


def service_charge(amount, instrument_code: str) -> dict:
    """What the gateway will add, for this amount through this instrument."""
    config = _config()
    return _call('/GetServiceCharge', {
        'MerchantId': config['merchant_id'],
        'MerchantName': config['merchant_name'],
        'Amount': amount_string(amount),
        'InstrumentCode': instrument_code,
    })


def process_id(amount, merchant_txn_id: str) -> str:
    """A one-use token for this transaction.

    Must be fetched before the browser is sent anywhere: the gateway
    checks it against the merchant and the transaction id before it
    will open a transaction at all.
    """
    config = _config()
    data = _call('/GetProcessId', {
        'MerchantId': config['merchant_id'],
        'MerchantName': config['merchant_name'],
        'Amount': amount_string(amount),
        'MerchantTxnId': merchant_txn_id,
    })
    token = data.get('ProcessId')
    if not token:
        raise OnePGError('The gateway gave no ProcessId')
    return token


def status(merchant_txn_id: str) -> dict:
    """What became of a transaction: Success, Fail or Pending.

    The only answer worth believing. A customer returning to the site,
    and the gateway's own notification, both say only that something
    happened - this says what.
    """
    config = _config()
    return _call('/CheckTransactionStatus', {
        'MerchantId': config['merchant_id'],
        'MerchantName': config['merchant_name'],
        'MerchantTxnId': merchant_txn_id,
    })


def checkout(amount, merchant_txn_id: str, token: str,
             instrument_code: str = '', remarks: str = '') -> dict:
    """The form the browser posts to the gateway.

    Not a call: the customer's own browser has to make this request, so
    what comes back is the address and the fields to post there.

    Signed like everything else, but with no Basic auth - the browser
    has no business holding the merchant's credentials, and the
    document says the headers are not required here.

    An empty ``InstrumentCode`` is meaningful: it sends the customer to
    the gateway's own picker rather than straight to one bank.
    """
    config = _config()
    fields = {
        'MerchantId': config['merchant_id'],
        'MerchantName': config['merchant_name'],
        'Amount': amount_string(amount),
        'MerchantTxnId': merchant_txn_id,
        'ProcessId': token,
        'InstrumentCode': instrument_code or '',
        'TransactionRemarks': remarks or '',
    }
    fields['Signature'] = sign(fields, config['secret'])
    return {
        'gateway_url': (
            getattr(settings, 'NEPALPAYMENT_CHECKOUT_URL', '') or ''
        ).rstrip('/'),
        'payload': fields,
    }

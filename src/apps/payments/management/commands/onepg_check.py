"""Find out why OnePG is refusing, without guessing.

"Signature Not Valid" is the gateway's answer to several different
mistakes, and it names none of them. This walks the possibilities from
the cheapest to the most expensive:

  1. the algorithm, against the document's own worked example - no
     network, no credentials
  2. the configured values, for the things that look right in a .env
     file and are not
  3. the simplest real call there is, which signs two fields

If step 1 passes and step 3 fails, the algorithm is right and a
credential is wrong. That is almost always the answer, and the usual
cause is in step 2.
"""
from django.core.management.base import BaseCommand

from src.apps.payments import onepg


def mask(value: str) -> str:
    if not value:
        return '(empty)'
    if len(value) <= 8:
        return value[0] + '*' * (len(value) - 1)
    return f'{value[:4]}…{value[-4:]}'


#: Things that are invisible in a .env file and change the value.
def suspicious(value: str) -> list:
    notes = []
    if value != value.strip():
        notes.append('has leading or trailing whitespace')
    if '#' in value:
        notes.append('contains "#" - an .env file keeps inline comments, '
                     'so the comment is part of the value')
    if value[:1] in {'"', "'"} or value[-1:] in {'"', "'"}:
        notes.append('is wrapped in quotes, which become part of the value')
    if '\\' in value:
        notes.append('contains a backslash')
    return notes


class Command(BaseCommand):
    help = "Check the Nepal Payment configuration and signing."

    def add_arguments(self, parser):
        parser.add_argument(
            '--call', action='store_true',
            help='Also make a real GetPaymentInstrumentDetails call.',
        )

    def handle(self, *args, **options):
        ok = self.style.SUCCESS
        bad = self.style.ERROR
        warn = self.style.WARNING

        # -- 1. the algorithm ------------------------------------------
        self.stdout.write('\n== The signing algorithm ==')
        example = {
            'MerchantId': '9', 'MerchantName': 'TestMerchant',
            'Amount': '231.00', 'MerchantTxnId': '0014490123',
        }
        published = (
            '3817ec0ca32ce100d29e1895363350695ffaaf1cd8845ac1a203adc45dd0263b'
            '09022639dea89250886d52121255a6e9eaa912c38daab99fafa7c903d0ccb90e'
        )
        got = onepg.sign(example, 'SecretKey')
        if got == published:
            self.stdout.write(ok('   matches the document\'s worked example'))
        else:
            self.stdout.write(bad('   DOES NOT match the document\'s example'))
            self.stdout.write(f'   expected {published}')
            self.stdout.write(f'   produced {got}')
            return

        # -- 2. the configured values ----------------------------------
        self.stdout.write('\n== The configured values ==')
        from django.conf import settings

        raw = {
            name: getattr(settings, setting, '') or ''
            for name, setting in onepg._SETTINGS.items()
        }
        trouble = False
        for name, setting in onepg._SETTINGS.items():
            value = raw[name]
            if not value:
                self.stdout.write(bad(f'   {setting:<28} (not set)'))
                trouble = True
                continue
            notes = suspicious(value)
            line = f'   {setting:<28} {mask(value)}  [{len(value)} chars]'
            if notes:
                trouble = True
                self.stdout.write(warn(line))
                for note in notes:
                    self.stdout.write(warn(f'       ^ {note}'))
            else:
                self.stdout.write(ok(line))

        for setting in ('NEPALPAYMENT_API_URL', 'NEPALPAYMENT_CHECKOUT_URL'):
            self.stdout.write(f'   {setting:<28} {getattr(settings, setting, "")}')

        if trouble:
            self.stdout.write(warn(
                '\n   Fix the above first. The signing key and the API '
                'password are\n   different credentials - sending one where '
                'the other belongs is\n   reported as an invalid signature.'
            ))

        # -- 3. a real call --------------------------------------------
        if not options['call']:
            self.stdout.write(
                '\n   Add --call to try a real GetPaymentInstrumentDetails '
                'request.\n   It signs two fields, so it fails only if a '
                'credential is wrong.\n'
            )
            return

        self.stdout.write('\n== GetPaymentInstrumentDetails ==')
        try:
            found = onepg.instruments()
        except onepg.NotConfigured as e:
            self.stdout.write(bad(f'   {e}'))
            return
        except onepg.OnePGError as e:
            self.stdout.write(bad(f'   refused: {e}'))
            self.stdout.write(warn(
                '\n   Two fields were signed - MerchantId and MerchantName -'
                '\n   so the payload is almost certainly not the problem.'
                '\n   Check, in this order:'
                '\n     * NEPALPAYMENT_KEY is the HMAC secret from the email,'
                '\n       not the API password'
                '\n     * NEPALPAYMENT_MERCHANT_NAME matches the email exactly,'
                '\n       including its case'
                '\n     * NEPALPAYMENT_API_URL points at the environment those'
                '\n       credentials were issued for - sandbox credentials are'
                '\n       refused by the live host, and the other way round'
            ))
            return

        self.stdout.write(ok(f'   accepted - {len(found)} instrument(s)'))
        for one in found[:10]:
            self.stdout.write(
                f"      {one.get('InstrumentCode', ''):<12} "
                f"{one.get('InstitutionName', '')}"
            )
        self.stdout.write(ok(
            '\n   The credentials and the signature are good. If '
            'GetProcessId still\n   refuses, the difference is in that '
            'payload - most likely the Amount\n   format or the '
            'MerchantTxnId.\n'
        ))

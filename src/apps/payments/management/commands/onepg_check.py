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
        parser.add_argument(
            '--process-id', action='store_true',
            help=('Also try GetProcessId with transaction ids of several '
                  'shapes, to find which the gateway will accept.'),
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
        import os
        from pathlib import Path

        from django.conf import settings

        # Which file Django actually read. DJANGO_ENV picks it, and
        # .env is only the fallback - so the file being edited is
        # often not the file in use.
        root = Path(settings.BASE_DIR).parent
        chosen = root / f'.env.{os.environ.get("DJANGO_ENV", "dev")}'
        if not chosen.exists():
            chosen = root / '.env'
        self.stdout.write(
            f'   read from {chosen}'
            + ('' if chosen.exists() else bad('  (does not exist)'))
        )

        # What that file says, as opposed to what Django ended up with.
        # django-environ's read_env uses setdefault, so a variable
        # already exported in the shell silently wins and the file is
        # ignored for it - which looks exactly like the file being
        # wrong when it is not.
        in_file = {}
        if chosen.exists():
            for line in chosen.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, value = line.partition('=')
                in_file[key.strip()] = value

        shadowed = []
        for setting in onepg._SETTINGS.values():
            exported = os.environ.get(setting)
            if exported is not None and setting in in_file \
                    and exported != in_file[setting]:
                shadowed.append(setting)

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

        self.stdout.write(
            f'   {"NEPALPAYMENT_API_URL":<28} {settings.NEPALPAYMENT_API_URL}')

        # The two hosts are easy to confuse and fail in different
        # places: the API one is used by every call above, the gateway
        # one only when the customer's browser is sent off. A wrong
        # gateway url therefore passes every check here and then loses
        # the customer at the last step.
        checkout = getattr(settings, 'NEPALPAYMENT_CHECKOUT_URL', '') or ''
        line = f'   {"NEPALPAYMENT_CHECKOUT_URL":<28} {checkout}'
        if '/Payment/Index' not in checkout:
            trouble = True
            self.stdout.write(warn(line))
            self.stdout.write(warn(
                '       ^ this is where the customer\'s browser posts the '
                'checkout form,\n'
                '         and the document gives it as\n'
                '         https://gatewaysandbox.nepalpayment.com/Payment/Index\n'
                '         (live: https://gateway.nepalpayment.com/Payment/Index).\n'
                '         Nothing above tests it, so a wrong one passes every\n'
                '         check here and loses the customer at the last step.'
            ))
        else:
            self.stdout.write(ok(line))

        if shadowed:
            trouble = True
            self.stdout.write(bad(
                '\n   These are exported in the environment, and differ from '
                'the file:\n     '
                + '\n     '.join(shadowed)
                + '\n\n   The exported value is the one in use. .env is read '
                'with setdefault,\n   so anything already in the shell wins '
                'and the file is ignored for it -\n   which looks exactly '
                'like the file being wrong when it is not, and\n   survives '
                'every restart. Check the shell the server runs in:\n'
                '\n       env | grep NEPALPAYMENT\n'
                '\n   and unset them, or correct them there.'
            ))

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
            '\n   The credentials and the signature are good: this call '
            'signs the\n   merchant id and name, so both are right, and so '
            'is the key.\n'
        ))

        if not options['process_id']:
            self.stdout.write(
                '   Add --process-id to find out what GetProcessId will '
                'accept.\n'
            )
            return

        # -- 4. which transaction id shape it will take ----------------
        #
        # GetProcessId adds exactly two fields to the call above, so if
        # that one works and this does not, it is the Amount or the
        # MerchantTxnId. These vary one thing at a time.
        self.stdout.write('\n== GetProcessId ==')
        import uuid

        stem = uuid.uuid4().hex.upper()
        attempts = [
            ('short, letters and digits', f'MNCH{stem[:8]}', '100.00'),
            ('with a hyphen',             f'MNCH-{stem[:8]}', '100.00'),
            ('the length we generate',    f'MNCH-{stem}', '100.00'),
            ('whole-rupee amount',        f'MNCH{stem[8:16]}', '100'),
        ]
        worked = []
        for label, txn, amount in attempts:
            try:
                onepg.process_id(amount, txn)
            except onepg.OnePGError as e:
                self.stdout.write(bad(
                    f'   {label:<26} {len(txn):>2} chars, '
                    f'Amount={amount:<7} refused: {e}'))
            else:
                worked.append(label)
                self.stdout.write(ok(
                    f'   {label:<26} {len(txn):>2} chars, '
                    f'Amount={amount:<7} accepted'))

        if worked and len(worked) < len(attempts):
            self.stdout.write(warn(
                '\n   The gateway is particular about one of these. '
                'Whatever it\n   accepted above is the shape the '
                'transaction id should take.'
            ))
        elif not worked:
            self.stdout.write(warn(
                '\n   None accepted, though the call above was fine - so '
                'the merchant\n   account may not be enabled for '
                'transactions yet. That is a\n   question for OnePG '
                'support rather than a change here.'
            ))
        self.stdout.write('')

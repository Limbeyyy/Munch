"""Put a host on a plan, without going through a checkout that does not exist yet.

    python manage.py set_host_plan someone@example.com growth
"""
from django.core.management.base import BaseCommand, CommandError

from src.apps.accounts.models import HostAccount, User
from src.apps.accounts.plans import PLANS, plan_for, usage_for


class Command(BaseCommand):
    help = 'Set the plan a host is on (free, starter, growth, business, enterprise).'

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('plan', choices=sorted(PLANS))
        parser.add_argument(
            '--status',
            default=HostAccount.Status.ACTIVE,
            choices=[value for value, _ in HostAccount.Status.choices],
        )

    def handle(self, *args, **options):
        try:
            user = User.objects.get(email__iexact=options['email'])
        except User.DoesNotExist:
            raise CommandError(f"No account for {options['email']}")

        account, _ = HostAccount.objects.get_or_create(user=user)
        account.plan = options['plan']
        account.status = options['status']
        account.save(update_fields=['plan', 'status', 'updated_at'])

        user.refresh_from_db()
        plan = plan_for(user)
        usage = usage_for(user)
        self.stdout.write(self.style.SUCCESS(
            f"{user.email} is on {plan.name} ({account.status}). "
            f"Running {usage['events']} events, {usage['meetings']} meetings, "
            f"{usage['sessions']} sessions."
        ))

"""What a host is allowed to run, and how much of it they have used.

The three numbers a host actually bumps into — how many programmes they may
open, how many events fit in one, how many sessions fit in a event — are
kept here rather than scattered across the views that enforce them. ``None``
means no ceiling.

The free tier is the trial the pricing page advertises: two events, each with
two events, each with two sessions. Paid tiers follow the same page.
"""
from dataclasses import dataclass
from rest_framework import serializers


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    paid: bool
    max_events: int | None
    max_sessions_per_event: int | None
    max_attendees: int | None

    def as_json(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'paid': self.paid,
            'limits': {
                'events': self.max_events,
                'sessions_per_event': self.max_sessions_per_event,
                'attendees': self.max_attendees,
            },
        }


PLANS = {
    plan.id: plan
    for plan in [
        Plan('free', 'Free', False, 4, 2, 100),
        Plan('starter', 'Starter', True, 25, 10, 30),
        Plan('growth', 'Growth', True, 100, 20, 100),
        Plan('business', 'Business', True, 400, 40, 300),
        Plan('enterprise', 'Enterprise', True, None, None, None),
    ]
}

FREE_PLAN = PLANS['free']


def plan_for(user) -> Plan:
    """The plan a host is on. Anyone without a paid, live subscription is free."""
    account = getattr(user, 'host_account', None)
    if account is None or not account.is_current:
        return FREE_PLAN
    return PLANS.get(account.plan, FREE_PLAN)


class QuotaReached(serializers.ValidationError):
    """Raised where DRF will turn it into a 400 the frontend can read."""

    def __init__(self, message, plan):
        super().__init__({
            'detail': message,
            'code': 'quota_reached',
            'plan': plan.id,
            'upgrade': '/pricing',
        })


def _over(used, cap):
    return cap is not None and used >= cap


def check_can_create_event(user):
    from src.apps.meetings.models import Event

    plan = plan_for(user)
    used = Event.objects.filter(host=user).count()
    if _over(used, plan.max_events):
        raise QuotaReached(
            f'The {plan.name} plan covers {plan.max_events} events, and you have '
            f'{used}. Upgrade to open another.',
            plan,
        )


def check_session_count(user, count, event_title='this event'):
    """Check a running order before the event holding it exists."""
    plan = plan_for(user)
    cap = plan.max_sessions_per_event
    if cap is not None and count > cap:
        raise QuotaReached(
            f'The {plan.name} plan allows {cap} sessions in one event, and '
            f'{event_title} lists {count}. Upgrade to run more.',
            plan,
        )


def check_can_add_sessions(user, event, adding=1):
    plan = plan_for(user)
    used = event.sessions.count()
    cap = plan.max_sessions_per_event
    if cap is not None and used + adding > cap:
        raise QuotaReached(
            f'The {plan.name} plan allows {cap} sessions in one event, and '
            f'"{event.title}" has {used}. Upgrade to add more.',
            plan,
        )


def usage_for(user) -> dict:
    """What the host has spent of their allowance, for the dashboard to show."""
    from src.apps.meetings.models import Event, EventInvite, Session

    return {
        'events': Event.objects.filter(host=user).count(),
        'sessions': Session.objects.filter(event__host=user).count(),
        'attendees': EventInvite.objects.filter(event__host=user).count(),
    }

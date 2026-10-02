"""An invitation does not put somebody else's event in your dashboard.

Rahul hosts Emergency Services and invites Prabhat, who hosts his own
programmes too. Prabhat's organizer dashboard listed Rahul's event -
an event he could open, could not change, and had no business being
offered there. It belongs in his attendee app, where the invitation
put him, and in Rahul's dashboard, where it was made.
"""
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from src.apps.accounts import roles as account_roles
from src.apps.meetings.models import EventParticipant, RoleGrant
from src.apps.meetings.tests.factories import make_event, make_host, make_session

User = get_user_model()
EVENTS = '/api/v1/events/'


def titles(answer):
    body = answer.json()
    rows = body['results'] if isinstance(body, dict) else body
    return [r['title'] for r in rows]


class TwoHostsTests(APITestCase):
    def setUp(self):
        self.rahul = make_host('rahul@gmail.com')
        self.prabhat = make_host('prabhat@gmail.com')

        self.theirs = make_event(self.rahul, title='Emergency Services')
        self.theirs.invites.create(email='prabhat@gmail.com')

        self.mine = make_event(self.prabhat, title='Prabhat Own Day')

        self.client.force_authenticate(self.prabhat)

    def as_host(self):
        return titles(self.client.get(EVENTS, {'as': 'host'}))

    def as_attendee(self):
        return titles(self.client.get(EVENTS, {'as': 'attendee'}))

    # --- the bug ------------------------------------------------------

    def test_an_invitation_does_not_reach_the_host_dashboard(self):
        self.assertEqual(self.as_host(), ['Prabhat Own Day'])

    def test_it_reaches_the_attendee_app_instead(self):
        self.assertEqual(self.as_attendee(), ['Emergency Services'])

    def test_the_owner_still_has_it_in_theirs(self):
        self.client.force_authenticate(self.rahul)

        self.assertEqual(self.as_host(), ['Emergency Services'])

    def test_the_details_are_refused_to_the_host_portal_too(self):
        answer = self.client.get(f'{EVENTS}{self.theirs.id}/', {'as': 'host'})

        self.assertEqual(answer.status_code, 404)

    # --- what still belongs there -------------------------------------

    def test_a_co_host_runs_it_and_so_sees_it(self):
        RoleGrant.objects.create(
            event=self.theirs, email='prabhat@gmail.com',
            role=RoleGrant.Role.CO_HOST, granted_by=self.rahul,
        )

        self.assertIn('Emergency Services', self.as_host())

    def test_and_a_co_host_by_participant_row(self):
        EventParticipant.objects.create(
            event=self.theirs, user=self.prabhat,
            role=EventParticipant.Role.CO_HOST, is_active=True,
        )

        self.assertIn('Emergency Services', self.as_host())

    def test_walking_into_the_room_does_not_make_it_yours_to_run(self):
        """The ordinary case: he accepts the invitation and turns up.

        Joining writes a participant row, and a participant row that
        says nothing about the role would put the event straight back
        into his dashboard.
        """
        EventParticipant.objects.create(
            event=self.theirs, user=self.prabhat,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )

        self.assertEqual(self.as_host(), ['Prabhat Own Day'])
        self.assertIn('Emergency Services', self.as_attendee())

    def test_nor_does_presenting_at_one(self):
        EventParticipant.objects.create(
            event=self.theirs, user=self.prabhat,
            role=EventParticipant.Role.PRESENTER, is_active=True,
        )

        self.assertEqual(self.as_host(), ['Prabhat Own Day'])

    def test_speaking_at_one_does_not_make_it_yours_to_run(self):
        """A speaker is on the programme, not behind it."""
        make_session(
            self.theirs, self.theirs.scheduled_start, 60, 'Opening',
        )
        self.theirs.sessions.update(speaker_email='prabhat@gmail.com')

        self.assertEqual(self.as_host(), ['Prabhat Own Day'])
        self.assertIn('Emergency Services', self.as_attendee())

    def test_a_presenter_grant_does_not_either(self):
        RoleGrant.objects.create(
            event=self.theirs, email='prabhat@gmail.com',
            role=RoleGrant.Role.PRESENTER, granted_by=self.rahul,
        )

        self.assertEqual(self.as_host(), ['Prabhat Own Day'])

    def test_a_stranger_s_event_is_in_neither(self):
        other = make_host('hari@example.com')
        make_event(other, title='Private Briefing')

        self.assertNotIn('Private Briefing', self.as_host())
        self.assertNotIn('Private Briefing', self.as_attendee())

    # --- and the portals offered --------------------------------------

    def test_being_invited_still_makes_them_an_attendee(self):
        self.assertTrue(account_roles.is_attendee(self.prabhat))
        self.assertIn('attendee', account_roles.portals_for(self.prabhat))

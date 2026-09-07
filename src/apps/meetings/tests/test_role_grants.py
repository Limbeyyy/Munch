"""How far a role reaches, and where it stops.

The rule being protected is that a role reaches exactly what it was given
over. A co-host of one meeting is nobody in the next one, and being asked
to present a single talk does not put somebody in charge of the morning.
"""
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import MeetingParticipant, RoleGrant, Session
from src.apps.meetings.roles import (
    CO_HOST, PRESENTER, claim_grants, is_co_host, participant_role_for,
    roles_in_meeting, roles_in_session,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class ScopeTests(TestCase):
    """A programme with two meetings, two sessions each."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.helper = make_host('helper@example.com')
        self.event = make_event(self.host)
        start = timezone.now() + timezone.timedelta(days=1)

        self.morning = make_meeting(self.host, self.event, start=start, title='Morning')
        self.evening = make_meeting(
            self.host, self.event, start=start + timezone.timedelta(hours=6),
            title='Evening',
        )
        self.opening = make_session(self.morning, start, 60, 'Opening')
        self.second = make_session(
            self.morning, start + timezone.timedelta(minutes=75), 60, 'Second'
        )
        self.keynote = make_session(
            self.evening, start + timezone.timedelta(hours=6), 60, 'Keynote'
        )

    # --- an event-scoped role covers everything inside it ------------------

    def test_an_event_co_host_covers_every_meeting(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.event
        )

        self.assertTrue(is_co_host(self.morning, self.helper))
        self.assertTrue(is_co_host(self.evening, self.helper))

    def test_an_event_co_host_covers_every_session(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.event
        )

        for session in (self.opening, self.second, self.keynote):
            self.assertIn(CO_HOST, roles_in_session(session, user=self.helper))

    def test_it_stops_at_the_edge_of_that_programme(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.event
        )
        elsewhere = make_meeting(self.host, make_event(self.host), title='Another day')

        self.assertFalse(is_co_host(elsewhere, self.helper))

    # --- a meeting-scoped role covers that meeting only --------------------

    def test_a_meeting_co_host_covers_its_own_sessions(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, meeting=self.morning
        )

        self.assertTrue(is_co_host(self.morning, self.helper))
        self.assertIn(CO_HOST, roles_in_session(self.opening, user=self.helper))
        self.assertIn(CO_HOST, roles_in_session(self.second, user=self.helper))

    def test_a_meeting_co_host_is_nobody_in_the_next_meeting(self):
        # The rule this whole model exists for.
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, meeting=self.morning
        )

        self.assertFalse(is_co_host(self.evening, self.helper))
        self.assertEqual(roles_in_session(self.keynote, user=self.helper), set())

    def test_being_named_again_is_what_extends_it(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, meeting=self.morning
        )
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, meeting=self.evening
        )

        self.assertTrue(is_co_host(self.evening, self.helper))

    # --- a session-scoped role covers one session only ---------------------

    def test_a_session_role_reaches_that_session(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=PRESENTER, session=self.opening
        )

        self.assertIn(PRESENTER, roles_in_session(self.opening, user=self.helper))

    def test_a_session_role_does_not_reach_its_neighbour(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=PRESENTER, session=self.opening
        )

        self.assertEqual(roles_in_session(self.second, user=self.helper), set())

    def test_a_session_co_host_does_not_run_the_meeting(self):
        # Helping with one talk is not the same as helping run the morning.
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, session=self.opening
        )

        self.assertIn(CO_HOST, roles_in_session(self.opening, user=self.helper))
        self.assertFalse(is_co_host(self.morning, self.helper))

    # --- speakers, and the host ------------------------------------------

    def test_a_session_speaker_is_its_presenter_without_a_grant(self):
        self.opening.speaker_email = self.helper.email
        self.opening.save(update_fields=['speaker_email'])

        self.assertIn(PRESENTER, roles_in_session(self.opening, user=self.helper))
        self.assertEqual(RoleGrant.objects.count(), 0)

    def test_speaking_at_one_session_says_nothing_about_another(self):
        self.opening.speaker_email = self.helper.email
        self.opening.save(update_fields=['speaker_email'])

        self.assertEqual(roles_in_session(self.second, user=self.helper), set())

    def test_the_host_is_the_host_everywhere_in_their_programme(self):
        self.assertEqual(roles_in_meeting(self.morning, user=self.host), {'host'})
        self.assertEqual(roles_in_session(self.keynote, user=self.host), {'host'})

    # --- addresses and accounts -------------------------------------------

    def test_a_role_can_be_given_before_they_have_an_account(self):
        RoleGrant.objects.create(
            email='stranger@example.com', role=CO_HOST, meeting=self.morning
        )

        self.assertTrue(is_co_host(self.morning, None) is False)
        self.assertIn(
            CO_HOST, roles_in_meeting(self.morning, email='stranger@example.com')
        )

    def test_signing_in_ties_the_account_to_the_grant(self):
        grant = RoleGrant.objects.create(
            email='LATER@example.com', role=CO_HOST, meeting=self.morning
        )
        arriving = make_host('later@example.com')

        claim_grants(arriving)

        grant.refresh_from_db()
        self.assertEqual(grant.user_id, arriving.id)
        self.assertTrue(is_co_host(self.morning, arriving))

    def test_the_same_role_cannot_be_given_twice_over_one_thing(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, meeting=self.morning
        )

        with self.assertRaises(IntegrityError), transaction.atomic():
            RoleGrant.objects.create(
                email=self.helper.email, role=CO_HOST, meeting=self.morning
            )

    def test_a_grant_must_name_exactly_one_scope(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            RoleGrant.objects.create(
                email=self.helper.email, role=CO_HOST,
                meeting=self.morning, session=self.opening,
            )


class JoiningTests(TestCase):
    """The role follows the person into the room."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.helper = make_host('helper@example.com')
        self.stranger = make_host('stranger@example.com')
        self.event = make_event(self.host)
        self.meeting = make_meeting(self.host, self.event, start=timezone.now())
        make_session(self.meeting, timezone.now(), 60)

    def test_a_named_co_host_arrives_as_one(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, meeting=self.meeting
        )

        signed_in(self.helper).post(f'{API}/meetings/{self.meeting.id}/join/')

        self.assertEqual(
            MeetingParticipant.objects.get(meeting=self.meeting, user=self.helper).role,
            MeetingParticipant.Role.CO_HOST,
        )

    def test_everybody_else_still_arrives_as_an_attendee(self):
        signed_in(self.stranger).post(f'{API}/meetings/{self.meeting.id}/join/')

        self.assertEqual(
            MeetingParticipant.objects.get(meeting=self.meeting, user=self.stranger).role,
            MeetingParticipant.Role.ATTENDEE,
        )

    def test_the_owner_still_arrives_as_the_host(self):
        self.assertEqual(
            participant_role_for(self.meeting, self.host), MeetingParticipant.Role.HOST
        )

    def test_a_co_host_may_see_what_organizers_see(self):
        from src.apps.artifacts.visibility import can_organize

        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, meeting=self.meeting
        )

        # Without having walked into the room: being named is enough.
        self.assertTrue(can_organize(self.meeting, self.helper))
        self.assertFalse(can_organize(self.meeting, self.stranger))


class RolesEndpointTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.other = make_host('other@example.com')
        self.event = make_event(self.host)
        start = timezone.now() + timezone.timedelta(days=1)
        self.meeting = make_meeting(self.host, self.event, start=start, title='Morning')
        self.session = make_session(self.meeting, start, 60, 'Opening')
        self.client = signed_in(self.host)

    def give(self, **body):
        return self.client.post(f'{API}/events/{self.event.id}/roles/', body, format='json')

    def test_a_co_host_can_be_named_for_the_whole_event(self):
        response = self.give(email='helper@example.com', role='co_host', scope='event')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['scope'], 'event')

    def test_a_co_host_can_be_named_for_one_meeting(self):
        response = self.give(
            email='helper@example.com', role='co_host',
            scope='meeting', scope_id=str(self.meeting.id),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['scope_title'], 'Morning')

    def test_a_presenter_can_be_named_for_one_session(self):
        response = self.give(
            email='helper@example.com', role='presenter',
            scope='session', scope_id=str(self.session.id),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['scope'], 'session')

    def test_naming_the_same_person_twice_is_not_an_error(self):
        self.give(email='helper@example.com', role='co_host', scope='event')
        again = self.give(email='helper@example.com', role='co_host', scope='event')

        self.assertEqual(again.status_code, 200)
        self.assertEqual(RoleGrant.objects.filter(event=self.event).count(), 1)

    def test_a_meeting_from_another_programme_is_refused(self):
        elsewhere = make_meeting(self.host, make_event(self.host))

        response = self.give(
            email='helper@example.com', role='co_host',
            scope='meeting', scope_id=str(elsewhere.id),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(RoleGrant.objects.count(), 0)

    def test_an_unknown_role_is_refused(self):
        response = self.give(email='helper@example.com', role='owner', scope='event')

        self.assertEqual(response.status_code, 400)

    def test_the_list_shows_the_grants_and_the_speakers(self):
        self.session.speaker_name = 'A Speaker'
        self.session.speaker_email = 'speaker@example.com'
        self.session.save()
        self.give(email='helper@example.com', role='co_host', scope='event')

        body = self.client.get(f'{API}/events/{self.event.id}/roles/').json()

        self.assertEqual(len(body['granted']), 1)
        self.assertEqual(body['speakers'][0]['email'], 'speaker@example.com')
        self.assertEqual(body['speakers'][0]['sessions'][0]['title'], 'Opening')

    def test_a_role_can_be_taken_away(self):
        given = self.give(email='helper@example.com', role='co_host', scope='event').json()

        response = self.client.delete(
            f'{API}/events/{self.event.id}/roles/', {'id': given['id']}, format='json'
        )

        self.assertEqual(response.status_code, 204)
        self.assertEqual(RoleGrant.objects.count(), 0)

    def test_only_the_organizer_sets_the_roles(self):
        response = signed_in(self.other).post(
            f'{API}/events/{self.event.id}/roles/',
            {'email': 'helper@example.com', 'role': 'co_host', 'scope': 'event'},
            format='json',
        )

        self.assertIn(response.status_code, (403, 404))
        self.assertEqual(RoleGrant.objects.count(), 0)

    def test_a_co_host_cannot_hand_out_roles(self):
        RoleGrant.objects.create(
            email=self.other.email, role=CO_HOST, event=self.event
        )

        response = signed_in(self.other).post(
            f'{API}/events/{self.event.id}/roles/',
            {'email': 'friend@example.com', 'role': 'co_host', 'scope': 'event'},
            format='json',
        )

        self.assertIn(response.status_code, (403, 404))

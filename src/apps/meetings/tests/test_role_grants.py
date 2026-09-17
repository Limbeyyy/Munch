"""How far a role reaches, and where it stops.

The rule being protected is that a role reaches exactly what it was given
over. A co-host of one event is nobody in the next one, and being asked
to present a single talk does not put somebody in charge of the morning.
"""
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from src.apps.accounts.tokens import issue_tokens
from src.apps.meetings.models import EventParticipant, RoleGrant, Session
from src.apps.meetings.roles import (
    CO_HOST, PRESENTER, claim_grants, is_co_host, participant_role_for,
    roles_in_event, roles_in_session,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_session,
)

API = '/api/v1'


def signed_in(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens(user)['access']}")
    return client


class ScopeTests(TestCase):
    """Two events, with sessions inside them."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.helper = make_host('helper@example.com')
        start = timezone.now() + timezone.timedelta(days=1)

        self.morning = make_event(self.host, start=start, title='Morning')
        self.evening = make_event(self.host, start=start + timezone.timedelta(hours=6),
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

    def test_an_event_co_host_covers_every_session_in_it(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.morning
        )

        for session in (self.opening, self.second):
            self.assertIn(CO_HOST, roles_in_session(session, user=self.helper))

    def test_it_stops_at_the_edge_of_that_event(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.morning
        )
        elsewhere = make_event(self.host, title='Another day')

        self.assertFalse(is_co_host(elsewhere, self.helper))

    def test_an_event_co_host_covers_its_own_sessions(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.morning
        )

        self.assertTrue(is_co_host(self.morning, self.helper))
        self.assertIn(CO_HOST, roles_in_session(self.opening, user=self.helper))
        self.assertIn(CO_HOST, roles_in_session(self.second, user=self.helper))

    def test_an_event_co_host_is_nobody_at_the_next_event(self):
        # The rule this whole model exists for.
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.morning
        )

        self.assertFalse(is_co_host(self.evening, self.helper))
        self.assertEqual(roles_in_session(self.keynote, user=self.helper), set())

    def test_being_named_again_is_what_extends_it(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.morning
        )
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.evening
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

    def test_a_session_co_host_does_not_run_the_event(self):
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
        self.assertEqual(roles_in_event(self.morning, user=self.host), {'host'})
        self.assertEqual(roles_in_session(self.keynote, user=self.host), {'host'})

    # --- addresses and accounts -------------------------------------------

    def test_a_role_can_be_given_before_they_have_an_account(self):
        RoleGrant.objects.create(
            email='stranger@example.com', role=CO_HOST, event=self.morning
        )

        self.assertTrue(is_co_host(self.morning, None) is False)
        self.assertIn(
            CO_HOST, roles_in_event(self.morning, email='stranger@example.com')
        )

    def test_signing_in_ties_the_account_to_the_grant(self):
        grant = RoleGrant.objects.create(
            email='LATER@example.com', role=CO_HOST, event=self.morning
        )
        arriving = make_host('later@example.com')

        claim_grants(arriving)

        grant.refresh_from_db()
        self.assertEqual(grant.user_id, arriving.id)
        self.assertTrue(is_co_host(self.morning, arriving))

    def test_the_same_role_cannot_be_given_twice_over_one_thing(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.morning
        )

        with self.assertRaises(IntegrityError), transaction.atomic():
            RoleGrant.objects.create(
                email=self.helper.email, role=CO_HOST, event=self.morning
            )

    def test_a_grant_must_name_exactly_one_scope(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            RoleGrant.objects.create(
                email=self.helper.email, role=CO_HOST,
                event=self.morning, session=self.opening,
            )


class JoiningTests(TestCase):
    """The role follows the person into the room."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.helper = make_host('helper@example.com')
        self.stranger = make_host('stranger@example.com')
        self.event = make_event(self.host, start=timezone.now())
        make_session(self.event, timezone.now(), 60)

    def test_a_named_co_host_arrives_as_one(self):
        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.event
        )

        signed_in(self.helper).post(f'{API}/events/{self.event.id}/join/')

        self.assertEqual(
            EventParticipant.objects.get(event=self.event, user=self.helper).role,
            EventParticipant.Role.CO_HOST,
        )

    def test_everybody_else_still_arrives_as_an_attendee(self):
        signed_in(self.stranger).post(f'{API}/events/{self.event.id}/join/')

        self.assertEqual(
            EventParticipant.objects.get(event=self.event, user=self.stranger).role,
            EventParticipant.Role.ATTENDEE,
        )

    def test_the_owner_still_arrives_as_the_host(self):
        self.assertEqual(
            participant_role_for(self.event, self.host), EventParticipant.Role.HOST
        )

    def test_a_co_host_may_see_what_organizers_see(self):
        from src.apps.artifacts.visibility import can_organize

        RoleGrant.objects.create(
            email=self.helper.email, role=CO_HOST, event=self.event
        )

        # Without having walked into the room: being named is enough.
        self.assertTrue(can_organize(self.event, self.helper))
        self.assertFalse(can_organize(self.event, self.stranger))


class RolesEndpointTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.other = make_host('other@example.com')
        start = timezone.now() + timezone.timedelta(days=1)
        self.event = make_event(self.host, start=start, title='Morning')
        self.session = make_session(self.event, start, 60, 'Opening')
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
            scope='event', scope_id=str(self.event.id),
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

    def test_a_session_from_another_event_is_refused(self):
        # The scope has to sit inside the event being edited, or a session
        # id from somebody else's day could be smuggled through.
        elsewhere = make_event(self.host)
        theirs = make_session(elsewhere, timezone.now(), 30, 'Not yours')

        response = self.give(
            email='helper@example.com', role='presenter',
            scope='session', scope_id=str(theirs.id),
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

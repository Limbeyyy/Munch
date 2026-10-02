"""Somebody who sat through the event is not absent from it.

An invitation carries a stamp saying it was taken up. Nothing wrote
that stamp when an invited person joined - it was only ever written
the other way round, when somebody already in the room was invited
afterwards - so the ordinary case left the invitation looking
unanswered and the attendance report called them a no-show.
"""
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from src.apps.meetings.models import Event, EventParticipant
from src.apps.meetings.services.participant_service import ParticipantService
from src.apps.meetings.tests.factories import make_event, make_host

User = get_user_model()
API = '/api/v1'


class WhoCameTests(APITestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(hours=2)
        self.event = make_event(self.host, start=start, minutes=180)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()

        self.them = User.objects.create_user(
            username='them', email='tithighadi@gmail.com', password='pw',
        )
        self.invite = self.event.invites.create(email='tithighadi@gmail.com')

    def report(self):
        self.client.force_authenticate(self.host)
        answer = self.client.get(f'{API}/events/{self.event.id}/attendance/')
        self.assertEqual(answer.status_code, 200, answer.content)
        return answer.json()

    def join(self):
        ParticipantService.add_participant(
            str(self.event.id), str(self.them.id), role='attendee'
        )

    # --- before they come ---------------------------------------------

    def test_an_invitation_nobody_took_up_is_a_no_show(self):
        body = self.report()

        self.assertEqual(
            [r['email'] for r in body['did_not_attend']], ['tithighadi@gmail.com']
        )

    # --- after they come ----------------------------------------------

    def test_somebody_who_joined_is_not_called_absent(self):
        self.join()

        body = self.report()

        self.assertEqual(body['did_not_attend'], [])

    def test_they_are_counted_among_those_who_came(self):
        self.join()

        body = self.report()

        self.assertEqual(body['invited_who_attended'], 1)
        self.assertEqual(body['invited_who_did_not'], 0)

    def test_joining_marks_the_invitation_taken_up(self):
        self.join()

        self.invite.refresh_from_db()
        self.assertIsNotNone(self.invite.joined_at)

    def test_and_they_appear_on_the_register(self):
        self.join()

        body = self.report()

        self.assertIn(
            'tithighadi@gmail.com', [r['email'] for r in body['attended']]
        )

    def test_the_report_is_right_even_where_the_stamp_was_never_written(self):
        """Rows already in the database were never stamped at all."""
        EventParticipant.objects.create(
            event=self.event, user=self.them,
            role=EventParticipant.Role.ATTENDEE, is_active=True,
        )
        self.invite.joined_at = None
        self.invite.save(update_fields=['joined_at'])

        body = self.report()

        self.assertEqual(body['did_not_attend'], [])
        self.assertEqual(body['invited_who_attended'], 1)

    # --- through the door the room actually uses ----------------------

    def test_joining_through_the_endpoint_puts_them_in_the_room(self):
        """What the rooms call, rather than the service behind it.

        The phone used to call nothing at all - only the desktop room
        announced itself - so somebody who sat through the whole event
        was in neither the participants panel nor the register.
        """
        self.client.force_authenticate(self.them)
        answer = self.client.post(f'{API}/events/{self.event.id}/join/', {})
        self.assertIn(answer.status_code, (200, 201), answer.content)

        self.client.force_authenticate(self.host)
        people = self.client.get(
            f'{API}/events/{self.event.id}/participants/'
        ).json()
        rows = people['results'] if isinstance(people, dict) else people

        here = [r for r in rows if r.get('user_email') == 'tithighadi@gmail.com'
                or (r.get('user') or {}).get('email') == 'tithighadi@gmail.com']
        self.assertTrue(here, f'not among {rows}')

    def test_joining_through_the_endpoint_stamps_the_invitation(self):
        """Belt as well as braces.

        The report reads the participant rows too, so either of these
        alone would get the answer right. They are pinned separately
        because redundancy that nothing checks is just two things that
        can quietly stop working one at a time.
        """
        self.client.force_authenticate(self.them)
        self.client.post(f'{API}/events/{self.event.id}/join/', {})

        self.invite.refresh_from_db()
        self.assertIsNotNone(self.invite.joined_at)
        self.assertEqual(self.invite.joined_user, self.them)

    def test_and_on_the_register(self):
        self.client.force_authenticate(self.them)
        self.client.post(f'{API}/events/{self.event.id}/join/', {})

        body = self.report()

        self.assertEqual(body['did_not_attend'], [])
        self.assertIn(
            'tithighadi@gmail.com', [r['email'] for r in body['attended']]
        )

    def test_leaving_does_not_take_them_off_the_register(self):
        """They came. Going home later does not undo that."""
        self.client.force_authenticate(self.them)
        self.client.post(f'{API}/events/{self.event.id}/join/', {})
        self.client.post(f'{API}/events/{self.event.id}/leave/', {})

        body = self.report()

        self.assertEqual(body['did_not_attend'], [])
        self.assertIn(
            'tithighadi@gmail.com', [r['email'] for r in body['attended']]
        )

    def test_but_it_does_take_them_out_of_the_room(self):
        self.client.force_authenticate(self.them)
        self.client.post(f'{API}/events/{self.event.id}/join/', {})
        self.client.post(f'{API}/events/{self.event.id}/leave/', {})

        body = self.report()

        mine = next(
            r for r in body['attended']
            if r['email'] == 'tithighadi@gmail.com'
        )
        self.assertFalse(mine['is_active'])

    def test_somebody_else_s_absence_is_still_reported(self):
        self.event.invites.create(email='nobody@example.com')
        self.join()

        body = self.report()

        self.assertEqual(
            [r['email'] for r in body['did_not_attend']], ['nobody@example.com']
        )

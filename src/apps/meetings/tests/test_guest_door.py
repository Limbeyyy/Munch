"""Who is turned away at the guest door.

An address identifies exactly one account, so somebody typing one at a door
that asks for no proof is either signing in under their own name the long
way round or borrowing somebody else's. Both are refused.
"""
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from src.apps.accounts.models import User
from src.apps.meetings.models import GuestAttendee, Event, Session
from src.apps.meetings.tests.factories import make_host, make_event, make_session

API = '/api/v1'


class GuestDoorTests(TestCase):
    def setUp(self):
        # Knocking is rate limited per address, and the counter lives in the
        # cache rather than the database - so it survives a test's rollback
        # and would otherwise leak into whatever runs next.
        cache.clear()
        self.addCleanup(cache.clear)

        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        self.session = make_session(self.event, start, 60, 'Haldi')

    def knock(self, name, phone='9812345678'):
        return self.client.post(
            f'{API}/events/guest/knock/',
            {
                'code': self.event.code,
                'full_name': name,
                'phone': phone,
            },
            content_type='application/json',
        )

    def test_a_plain_guest_is_let_in(self):
        response = self.knock('Bishnu Prasad')

        self.assertEqual(response.status_code, 201)

    def test_an_account_holders_address_is_refused(self):
        User.objects.create(
            email='sabina@example.org', username='sabina',
            google_subject='google-123', is_verified=True,
        )

        response = self.knock('sabina@example.org')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'account_must_sign_in')
        self.assertTrue(response.json()['signs_in_with_google'])

    def test_the_case_of_the_address_makes_no_difference(self):
        User.objects.create(
            email='sabina@example.org', username='sabina', google_subject='g-1',
        )

        response = self.knock('  SABINA@Example.ORG ')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'account_must_sign_in')

    def test_a_google_account_is_recognised_by_its_connection_too(self):
        # Real accounts here have the OAuth connection but no subject on
        # the user row, so reading only the column tells them to sign in
        # with a password they have never had.
        from django.utils import timezone

        from src.apps.accounts.models import GoogleConnection

        holder = User.objects.create(email='sabina@example.org', username='sabina')
        connection = GoogleConnection.objects.create(
            user=holder, provider_subject='google-456',
            token_expiry=timezone.now() + timezone.timedelta(hours=1),
        )
        connection.access_token = 'access'
        connection.save()

        response = self.knock('sabina@example.org')

        self.assertEqual(response.status_code, 403)
        self.assertTrue(response.json()['signs_in_with_google'])

    def test_an_account_without_google_is_told_to_sign_in_all_the_same(self):
        User.objects.create(email='ram@example.org', username='ram')

        response = self.knock('ram@example.org')

        self.assertEqual(response.status_code, 403)
        self.assertFalse(response.json()['signs_in_with_google'])

    def test_nobody_is_seated_by_the_attempt(self):
        User.objects.create(email='sabina@example.org', username='sabina')

        self.knock('sabina@example.org')

        self.assertFalse(GuestAttendee.objects.filter(event=self.event).exists())

    def test_an_admitted_guest_row_is_no_way_around_it(self):
        # The refusal comes before the returning-guest lookup, so a row from
        # before the rule existed cannot be used to walk back in.
        User.objects.create(email='sabina@example.org', username='sabina')
        GuestAttendee.objects.create(
            event=self.event, full_name='sabina@example.org',
            phone='9812345678', status=GuestAttendee.Status.ADMITTED,
        )

        response = self.knock('sabina@example.org')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'account_must_sign_in')

    def test_a_stranger_with_an_address_nobody_holds_is_let_in(self):
        # Only an address that belongs to an account is refused; a typo in
        # the name box is not grounds for turning somebody away.
        response = self.knock('nobody@example.org')

        self.assertEqual(response.status_code, 201)

    def test_a_presenter_is_still_told_about_presenting(self):
        # The more specific refusal wins: a presenter needs to know that
        # presenting is what requires the account, not merely that one
        # exists.
        User.objects.create(
            email='speaker@example.com', username='speaker', google_subject='g-2',
        )

        response = self.knock('speaker@example.com')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'presenter_must_sign_in')


class GuestRoomStatusTests(TestCase):
    """What a guest's room is told about the day it is part of.

    A guest sits in the same room as everybody else now, so they read the
    same running order - the talks, their speakers, their times, moving as
    the host moves them. To read only: nothing here lets a guest change
    anything, and nothing private is in it. The speaker's name and hall are
    on the wall of the venue; their address and telephone number are not,
    and are not here either.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        self.first = make_session(self.event, start, 60, 'Haldi')
        self.second = make_session(
            self.event, start + timezone.timedelta(minutes=75), 30, 'Mehendi'
        )
        self.guest = GuestAttendee.objects.create(
            event=self.event, full_name='Bishnu Prasad', phone='9812345678',
            status=GuestAttendee.Status.ADMITTED,
        )

    def status(self):
        from src.apps.meetings.guest_tokens import make_guest_token

        token = make_guest_token(self.guest)
        return self.client.get(f'{API}/events/guest/status/?token={token}').json()

    def test_the_running_order_comes_with_it(self):
        event = self.status()['event']

        self.assertEqual(
            [s['title'] for s in event['sessions']], ['Haldi', 'Mehendi']
        )

    def test_with_the_times_the_room_is_working_to(self):
        event = self.status()['event']

        self.assertEqual(
            event['sessions'][0]['starts_at'], self.first.starts_at.isoformat()
        )
        self.assertEqual(event['sessions'][0]['duration_minutes'], 60)
        self.assertEqual(
            event['scheduled_start'], self.event.scheduled_start.isoformat()
        )

    def test_and_the_speakers_address_does_not(self):
        event = self.status()['event']

        for session in event['sessions']:
            self.assertNotIn('speaker_email', session)
            self.assertNotIn('speaker_phone', session)
            self.assertNotIn('speaker_contact', session)

    def test_somebody_who_is_not_in_the_room_is_told_nothing(self):
        response = self.client.get(f'{API}/events/guest/status/?token=made-up')

        self.assertEqual(response.status_code, 401)


class GuestsAreNotKeptTests(TestCase):
    """A guest is a name at a door for one afternoon, and nothing after it.

    They give a name - not a telephone number, which was collected because
    the form had a box for it and used for nothing - and their row lasts as
    long as the event. What outlives the event is the register: the
    name, against what they attended. Nothing that can be joined to
    anything, because there is no guest to look up.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        self.session = make_session(self.event, start, 60, 'Haldi')

    def knock(self, name, **extra):
        return self.client.post(
            f'{API}/events/guest/knock/',
            {'code': self.event.code, 'full_name': name, **extra},
            content_type='application/json',
        )

    def admit(self, guest):
        from src.apps.meetings.lifecycle import record_guest_attendance

        guest.status = GuestAttendee.Status.ADMITTED
        guest.decided_at = timezone.now()
        guest.save()
        record_guest_attendance(self.event, guest.full_name, guest.decided_at)
        return guest

    def end_it(self):
        from src.apps.meetings.services.event_service import EventService

        EventService.end_event(self.event.id)
        self.event.refresh_from_db()

    # -- what is asked for ------------------------------------------------

    def test_a_name_is_all_that_is_asked_for(self):
        response = self.knock('Bishnu Prasad')

        self.assertEqual(response.status_code, 201)
        guest = GuestAttendee.objects.get(event=self.event)
        self.assertEqual(guest.full_name, 'Bishnu Prasad')
        self.assertEqual(guest.phone, '')

    def test_a_number_sent_by_an_older_client_is_ignored_not_refused(self):
        response = self.knock('Bishnu Prasad', phone='9812345678')

        self.assertEqual(response.status_code, 201)

    def test_a_name_too_short_to_be_one_is_refused(self):
        self.assertEqual(self.knock('B').status_code, 400)

    # -- coming back ------------------------------------------------------

    def test_the_token_they_hold_gets_them_back_to_their_seat(self):
        from src.apps.meetings.guest_tokens import make_guest_token

        guest = self.admit(GuestAttendee.objects.create(
            event=self.event, full_name='Bishnu Prasad',
        ))

        response = self.knock('Bishnu Prasad', token=make_guest_token(guest))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['rejoined'])

    def test_a_name_alone_does_not_walk_in_on_somebody_elses_approval(self):
        # The old rule looked guests up by what they typed, so anybody who
        # knew an admitted guest's details was admitted as them. A name is
        # not a credential.
        self.admit(GuestAttendee.objects.create(
            event=self.event, full_name='Bishnu Prasad',
        ))

        response = self.knock('Bishnu Prasad')

        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()['rejoined'])
        self.assertEqual(response.json()['guest']['status'], 'pending')

    # -- and afterwards ---------------------------------------------------

    def test_the_rows_are_gone_when_the_meeting_is_over(self):
        self.admit(GuestAttendee.objects.create(
            event=self.event, full_name='Bishnu Prasad',
        ))

        self.end_it()

        self.assertEqual(GuestAttendee.objects.filter(event=self.event).count(), 0)

    def test_even_the_ones_who_were_never_let_in(self):
        GuestAttendee.objects.create(event=self.event, full_name='Never Admitted')

        self.end_it()

        self.assertEqual(GuestAttendee.objects.count(), 0)

    def test_but_the_register_remembers_who_attended(self):
        self.admit(GuestAttendee.objects.create(
            event=self.event, full_name='Bishnu Prasad',
        ))

        self.end_it()

        self.assertEqual(
            [entry['name'] for entry in self.event.guest_attendance],
            ['Bishnu Prasad'],
        )

    def test_and_only_the_ones_who_did(self):
        GuestAttendee.objects.create(event=self.event, full_name='Never Admitted')

        self.end_it()

        self.assertEqual(self.event.guest_attendance, [])

    def test_the_session_register_keeps_the_name_too(self):
        from src.apps.meetings.models import Session, SessionAttendance

        self.session.status = Session.Status.LIVE
        self.session.started_at = timezone.now()
        self.session.save()
        self.admit(GuestAttendee.objects.create(
            event=self.event, full_name='Bishnu Prasad',
        ))

        self.end_it()

        seat = SessionAttendance.objects.get(session=self.session, user__isnull=True)
        self.assertEqual(seat.guest_name, 'Bishnu Prasad')
        self.assertIsNone(seat.guest_id)

    def test_the_host_can_still_read_the_attendance_afterwards(self):
        from django.test import Client
        from rest_framework_simplejwt.tokens import AccessToken

        self.admit(GuestAttendee.objects.create(
            event=self.event, full_name='Bishnu Prasad',
        ))
        self.end_it()

        client = Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')
        report = client.get(f'{API}/events/{self.event.id}/attendance/').json()

        self.assertEqual(report['guests_admitted'], 1)
        guest_rows = [a for a in report['attended'] if a['type'] == 'guest']
        self.assertEqual([g['name'] for g in guest_rows], ['Bishnu Prasad'])
        # And nothing about them that was never asked for.
        self.assertIsNone(guest_rows[0]['phone'])

    def test_a_meeting_that_ended_untidily_is_swept_up(self):
        from src.apps.meetings.tasks import forget_guests_of_ended_meetings

        GuestAttendee.objects.create(
            event=self.event, full_name='Left Behind',
            status=GuestAttendee.Status.ADMITTED,
        )
        Event.objects.filter(id=self.event.id).update(
            status=Event.Status.ENDED
        )

        forget_guests_of_ended_meetings()

        self.assertEqual(GuestAttendee.objects.count(), 0)
        self.event.refresh_from_db()
        self.assertEqual(
            [e['name'] for e in self.event.guest_attendance], ['Left Behind']
        )

    def test_a_meeting_still_running_keeps_its_guests(self):
        from src.apps.meetings.tasks import forget_guests_of_ended_meetings

        GuestAttendee.objects.create(
            event=self.event, full_name='Still Here',
            status=GuestAttendee.Status.ADMITTED,
        )

        forget_guests_of_ended_meetings()

        self.assertEqual(GuestAttendee.objects.count(), 1)


class OneSeatPerGuestTests(TestCase):
    """A guest coming back does not sit in the room twice.

    Without the token they still hold, a knock is a fresh request - which
    is right, because a name is not a credential. But the host letting
    them in is the host saying this is the same person, so the seat they
    already had is given up rather than kept beside the new one, where it
    showed the same face in the room over and over.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        make_session(self.event, start, 60, 'Haldi')

    def as_host(self):
        from django.test import Client
        from rest_framework_simplejwt.tokens import AccessToken

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')

    def admit(self, guest):
        return self.as_host().post(
            f'{API}/events/{self.event.id}/admit_guest/',
            {'guest_id': str(guest.id), 'decision': 'admit'},
            content_type='application/json',
        )

    def knocking(self, name='Rahul Ingnam'):
        return GuestAttendee.objects.create(event=self.event, full_name=name)

    def test_the_seat_they_had_is_given_up(self):
        first = self.knocking()
        self.admit(first)

        self.admit(self.knocking())

        first.refresh_from_db()
        self.assertEqual(first.status, GuestAttendee.Status.LEFT)

    def test_so_the_room_holds_them_once(self):
        self.admit(self.knocking())
        self.admit(self.knocking())

        seated = self.event.guests.filter(status=GuestAttendee.Status.ADMITTED)
        self.assertEqual(seated.count(), 1)

    def test_and_the_register_names_them_once(self):
        self.admit(self.knocking())
        self.admit(self.knocking())

        self.event.refresh_from_db()
        self.assertEqual(
            [e['name'] for e in self.event.guest_attendance], ['Rahul Ingnam']
        )

    def test_somebody_else_keeps_their_own_seat(self):
        other = self.knocking('Sumin Maharjan')
        self.admit(other)

        self.admit(self.knocking('Rahul Ingnam'))

        other.refresh_from_db()
        self.assertEqual(other.status, GuestAttendee.Status.ADMITTED)


class WhatAGuestLeavesBehindTests(TestCase):
    """What was put on the board survives the person being forgotten.

    A guest's row goes when the event ends - that is the whole point of
    them being guests - and what they wrote used to go with them: the
    link cascaded, so anything already on the board vanished from it.
    The board keeps it, and keeps their name on it.

    What was never put up does not survive, and is not meant to. A
    message is written to be put up; one the host declined or never got
    to was read by nobody else, and this system holds no private
    messages once the day is over.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=30)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        make_session(self.event, start, 60, 'Haldi')

        self.guest = GuestAttendee.objects.create(
            event=self.event, full_name='Rahul Ingnam',
            status=GuestAttendee.Status.ADMITTED,
        )
        from src.apps.meetings.models import ChatMessage

        # Put up by the host, which is what makes it part of the record.
        self.asked = ChatMessage.objects.create(
            event=self.event, guest_sender=self.guest, recipient=self.host,
            body='What is this event about?',
            moderation_status=ChatMessage.Moderation.APPROVED,
            topic=ChatMessage.Topic.FAQ,
        )

    def end_it(self):
        from src.apps.meetings.services.event_service import EventService

        EventService.end_event(self.event.id)

    def reloaded(self):
        from src.apps.meetings.models import ChatMessage

        return ChatMessage.objects.filter(id=self.asked.id).first()

    def test_the_question_is_still_there(self):
        self.end_it()

        self.assertIsNotNone(self.reloaded())

    def test_and_still_says_who_asked_it(self):
        self.end_it()

        message = self.reloaded()
        self.assertIsNone(message.guest_sender_id)
        self.assertEqual(message.sender_label, 'Rahul Ingnam')

    def test_it_is_still_on_the_board_after_the_day(self):
        from django.test import Client
        from rest_framework_simplejwt.tokens import AccessToken

        self.end_it()
        client = Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')

        board = client.get(f'{API}/events/{self.event.id}/board/').json()

        self.assertEqual(
            [q['body'] for q in board['faq']], ['What is this event about?']
        )

    def test_one_the_host_never_put_up_does_not_outlive_the_day(self):
        from src.apps.meetings.models import ChatMessage

        waiting = ChatMessage.objects.create(
            event=self.event, guest_sender=self.guest, recipient=self.host,
            body='Is there parking?',
            moderation_status=ChatMessage.Moderation.PENDING,
        )

        self.end_it()

        self.assertFalse(ChatMessage.objects.filter(id=waiting.id).exists())

    def test_and_the_board_still_names_the_asker(self):
        from django.test import Client
        from rest_framework_simplejwt.tokens import AccessToken

        client = Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')

        self.end_it()

        board = client.get(f'{API}/events/{self.event.id}/board/').json()
        self.assertEqual([q['asked_by'] for q in board['faq']], ['Rahul Ingnam'])

    def test_a_reply_put_up_beside_it_keeps_their_name_too(self):
        from src.apps.meetings.models import ChatMessage

        answered = ChatMessage.objects.create(
            event=self.event, sender=self.host, guest_recipient=self.guest,
            body='It is about the budget.',
            moderation_status=ChatMessage.Moderation.APPROVED,
            topic=ChatMessage.Topic.FAQ,
        )

        self.end_it()

        kept = ChatMessage.objects.filter(id=answered.id).first()
        self.assertIsNotNone(kept)
        self.assertEqual(kept.recipient_label, 'Rahul Ingnam')


class TheGuestIsNotShownOutByTheClockTests(TestCase):
    """A guest stays until they leave or the host ends the event.

    Two ways they were thrown out, both by a clock. The talk finished and
    the host had not started the next, so the room read as spent. Or the
    event's closing time came round while a talk was still running. In
    both cases it was the guest's own page, asking how things were, that
    closed the event underneath them.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        # A event whose hour is well past.
        start = timezone.now() - timezone.timedelta(hours=3)
        self.event = make_event(self.host, start=start, minutes=60)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()
        self.session = make_session(self.event, start, 30, 'Haldi')
        self.guest = GuestAttendee.objects.create(
            event=self.event, full_name='Rahul Ingnam',
            status=GuestAttendee.Status.ADMITTED,
        )

    def ask(self):
        from src.apps.meetings.guest_tokens import make_guest_token

        return self.client.get(
            f'{API}/events/guest/status/?token={make_guest_token(self.guest)}'
        ).json()

    def reloaded(self):
        return Event.objects.get(id=self.event.id)

    def test_between_talks_the_room_is_still_theirs(self):
        self.session.status = Session.Status.DONE
        self.session.ended_at = timezone.now() - timezone.timedelta(hours=2)
        self.session.save()

        answer = self.ask()

        self.assertEqual(answer['event']['status'], Event.Status.ACTIVE)
        self.assertEqual(answer['guest']['status'], 'admitted')
        self.assertEqual(self.reloaded().status, Event.Status.ACTIVE)

    def test_and_so_it_is_while_a_talk_runs_past_its_hour(self):
        self.session.status = Session.Status.LIVE
        self.session.started_at = self.session.starts_at
        self.session.save()

        answer = self.ask()

        self.assertEqual(answer['event']['status'], Event.Status.ACTIVE)
        self.assertEqual(self.reloaded().status, Event.Status.ACTIVE)

    def test_asking_a_hundred_times_does_not_close_it_either(self):
        for _ in range(5):
            self.ask()

        self.assertEqual(self.reloaded().status, Event.Status.ACTIVE)
        self.guest.refresh_from_db()
        self.assertEqual(self.guest.status, GuestAttendee.Status.ADMITTED)

    def test_the_host_ending_it_is_what_shows_them_out(self):
        from src.apps.meetings.services.event_service import EventService

        EventService.end_event(self.event.id)

        self.assertEqual(self.reloaded().status, Event.Status.ENDED)

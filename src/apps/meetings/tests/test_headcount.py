"""What a meeting's headcount is measured against, and what the team was.

Two counts that were being asked of the wrong thing. Turnout was measured
against invitations alone, so guests - who are never invited - made the
figures worse the more of them came. And the team page asked the room who
was in it, which for a meeting that has finished is nobody, because ending
one empties it.
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from src.apps.meetings.models import (
    GuestAttendee, Meeting, MeetingInvite, MeetingParticipant, Session,
    SessionAttendance,
)
from src.apps.meetings.tests.factories import (
    make_event, make_host, make_meeting, make_session,
)

API = '/api/v1'


class HeadcountTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.start = timezone.now() - timezone.timedelta(hours=2)
        self.meeting = make_meeting(self.host, self.event, start=self.start, minutes=180)
        self.client_ = self.as_(self.host)

    def as_(self, user):
        from django.test import Client

        return Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(user)}')

    def report(self):
        return self.client_.get(f'{API}/meetings/{self.meeting.id}/attendance/').json()

    def invite(self, email, came=False):
        person = make_host(email) if came else None
        invite = MeetingInvite.objects.create(meeting=self.meeting, email=email)
        if came:
            MeetingParticipant.objects.create(
                meeting=self.meeting, user=person,
                role=MeetingParticipant.Role.ATTENDEE, is_active=True,
            )
            invite.joined_at = timezone.now()
            invite.joined_user = person
            invite.save()
        return invite

    def guest(self, name, status=GuestAttendee.Status.ADMITTED):
        return GuestAttendee.objects.create(
            meeting=self.meeting, full_name=name, phone='9800000000', status=status,
        )

    def test_a_guest_counts_towards_the_meetings_roll(self):
        # Four invited, three came, two guests admitted: the roll is six,
        # not four.
        for i in range(3):
            self.invite(f'came{i}@example.com', came=True)
        self.invite('missed@example.com')
        self.guest('Bishnu')
        self.guest('Sabina')

        body = self.report()

        self.assertEqual(body['expected_total'], 6)
        self.assertEqual(body['attended_count'], 5)
        self.assertEqual(body['absent_count'], 1)

    def test_somebody_who_walked_in_with_the_code_is_on_the_roll_too(self):
        # Otherwise attendance can exceed the total, and the shortfall goes
        # negative.
        self.invite('missed@example.com')
        walked_in = make_host('code@example.com')
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=walked_in,
            role=MeetingParticipant.Role.ATTENDEE, is_active=True,
        )

        body = self.report()

        self.assertEqual(body['walked_in_uninvited'], 1)
        self.assertEqual(body['expected_total'], 2)
        self.assertEqual(body['absent_count'], 1)

    def test_nobody_is_absent_when_everybody_came(self):
        self.invite('came@example.com', came=True)
        self.guest('Bishnu')

        body = self.report()

        self.assertEqual(body['absent_count'], 0)

    def test_a_guest_the_host_turned_away_is_on_no_list(self):
        self.guest('Turned away', status=GuestAttendee.Status.DENIED)

        body = self.report()

        self.assertEqual(body['expected_total'], 0)
        self.assertEqual(body['attended_count'], 0)

    def test_the_old_invitation_figure_is_still_there(self):
        # Reports were written against it; it just is not the total.
        self.invite('one@example.com')
        self.guest('Bishnu')

        body = self.report()

        self.assertEqual(body['expected_from_invites'], 1)
        self.assertEqual(body['expected_total'], 2)


class GrossSessionTests(TestCase):
    """Every seat filled across a running order, not the distinct people."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.start = timezone.now() - timezone.timedelta(hours=3)
        self.meeting = make_meeting(self.host, self.event, start=self.start, minutes=240)
        self.a = make_session(self.meeting, self.start, 60, 'Session A')
        self.b = make_session(
            self.meeting, self.start + timezone.timedelta(minutes=90), 60, 'Session B'
        )

    def sit(self, session, how_many):
        for i in range(how_many):
            SessionAttendance.objects.create(
                session=session, user=make_host(f'{session.title}-{i}@example.com')
            )

    def report(self):
        from django.test import Client

        client = Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')
        return client.get(f'{API}/meetings/{self.meeting.id}/attendance/').json()

    def test_four_in_one_and_two_in_the_other_is_six(self):
        self.sit(self.a, 4)
        self.sit(self.b, 2)

        body = self.report()

        self.assertEqual(body['session_attendance_total'], 6)

    def test_it_says_which_session_each_belongs_to(self):
        self.sit(self.a, 4)
        self.sit(self.b, 2)

        rows = self.report()['sessions']

        self.assertEqual(
            [(r['title'], r['attended_count']) for r in rows],
            [('Session A', 4), ('Session B', 2)],
        )

    def test_the_same_person_at_both_counts_twice(self):
        # Six seats were filled even if four people filled them.
        person = make_host('regular@example.com')
        SessionAttendance.objects.create(session=self.a, user=person)
        SessionAttendance.objects.create(session=self.b, user=person)

        self.assertEqual(self.report()['session_attendance_total'], 2)

    def test_a_meeting_with_no_sessions_reports_nothing_rather_than_failing(self):
        bare = make_meeting(self.host, self.event, start=self.start, minutes=60)
        from django.test import Client

        client = Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')
        body = client.get(f'{API}/meetings/{bare.id}/attendance/').json()

        self.assertEqual(body['session_attendance_total'], 0)
        self.assertEqual(body['sessions'], [])


class TeamAfterTheMeetingTests(TestCase):
    """Who was on the team, asked of a meeting that has finished."""

    def setUp(self):
        self.host = make_host('host@example.com')
        self.event = make_event(self.host)
        self.meeting = make_meeting(self.host, self.event)
        self.attendee = make_host('attendee@example.com')
        MeetingParticipant.objects.create(
            meeting=self.meeting, user=self.attendee,
            role=MeetingParticipant.Role.ATTENDEE, is_active=True,
        )
        GuestAttendee.objects.create(
            meeting=self.meeting, full_name='Bishnu', phone='9800000000',
            status=GuestAttendee.Status.ADMITTED,
        )

    def roster(self, everyone=False):
        from django.test import Client

        client = Client(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.host)}')
        tail = '?everyone=1' if everyone else ''
        return client.get(f'{API}/meetings/{self.meeting.id}/participants/{tail}').json()

    def finish(self):
        from src.apps.meetings.services.meeting_service import MeetingService

        self.meeting.status = Meeting.Status.ACTIVE
        self.meeting.save()
        MeetingService.end_meeting(self.meeting.id)

    def test_the_room_shows_who_is_in_it(self):
        self.assertEqual(len(self.roster()), 2)

    def test_and_shows_nobody_once_the_meeting_has_ended(self):
        # Which is right for a room, and was wrong for a team page.
        self.finish()

        self.assertEqual(self.roster(), [])

    def test_asking_who_was_there_still_answers(self):
        self.finish()

        rows = self.roster(everyone=True)

        self.assertEqual(len(rows), 2)
        self.assertTrue(all(not r['is_active'] for r in rows))

    def test_a_guest_who_was_admitted_is_in_that_answer(self):
        self.finish()

        rows = self.roster(everyone=True)

        self.assertEqual(sum(1 for r in rows if r['is_guest']), 1)

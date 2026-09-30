"""Whose voice a transcript line is written under.

One microphone in a hall hears one room, so a capture device almost
never reports a name. It used to say "Room", which is true and useless:
the person reading the transcript wants to know who was speaking, and
the programme already says who is on stage.
"""
from django.test import TestCase
from django.utils import timezone

from src.apps.meetings.models import Event
from src.apps.meetings.tests.factories import make_event, make_host, make_session
from src.apps.transcription.ingest import accept_line


class WhoIsSpeakingTests(TestCase):
    def setUp(self):
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=10)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.started_at = start
        self.event.save()

    def onstage(self, speaker='Sarah Sharma'):
        session = make_session(self.event, self.event.scheduled_start, 60, 'Opening')
        session.speaker_name = speaker
        session.status = 'live'
        session.save()
        return session

    def test_the_talk_on_stage_names_the_voice(self):
        self.onstage()

        line = accept_line(self.event, {'text': 'Good morning everyone.'})

        self.assertEqual(line['speaker_name'], 'Sarah Sharma')

    def test_a_device_that_does_know_is_believed_over_the_programme(self):
        self.onstage()

        line = accept_line(
            self.event, {'text': 'A word.', 'speaker_name': 'David Thapa'}
        )

        self.assertEqual(line['speaker_name'], 'David Thapa')

    def test_the_room_answers_when_nothing_is_running(self):
        line = accept_line(self.event, {'text': 'Testing the microphone.'})

        self.assertEqual(line['speaker_name'], 'Room')

    def test_and_when_the_talk_on_stage_names_nobody(self):
        self.onstage(speaker='')

        line = accept_line(self.event, {'text': 'A word.'})

        self.assertEqual(line['speaker_name'], 'Room')

    def test_the_line_is_still_filed_against_that_talk(self):
        session = self.onstage()

        line = accept_line(self.event, {'text': 'A word.'})

        self.assertEqual(line['session_id'], str(session.id))

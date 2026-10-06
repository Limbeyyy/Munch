"""Turning a recogniser's stream into something readable.

What arrives is not a sequence of lines. It is one phrase, sent again
every time another word of it is heard, and the transcript showed
every one of those - a column of overlapping fragments that read as
though the speaker had stammered.
"""
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from src.apps.meetings.models import Event
from src.apps.meetings.tests.factories import make_event, make_host, make_session
from src.apps.transcription import batching
from src.apps.transcription.ingest import accept_line, flush_pending
from src.apps.transcription.models import TranscriptionSegment


class FoldingOneLineIntoAnotherTests(TestCase):
    """The overlap rule on its own, with no clock and no database."""

    def test_a_line_that_grows_contributes_only_its_tail(self):
        pending, last = batching.merge('', '', 'के')
        self.assertEqual(pending, 'के')

        pending, last = batching.merge(last, pending, 'के गर्दैछौ')

        self.assertEqual(pending, 'के गर्दैछौ')

    def test_the_same_line_twice_adds_nothing(self):
        pending, last = batching.merge('', '', 'hello there')

        pending, last = batching.merge(last, pending, 'hello there')

        self.assertEqual(pending, 'hello there')

    def test_a_shorter_resend_adds_nothing_and_does_not_shrink_the_mark(self):
        """A recogniser correcting itself backwards.

        If `last` shrank here, the next line's tail would be measured
        from the wrong place and the overlap would come back doubled.
        """
        pending, last = batching.merge('', '', 'hello there friend')

        pending, last = batching.merge(last, pending, 'hello there')

        self.assertEqual(pending, 'hello there friend')
        self.assertEqual(last, 'hello there friend')

    def test_an_unrelated_line_is_a_new_phrase(self):
        pending, last = batching.merge('', '', 'good morning')

        pending, last = batching.merge(last, pending, 'welcome everybody')

        self.assertEqual(pending, 'good morning welcome everybody')

    def test_the_growing_stream_from_the_screenshot(self):
        """The exact sequence that produced the column of fragments."""
        arriving = [
            'के', 'के', 'के', 'के गर्दैछौ', 'के गर्दैछौ',
            'के गर्दैछौ तिमी', 'के गर्दैछौ तिमी के',
            'के गर्दैछौ तिमी के गर्दैछौ',
        ]
        pending, last = '', ''
        for line in arriving:
            pending, last = batching.merge(last, pending, line)

        self.assertEqual(pending, 'के गर्दैछौ तिमी के गर्दैछौ')

    def test_empty_lines_are_ignored(self):
        pending, last = batching.merge('', 'so far', '   ')

        self.assertEqual(pending, 'so far')


@override_settings(TRANSCRIPT_WINDOW_SECONDS=15)
class ReleasingABlockTests(TestCase):
    """The window: text is gathered, then let go of in one piece."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.event_id = 'e-1'

    def test_nothing_comes_out_before_the_window_has_passed(self):
        with mock.patch.object(batching.time, 'monotonic', return_value=1000.0):
            self.assertIsNone(batching.add(self.event_id, 'Sometimes the best'))
            self.assertIsNone(batching.add(self.event_id, 'Sometimes the best moments'))

    def test_the_block_arrives_once_it_has(self):
        with mock.patch.object(batching.time, 'monotonic', return_value=1000.0):
            batching.add(self.event_id, 'Sometimes the best')
        with mock.patch.object(batching.time, 'monotonic', return_value=1016.0):
            block = batching.add(self.event_id, 'Sometimes the best moments happen')

        self.assertIsNotNone(block)
        self.assertEqual(block['text'], 'Sometimes the best moments happen')

    def test_the_next_block_does_not_repeat_the_last(self):
        """The cutoff, which is the whole point.

        The recogniser goes on sending the entire phrase. What it has
        already been given credit for must not be given again.
        """
        with mock.patch.object(batching.time, 'monotonic', return_value=1000.0):
            batching.add(self.event_id, 'Sometimes the best moments happen')
        with mock.patch.object(batching.time, 'monotonic', return_value=1016.0):
            first = batching.add(
                self.event_id, 'Sometimes the best moments happen when we stop'
            )
        with mock.patch.object(batching.time, 'monotonic', return_value=1032.0):
            second = batching.add(
                self.event_id,
                'Sometimes the best moments happen when we stop trying to plan',
            )

        self.assertEqual(first['text'],
                         'Sometimes the best moments happen when we stop')
        self.assertEqual(second['text'], 'trying to plan')
        self.assertNotIn('Sometimes', second['text'])

    def test_a_whole_talk_comes_back_once_and_in_order(self):
        """The property that matters, rather than the window arithmetic.

        Which words land in which block depends on when the speaker
        paused, and is not worth pinning. What must hold is that every
        word appears exactly once and in the order it was said - the
        two things the old behaviour broke.
        """
        whole = (
            'Sometimes the best moments happen when we stop trying to plan. '
            'Then something unexpected happens. Life is full of surprises. '
            'So slow down and take a breath.'
        )
        # A recogniser re-sending the whole phrase as it hears more of
        # it, a word at a time, over a minute.
        words = whole.split(' ')
        blocks = []
        for i in range(1, len(words) + 1):
            at = 1000.0 + i * 2.0
            with mock.patch.object(batching.time, 'monotonic', return_value=at):
                block = batching.add(self.event_id, ' '.join(words[:i]))
                if block:
                    blocks.append(block['text'])
        tail = batching.flush(self.event_id)
        if tail:
            blocks.append(tail['text'])

        self.assertGreater(len(blocks), 1, 'should have been released in parts')
        self.assertEqual(' '.join(blocks), whole)

    def test_the_tail_is_held_rather_than_lost(self):
        with mock.patch.object(batching.time, 'monotonic', return_value=1000.0):
            batching.add(self.event_id, 'one')
        with mock.patch.object(batching.time, 'monotonic', return_value=1016.0):
            batching.add(self.event_id, 'one two')

        # Four seconds into the window that opened when the last block
        # was released, so this one is still being gathered.
        with mock.patch.object(batching.time, 'monotonic', return_value=1020.0):
            self.assertIsNone(batching.add(self.event_id, 'one two three'))

        self.assertEqual(batching.flush(self.event_id)['text'], 'three')

    def test_flush_releases_what_is_held_whatever_the_clock_says(self):
        with mock.patch.object(batching.time, 'monotonic', return_value=1000.0):
            batching.add(self.event_id, 'the closing words')

        self.assertEqual(batching.flush(self.event_id)['text'], 'the closing words')

    def test_flushing_an_empty_buffer_says_nothing(self):
        self.assertIsNone(batching.flush(self.event_id))

    def test_a_flush_leaves_nothing_behind_to_be_said_twice(self):
        with mock.patch.object(batching.time, 'monotonic', return_value=1000.0):
            batching.add(self.event_id, 'once only')
        batching.flush(self.event_id)

        self.assertIsNone(batching.flush(self.event_id))


@override_settings(TRANSCRIPT_WINDOW_SECONDS=15)
class WhatReachesTheTranscriptTests(TestCase):
    """End to end, through the door a device actually comes in by."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.save()
        self.session = make_session(self.event, start, 60, 'Opening remarks')
        self.session.status = 'live'
        self.session.save()

    def stored(self):
        return list(
            TranscriptionSegment.objects.filter(event=self.event)
            .order_by('created_at').values_list('text', flat=True)
        )

    def test_a_stream_of_fragments_stores_nothing_until_the_window_closes(self):
        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            for line in ['के', 'के गर्दैछौ', 'के गर्दैछौ तिमी']:
                accept_line(self.event, {'text': line, 'is_final': True})

        self.assertEqual(self.stored(), [])

    def test_and_then_stores_one_line_rather_than_eight(self):
        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            for line in ['के', 'के', 'के गर्दैछौ', 'के गर्दैछौ तिमी']:
                accept_line(self.event, {'text': line, 'is_final': True})
        with mock.patch.object(batching.time, 'monotonic', return_value=516.0):
            accept_line(self.event, {'text': 'के गर्दैछौ तिमी के', 'is_final': True})

        self.assertEqual(self.stored(), ['के गर्दैछौ तिमी के'])

    def test_interim_lines_are_folded_in_like_any_other(self):
        """Both kinds are rewrites of the same phrase.

        Treating them differently was what let the fragments through:
        a device calling each growing prefix 'final' had every one of
        them stored.
        """
        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            accept_line(self.event, {'text': 'hello', 'is_final': False})
            accept_line(self.event, {'text': 'hello there', 'is_final': False})
        with mock.patch.object(batching.time, 'monotonic', return_value=516.0):
            accept_line(self.event, {'text': 'hello there everybody', 'is_final': True})

        self.assertEqual(self.stored(), ['hello there everybody'])

    def test_the_closing_words_are_not_lost_when_the_talk_ends(self):
        from src.apps.meetings.lifecycle import close_session

        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            accept_line(self.event, {'text': 'and that is all', 'is_final': True})

        close_session(self.session, timezone.now())

        self.assertEqual(self.stored(), ['and that is all'])

    def test_nor_when_the_event_ends_with_nothing_on_stage(self):
        from src.apps.meetings.services.event_service import EventService

        self.session.status = 'done'
        self.session.save()
        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            accept_line(self.event, {'text': 'thank you all for coming',
                                     'is_final': True})

        EventService.end_event(str(self.event.id))

        self.assertEqual(self.stored(), ['thank you all for coming'])

    def test_the_caller_is_still_told_the_line_was_taken(self):
        """A device must not think a held line was refused."""
        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            segment = accept_line(self.event, {'text': 'held', 'is_final': True})

        self.assertTrue(segment['held'])
        self.assertEqual(segment['code'], self.event.code)

    def test_a_released_block_is_attributed_to_whoever_is_on_stage(self):
        self.session.speaker_name = 'Sumin Maharjan'
        self.session.save()

        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            accept_line(self.event, {'text': 'good morning', 'is_final': True})
        with mock.patch.object(batching.time, 'monotonic', return_value=516.0):
            segment = accept_line(self.event,
                                  {'text': 'good morning everybody', 'is_final': True})

        self.assertEqual(segment['speaker_name'], 'Sumin Maharjan')
        self.assertFalse(segment['held'])


@override_settings(TRANSCRIPT_WINDOW_SECONDS=15)
class WhatABlockCarriesTests(TestCase):
    """The block is the lines it was built from, not a fresh invention."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.host = make_host('host@example.com')
        start = timezone.now() - timezone.timedelta(minutes=5)
        self.event = make_event(self.host, start=start, minutes=120)
        self.event.status = Event.Status.ACTIVE
        self.event.save()
        self.session = make_session(self.event, start, 60, 'Opening')
        self.session.status = 'live'
        self.session.save()

    def test_the_language_survives_being_held(self):
        """A block released later has no line in front of it to ask.

        Without the buffer carrying it, a Nepali talk came back
        tagged English - and nothing about the text would have said
        so.
        """
        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            accept_line(self.event, {'text': 'नमस्ते', 'lang': 'ne-NP'})

        flush_pending(self.event)

        kept = TranscriptionSegment.objects.get(event=self.event)
        self.assertEqual(kept.language, 'ne-NP')
        self.assertEqual(kept.text, 'नमस्ते')

    def test_a_phrase_growing_mid_word_is_not_broken_open(self):
        """Recognisers do not only grow at word boundaries.

        The tail carries its own spacing, so adding one turned
        "Sixty-nine dist" becoming "Sixty-nine districts" into
        "Sixty-nine dist ricts".
        """
        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            accept_line(self.event, {'text': 'Sixty-nine dist'})
            accept_line(self.event, {'text': 'Sixty-nine districts passed.'})

        flush_pending(self.event)

        self.assertEqual(
            TranscriptionSegment.objects.get(event=self.event).text,
            'Sixty-nine districts passed.',
        )

    def test_the_block_spans_the_lines_it_gathered(self):
        with mock.patch.object(batching.time, 'monotonic', return_value=500.0):
            accept_line(self.event, {'text': 'one', 'start_time': 4, 'end_time': 5})
            accept_line(self.event, {'text': 'one two',
                                     'start_time': 5, 'end_time': 9})

        flush_pending(self.event)

        kept = TranscriptionSegment.objects.get(event=self.event)
        self.assertEqual(kept.start_time, 4.0)
        self.assertEqual(kept.end_time, 9.0)

"""Real-time transcription service"""
import logging
from typing import Optional, Dict, Any
from django.utils import timezone
from src.apps.transcription.models import TranscriptionSegment, Transcript, TranscriptSummary
from src.apps.meetings.models import Meeting
from src.apps.monitoring.models import MeetingEvent

logger = logging.getLogger(__name__)


class TranscriptionService:
    """Manages real-time transcription and final transcripts"""

    @staticmethod
    def add_transcription_segment(
        meeting_id: str,
        speaker_id: str,
        speaker_name: str,
        text: str,
        start_time: float,
        end_time: float,
        is_final: bool = False,
        confidence: float = 0.0
    ) -> TranscriptionSegment:
        """Add a transcription segment (real-time chunk)"""
        try:
            segment = TranscriptionSegment.objects.create(
                meeting_id=meeting_id,
                speaker_id=speaker_id,
                speaker_name=speaker_name,
                text=text,
                start_time=start_time,
                end_time=end_time,
                is_final=is_final,
                confidence=confidence
            )

            if is_final:
                MeetingEvent.objects.create(
                    meeting_id=meeting_id,
                    event_type=MeetingEvent.EventType.TRANSCRIPT_SEGMENT,
                    description=f"{speaker_name}: {text[:50]}...",
                    user=speaker_id,
                    data={'confidence': confidence}
                )

            logger.info(f"Added transcription segment for {meeting_id} from {speaker_name}")
            return segment

        except Exception as e:
            logger.error(f"Failed to add transcription segment: {str(e)}")
            raise

    @staticmethod
    def get_live_transcript(meeting_id: str) -> str:
        """Get current merged transcript (all final segments)"""
        try:
            segments = TranscriptionSegment.objects.filter(
                meeting_id=meeting_id,
                is_final=True
            ).order_by('start_time')

            transcript = []
            current_speaker = None

            for segment in segments:
                if segment.speaker_name != current_speaker:
                    transcript.append(f"\n{segment.speaker_name}:")
                    current_speaker = segment.speaker_name

                transcript.append(f" {segment.text}")

            return ''.join(transcript)

        except Exception as e:
            logger.error(f"Failed to get live transcript: {str(e)}")
            return ""

    @staticmethod
    def finalize_transcript(meeting_id: str) -> Transcript:
        """Finalize transcript when meeting ends"""
        try:
            meeting = Meeting.objects.get(id=meeting_id)

            transcript, created = Transcript.objects.get_or_create(
                meeting=meeting
            )

            # Merge all segments
            transcript.full_text = TranscriptionService.get_live_transcript(meeting_id)
            transcript.word_count = len(transcript.full_text.split())
            transcript.is_complete = True
            transcript.completed_at = timezone.now()
            transcript.save()

            MeetingEvent.objects.create(
                meeting=meeting,
                event_type=MeetingEvent.EventType.TRANSCRIPTION_STARTED,
                description="Transcript finalized",
                user='system',
                data={'word_count': transcript.word_count}
            )

            logger.info(f"Finalized transcript for {meeting_id}")
            return transcript

        except Meeting.DoesNotExist:
            logger.error(f"Meeting {meeting_id} not found")
            raise

    @staticmethod
    def create_summary_placeholder(meeting_id: str) -> TranscriptSummary:
        """Create summary record ready for LLM processing"""
        try:
            meeting = Meeting.objects.get(id=meeting_id)

            summary, created = TranscriptSummary.objects.get_or_create(
                meeting=meeting
            )

            return summary

        except Meeting.DoesNotExist:
            logger.error(f"Meeting {meeting_id} not found")
            raise

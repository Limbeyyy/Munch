"""
Transcription service for processing meeting audio into text.
Handles real-time speech-to-text, segment management, and integration
with the MeetingArtifactService for storing transcripts.
"""
import logging
import time
from typing import Optional, Dict, Any, List, Callable
from django.conf import settings
from django.utils import timezone
from src.apps.meetings.models import Meeting
from src.apps.artifacts.services.artifact_service import MeetingArtifactService
from src.utilities.logger import get_logger

logger = get_logger(__name__)

class TranscriptionService:
    """
    Service for handling meeting transcriptions.
    Supports real-time speech-to-text processing and transcript storage.
    """

    # Default language for transcription
    DEFAULT_LANGUAGE = 'en-US'

    # Maximum segment length in seconds before finalizing
    MAX_SEGMENT_DURATION = 15

    # Minimum words to consider a segment meaningful
    MIN_SEGMENT_WORDS = 3

    def __init__(self, meeting_id: str, user_id: str, language: str = None):
        """
        Initialize the transcription service for a meeting.

        Args:
            meeting_id: UUID of the meeting
            user_id: UUID of the user initiating transcription (usually host)
            language: Language code for speech recognition (e.g., 'en-US')
        """
        self.meeting_id = meeting_id
        self.user_id = user_id
        self.language = language or self.DEFAULT_LANGUAGE
        self.meeting = Meeting.objects.get(id=meeting_id)
        self.artifact_service = MeetingArtifactService(meeting_id, user_id)

        # In-memory buffer for current segment
        self._segment_buffer = {
            'words': [],
            'start_time': time.time(),
            'text': '',
            'confidence': 0.0,
        }
        self._segment_id_counter = 0
        self._is_active = False
        self._transcription_client = None

        # Initialize the transcription client (e.g., Google Cloud, AssemblyAI)
        self._init_transcription_client()

    def _init_transcription_client(self):
        """
        Initialize the speech-to-text client.
        This is a placeholder - replace with actual client initialization.
        """
        # Example: Google Cloud Speech-to-Text
        # from google.cloud import speech_v1
        # self._transcription_client = speech_v1.SpeechClient()
        self._transcription_client = None
        logger.info("Transcription client initialized (mock mode)")

    def start_transcription(self) -> bool:
        """
        Start the transcription session for the meeting.

        Returns:
            bool: True if started successfully
        """
        if self._is_active:
            logger.warning(f"Transcription already active for meeting {self.meeting_id}")
            return False

        self._is_active = True
        self._segment_buffer['start_time'] = time.time()
        self._segment_id_counter = 0

        # Create or ensure transcript artifact exists
        self._ensure_transcript_artifact()

        logger.info(f"Transcription started for meeting {self.meeting.meeting_code}")
        return True

    def _ensure_transcript_artifact(self):
        """
        Ensure the transcript artifact exists in the meeting.
        """
        from src.apps.artifacts.models import Artifact, ArtifactType

        transcript, created = Artifact.objects.get_or_create(
            meeting=self.meeting,
            artifact_type=ArtifactType.TRANSCRIPT,
            defaults={
                'display_name': f"Transcript - {self.meeting.meeting_code}",
                'mime_type': "application/vnd.google-apps.document",
                'metadata': {'segments': []}
            }
        )

        if not transcript.drive_file_id:
            # The artifact service will create the document on first save
            pass

        return transcript

    def process_audio_chunk(self, audio_data: bytes, sample_rate: int = 16000) -> Optional[Dict[str, Any]]:
        """
        Process an audio chunk and return transcription result.

        Args:
            audio_data: Raw audio bytes (PCM, 16-bit mono)
            sample_rate: Sample rate of the audio

        Returns:
            dict: Transcription result with 'text', 'confidence', 'is_final'
            or None if error
        """
        if not self._is_active:
            logger.warning(f"Transcription not active for meeting {self.meeting_id}")
            return None

        try:
            # If we have a real transcription client, use it.
            if self._transcription_client:
                # Placeholder for actual client call
                # response = self._transcription_client.recognize(...)
                # text = response.results[0].alternatives[0].transcript
                # confidence = response.results[0].alternatives[0].confidence
                # is_final = response.results[0].is_final
                # For demo, we simulate:
                text = self._mock_transcribe(audio_data)
                confidence = 0.95
                is_final = True
            else:
                # Mock mode
                text = self._mock_transcribe(audio_data)
                confidence = 0.9
                is_final = True

            # Add to buffer
            self._add_to_buffer(text, confidence, is_final)

            return {
                'text': text,
                'confidence': confidence,
                'is_final': is_final,
                'timestamp': timezone.now().isoformat()
            }

        except Exception as e:
            logger.error(f"Error processing audio chunk: {str(e)}")
            return None

    def _mock_transcribe(self, audio_data: bytes) -> str:
        """
        Mock transcription for development.
        Replace with actual STT API call.
        """
        # This is just a placeholder - in real scenario, you'd call an API.
        # For testing, return a dummy text based on audio length or something.
        import hashlib
        # Generate a deterministic "transcription" from audio hash
        hash_val = hashlib.md5(audio_data[:100]).hexdigest()[:8]
        dummy_texts = [
            "Hello, this is a test transcription.",
            "We are discussing the project timeline.",
            "Can everyone see the shared screen?",
            "I'll take notes on the action items.",
            "Let's move on to the next agenda item.",
            "Thanks for joining the meeting today.",
        ]
        idx = int(hash_val, 16) % len(dummy_texts)
        return dummy_texts[idx]

    def _add_to_buffer(self, text: str, confidence: float, is_final: bool):
        """
        Add transcribed text to the current segment buffer.
        If the segment meets criteria, finalize it.
        """
        self._segment_buffer['words'].append(text)
        self._segment_buffer['text'] += ' ' + text
        self._segment_buffer['confidence'] = (
            self._segment_buffer['confidence'] + confidence
        ) / len(self._segment_buffer['words'])

        # Check if we should finalize this segment
        if self._should_finalize_segment():
            self._finalize_segment()

    def _should_finalize_segment(self) -> bool:
        """
        Determine if the current segment should be finalized.
        """
        # Segment duration exceeded
        duration = time.time() - self._segment_buffer['start_time']
        if duration > self.MAX_SEGMENT_DURATION:
            return True

        # Enough words to be meaningful
        word_count = len(self._segment_buffer['text'].split())
        if word_count >= self.MIN_SEGMENT_WORDS:
            return True

        return False

    def _finalize_segment(self):
        """
        Finalize the current transcript segment and save to Drive.
        """
        if not self._segment_buffer['text'].strip():
            # Empty segment, just reset
            self._reset_buffer()
            return

        segment_id = self._segment_id_counter + 1
        self._segment_id_counter = segment_id

        content = self._segment_buffer['text'].strip()
        timestamp = timezone.now().isoformat()

        # Save to Drive via artifact service
        success = self.artifact_service.save_transcript(
            content=content,
            segment_id=str(segment_id)
        )

        if success:
            logger.debug(f"Saved transcript segment {segment_id} for meeting {self.meeting_id}")
        else:
            logger.error(f"Failed to save transcript segment {segment_id}")

        # Reset buffer for next segment
        self._reset_buffer()

    def _reset_buffer(self):
        """
        Reset the segment buffer for a new segment.
        """
        self._segment_buffer = {
            'words': [],
            'start_time': time.time(),
            'text': '',
            'confidence': 0.0,
        }

    def stop_transcription(self, finalize: bool = True) -> bool:
        """
        Stop the transcription session.

        Args:
            finalize: Whether to save the remaining buffer as a final segment

        Returns:
            bool: True if stopped successfully
        """
        if not self._is_active:
            return False

        self._is_active = False

        # Finalize any remaining text
        if finalize and self._segment_buffer['text'].strip():
            self._finalize_segment()

        # Add a finalization marker
        self._add_finalization_marker()

        logger.info(f"Transcription stopped for meeting {self.meeting.meeting_code}")
        return True

    def _add_finalization_marker(self):
        """
        Add a finalization marker to the transcript.
        """
        marker = f"\n\n--- Transcript finalized at {timezone.now().isoformat()} ---"
        try:
            from src.apps.artifacts.models import Artifact, ArtifactType
            transcript = Artifact.objects.get(
                meeting=self.meeting,
                artifact_type=ArtifactType.TRANSCRIPT
            )
            if transcript.drive_file_id:
                self.artifact_service.drive_adapter.append_to_document(
                    transcript.drive_file_id,
                    marker
                )
                # Update metadata
                metadata = transcript.metadata or {}
                metadata['finalized_at'] = timezone.now().isoformat()
                transcript.metadata = metadata
                transcript.save()
        except Exception as e:
            logger.error(f"Failed to add finalization marker: {str(e)}")

    def get_transcript_status(self) -> Dict[str, Any]:
        """
        Get the current status of the transcription.

        Returns:
            dict: Status information
        """
        from src.apps.artifacts.models import Artifact, ArtifactType
        try:
            transcript = Artifact.objects.get(
                meeting=self.meeting,
                artifact_type=ArtifactType.TRANSCRIPT
            )
            metadata = transcript.metadata or {}
            segment_count = len(metadata.get('segments', []))
            return {
                'is_active': self._is_active,
                'segment_count': segment_count,
                'last_updated': transcript.updated_at.isoformat(),
                'drive_file_id': transcript.drive_file_id,
                'has_content': bool(transcript.drive_file_id),
            }
        except Artifact.DoesNotExist:
            return {
                'is_active': self._is_active,
                'segment_count': 0,
                'has_content': False,
            }

    def update_language(self, language: str):
        """
        Update the language for transcription.

        Args:
            language: Language code (e.g., 'en-US', 'es-ES')
        """
        self.language = language
        logger.info(f"Transcription language updated to {language} for meeting {self.meeting_id}")

    def set_segment_criteria(self, max_duration: int, min_words: int):
        """
        Update the criteria for segment finalization.

        Args:
            max_duration: Maximum segment duration in seconds
            min_words: Minimum number of words in a segment
        """
        self.MAX_SEGMENT_DURATION = max_duration
        self.MIN_SEGMENT_WORDS = min_words
        logger.info(f"Segment criteria updated: max_duration={max_duration}, min_words={min_words}")
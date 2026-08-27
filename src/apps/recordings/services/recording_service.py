"""Recording management service"""
import logging
from django.utils import timezone
from src.apps.recordings.models import Recording, Attendance, MeetingAnalytics
from src.apps.meetings.models import Meeting

logger = logging.getLogger(__name__)


class RecordingService:
    """Handle recording operations"""

    @staticmethod
    def start_recording(meeting_id, storage_type='drive'):
        """Start recording a meeting"""
        try:
            meeting = Meeting.objects.get(id=meeting_id)

            recording, created = Recording.objects.get_or_create(
                meeting=meeting,
                defaults={
                    'start_time': timezone.now(),
                    'status': Recording.Status.RECORDING,
                    'storage_type': storage_type
                }
            )

            logger.info(f"Started recording for {meeting.meeting_code}")
            return recording

        except Exception as e:
            logger.error(f"Failed to start recording: {str(e)}")
            raise

    @staticmethod
    def stop_recording(meeting_id):
        """Stop recording"""
        try:
            recording = Recording.objects.get(meeting_id=meeting_id)
            recording.end_time = timezone.now()
            recording.duration_seconds = int(
                (recording.end_time - recording.start_time).total_seconds()
            )
            recording.status = Recording.Status.PROCESSING
            recording.save()

            logger.info(f"Stopped recording for meeting {meeting_id}")
            return recording

        except Recording.DoesNotExist:
            logger.warning(f"No recording found for meeting {meeting_id}")
            return None

    @staticmethod
    def create_attendance_record(meeting_id, participant_id, participant_name, participant_email, joined_at):
        """Record participant attendance"""
        try:
            Attendance.objects.create(
                meeting_id=meeting_id,
                participant_id=participant_id,
                participant_name=participant_name,
                participant_email=participant_email,
                joined_at=joined_at
            )

            logger.info(f"Recorded attendance for {participant_name} in meeting {meeting_id}")

        except Exception as e:
            logger.error(f"Failed to record attendance: {str(e)}")

    @staticmethod
    def finalize_attendance(meeting_id):
        """Finalize all attendance records"""
        try:
            records = Attendance.objects.filter(
                meeting_id=meeting_id,
                left_at__isnull=True
            )

            for record in records:
                record.left_at = timezone.now()
                record.duration_seconds = int(
                    (record.left_at - record.joined_at).total_seconds()
                )
                record.save()

            logger.info(f"Finalized attendance for meeting {meeting_id}")

        except Exception as e:
            logger.error(f"Failed to finalize attendance: {str(e)}")

    @staticmethod
    def get_attendance_report(meeting_id):
        """Generate attendance report"""
        try:
            records = Attendance.objects.filter(meeting_id=meeting_id)

            report = {
                'total_participants': records.count(),
                'total_attendance_hours': sum(r.duration_seconds for r in records) / 3600,
                'participants': [{
                    'name': r.participant_name,
                    'email': r.participant_email,
                    'duration_minutes': r.duration_seconds // 60,
                    'joined_at': r.joined_at.isoformat(),
                    'left_at': r.left_at.isoformat() if r.left_at else None
                } for r in records]
            }

            return report

        except Exception as e:
            logger.error(f"Failed to generate attendance report: {str(e)}")
            return {}

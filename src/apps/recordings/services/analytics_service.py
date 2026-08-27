"""Analytics service"""
import logging
from django.utils import timezone
from django.db.models import Count, Q, Avg
from src.apps.recordings.models import MeetingAnalytics, Attendance
from src.apps.meetings.models import Meeting, MeetingParticipant
from src.apps.monitoring.models import MeetingEvent

logger = logging.getLogger(__name__)


class AnalyticsService:
    """Analyze meeting metrics and engagement"""

    @staticmethod
    def calculate_meeting_analytics(meeting_id):
        """Calculate all analytics for a meeting"""
        try:
            meeting = Meeting.objects.get(id=meeting_id)

            # Get/create analytics record
            analytics, created = MeetingAnalytics.objects.get_or_create(
                meeting=meeting
            )

            # Participants
            participants = MeetingParticipant.objects.filter(meeting=meeting)
            analytics.total_participants = participants.count()

            # Duration
            if meeting.started_at and meeting.ended_at:
                analytics.total_duration_seconds = int(
                    (meeting.ended_at - meeting.started_at).total_seconds()
                )

            # Get attendance records for peak calculation
            attendance = Attendance.objects.filter(meeting=meeting)
            if attendance.exists():
                analytics.peak_participants = max(
                    attendance.values_list('participant_id').count(),
                    analytics.total_participants
                )

            # Engagement
            events = MeetingEvent.objects.filter(meeting=meeting)
            analytics.messages_count = events.filter(
                event_type=MeetingEvent.EventType.MESSAGE_SENT
            ).count() if hasattr(MeetingEvent.EventType, 'MESSAGE_SENT') else 0
            analytics.screen_shares_count = events.filter(
                event_type=MeetingEvent.EventType.SCREEN_SHARE_STARTED
            ).count()

            # Calculate engagement score (0-100)
            engagement = 0
            if analytics.total_participants > 0:
                engagement += min(50, analytics.total_participants * 5)  # 50 points for participants
            if analytics.messages_count > 0:
                engagement += min(30, analytics.messages_count * 3)  # 30 points for messages
            if analytics.screen_shares_count > 0:
                engagement += min(20, analytics.screen_shares_count * 5)  # 20 points for screen shares

            analytics.participant_engagement_score = min(100, engagement)

            analytics.save()

            logger.info(f"Calculated analytics for meeting {meeting_id}")
            return analytics

        except Meeting.DoesNotExist:
            logger.error(f"Meeting {meeting_id} not found")
            return None
        except Exception as e:
            logger.error(f"Failed to calculate analytics: {str(e)}")
            return None

    @staticmethod
    def get_user_analytics(user_id):
        """Get analytics for all meetings hosted by user"""
        try:
            meetings = Meeting.objects.filter(host_id=user_id)

            total_meetings = meetings.count()
            total_participants = MeetingParticipant.objects.filter(
                meeting__host_id=user_id
            ).count()
            total_duration = sum(
                (m.ended_at - m.started_at).total_seconds() if m.ended_at and m.started_at else 0
                for m in meetings
            ) / 3600  # hours

            analytics_records = MeetingAnalytics.objects.filter(meeting__host_id=user_id)
            avg_engagement = analytics_records.aggregate(Avg('participant_engagement_score'))[
                'participant_engagement_score__avg'
            ] or 0

            return {
                'total_meetings': total_meetings,
                'total_participants': total_participants,
                'total_hours': round(total_duration, 2),
                'avg_engagement_score': round(avg_engagement, 1),
                'meetings': [{
                    'code': m.meeting_code,
                    'title': m.title,
                    'date': m.started_at.isoformat() if m.started_at else None,
                    'participants': MeetingParticipant.objects.filter(meeting=m).count()
                } for m in meetings.order_by('-started_at')[:10]]
            }

        except Exception as e:
            logger.error(f"Failed to get user analytics: {str(e)}")
            return {}

    @staticmethod
    def get_platform_analytics():
        """Get platform-wide analytics"""
        try:
            total_meetings = Meeting.objects.count()
            active_meetings = Meeting.objects.filter(status=Meeting.Status.ACTIVE).count()
            total_participants = MeetingParticipant.objects.count()

            meetings_last_30_days = Meeting.objects.filter(
                created_at__gte=timezone.now() - timezone.timedelta(days=30)
            ).count()

            avg_engagement = MeetingAnalytics.objects.aggregate(
                Avg('participant_engagement_score')
            )['participant_engagement_score__avg'] or 0

            return {
                'total_meetings': total_meetings,
                'active_meetings': active_meetings,
                'total_participants': total_participants,
                'meetings_last_30_days': meetings_last_30_days,
                'avg_engagement_score': round(avg_engagement, 1),
                'platform_health': 'good' if avg_engagement > 70 else 'fair' if avg_engagement > 50 else 'poor'
            }

        except Exception as e:
            logger.error(f"Failed to get platform analytics: {str(e)}")
            return {}

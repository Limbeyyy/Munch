"""Admin and analytics views"""
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from src.apps.recordings.models import Recording, Attendance, MeetingAnalytics
from src.apps.recordings.services.analytics_service import AnalyticsService
from src.apps.meetings.models import Meeting


class AdminDashboardView(viewsets.GenericViewSet):
    """Admin dashboard endpoints"""
    permission_classes = [permissions.IsAdminUser]

    @action(detail=False, methods=['get'])
    def platform_stats(self, request):
        """Get platform-wide statistics"""
        stats = AnalyticsService.get_platform_analytics()
        return Response(stats)

    @action(detail=False, methods=['get'])
    def user_stats(self, request):
        """Get stats for current user's meetings"""
        stats = AnalyticsService.get_user_analytics(request.user.id)
        return Response(stats)

    @action(detail=False, methods=['get'])
    def recent_meetings(self, request):
        """Get recent meetings with analytics"""
        meetings = Meeting.objects.all().order_by('-created_at')[:10]
        data = [{
            'code': m.meeting_code,
            'title': m.title,
            'host': m.host.email,
            'participants': m.get_participant_count(),
            'created_at': m.created_at.isoformat(),
            'status': m.status
        } for m in meetings]
        return Response(data)

    @action(detail=True, methods=['get'])
    def meeting_analytics(self, request, pk=None):
        """Get detailed analytics for a meeting"""
        try:
            meeting = Meeting.objects.get(id=pk)
            analytics = MeetingAnalytics.objects.get(meeting=meeting)

            return Response({
                'meeting_code': meeting.meeting_code,
                'title': meeting.title,
                'total_participants': analytics.total_participants,
                'duration_minutes': analytics.total_duration_seconds // 60,
                'engagement_score': analytics.participant_engagement_score,
                'messages': analytics.messages_count,
                'screen_shares': analytics.screen_shares_count,
                'bandwidth_mb': analytics.bandwidth_used_mb
            })
        except Meeting.DoesNotExist:
            return Response({'error': 'Meeting not found'}, status=status.HTTP_404_NOT_FOUND)
        except MeetingAnalytics.DoesNotExist:
            return Response({'error': 'Analytics not found'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['get'])
    def attendance_report(self, request, meeting_id):
        """Get attendance report for meeting"""
        from src.apps.recordings.services.recording_service import RecordingService
        try:
            report = RecordingService.get_attendance_report(meeting_id)
            return Response(report)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def recording_queue(self, request):
        """Get recording processing queue"""
        processing = Recording.objects.filter(status=Recording.Status.PROCESSING)
        failed = Recording.objects.filter(status=Recording.Status.FAILED)

        return Response({
            'processing': processing.count(),
            'failed': failed.count(),
            'queue': [{
                'meeting': r.meeting.meeting_code,
                'status': r.status,
                'started': r.start_time.isoformat()
            } for r in processing[:20]]
        })

    @action(detail=True, methods=['post'])
    def retry_recording(self, request, pk=None):
        """Retry failed recording processing"""
        try:
            recording = Recording.objects.get(id=pk)
            if recording.status == Recording.Status.FAILED:
                recording.status = Recording.Status.PROCESSING
                recording.save()

                from src.workers.recording_worker import process_recording
                process_recording.delay(str(recording.id))

                return Response({'message': 'Recording retry initiated'})
            else:
                return Response({'error': 'Recording not in failed state'}, status=status.HTTP_400_BAD_REQUEST)
        except Recording.DoesNotExist:
            return Response({'error': 'Recording not found'}, status=status.HTTP_404_NOT_FOUND)

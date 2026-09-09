"""Endpoints for the event / meeting / session hierarchy."""
import logging

from django.db.models import Prefetch
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from src.apps.meetings.event_serializers import (
    ContactRequestSerializer,
    EventCreateSerializer,
    EventSerializer,
    MeetingWriteSerializer,
    SessionAttendanceSerializer,
    SessionSerializer,
    build_meeting,
)
from src.apps.meetings.lifecycle import (
    broadcast as _broadcast,
    deadline_passed,
    scheduled_end,
    sweep_expired,
    close_session as _close_session,
    session_is_over as _session_is_over,
)
from src.apps.meetings.models import (
    RoleGrant,
    SessionSummary,
    ContactRequest,
    Event,
    Meeting,
    Session,
    SessionAttendance,
)

logger = logging.getLogger(__name__)


class EventViewSet(viewsets.ModelViewSet):
    """A day's programme, with the meetings and sessions inside it."""
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # An organizer sees the programmes they run; everyone else sees the
        # ones they were invited into or have joined. Meetings and sessions
        # are prefetched because the list view always renders the tree.
        from src.apps.meetings.access import events_visible_to
        from src.apps.meetings.access import sessions_visible_to

        # Close anything that overran before drawing the programme, so the
        # tree never shows a session as live past the time it was given.
        sweep_expired(Session.objects.filter(sessions_visible_to(self.request.user)))

        return (
            Event.objects.filter(events_visible_to(self.request.user))
            .distinct()
            .prefetch_related(
                Prefetch(
                    'meetings',
                    queryset=Meeting.objects.order_by('scheduled_start')
                    .prefetch_related('sessions'),
                )
            )
        )

    def get_serializer_class(self):
        return EventCreateSerializer if self.action == 'create' else EventSerializer

    def create(self, request, *args, **kwargs):
        from src.apps.accounts.plans import check_can_create_event, check_session_count
        from src.apps.accounts.roles import ensure_host

        check_can_create_event(request.user)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        for meeting in serializer.validated_data.get('meetings') or []:
            check_session_count(
                request.user,
                len(meeting.get('sessions') or []),
                f'"{meeting.get("title", "a meeting")}"',
            )

        # Opening a programme is the decision to host; record it once it sticks.
        ensure_host(request.user)
        event = serializer.save()
        logger.info(f"Created event {event.id} with {event.meetings.count()} meetings")
        return Response(
            EventSerializer(event, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['get'], url_path='import_template')
    def import_template(self, request):
        """The blank sheet to fill in, with its notes and an example."""
        from django.http import HttpResponse

        from src.apps.meetings.importing import template_csv

        response = HttpResponse(template_csv(), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = (
            'attachment; filename="manch-programme-template.csv"'
        )
        return response

    @action(
        detail=False,
        methods=['post'],
        url_path='import_sheet',
        parser_classes=[MultiPartParser, FormParser],
    )
    def import_sheet(self, request):
        """Build a programme from a filled-in template.

        The rows become the same payload the form sends and go through the
        same serializer, so a sheet cannot make a programme the form would
        have refused - the spacing, the speaker details and the plan's
        limits are all still enforced, once, where they live.

        ``dry_run`` reads the sheet and says what it would make without
        making it, which is what the screen offers before committing.
        """
        from django.db import transaction

        from src.apps.meetings.event_serializers import EventCreateSerializer
        from src.apps.meetings.importing import ImportProblem, read_sheet

        sheet = request.FILES.get('file')
        if sheet is None:
            return Response(
                {'error': 'No sheet provided', 'code': 'no_file'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if sheet.size > 2 * 1024 * 1024:
            return Response(
                {'error': 'That sheet is larger than 2MB.', 'code': 'too_large'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            programmes = read_sheet(sheet.read())
        except ImportProblem as problem:
            return Response(problem.as_json(), status=status.HTTP_400_BAD_REQUEST)

        dry_run = str(request.data.get('dry_run', '')).lower() in ('1', 'true', 'yes')

        reading = [
            {
                'title': event['title'],
                'event_date': event['event_date'],
                'venue': event['venue'],
                'meetings': [
                    {
                        'title': meeting['title'],
                        'scheduled_start': meeting['scheduled_start'],
                        'sessions': [
                            {
                                'title': session['title'],
                                'starts_at': session['starts_at'],
                                'duration_minutes': session['duration_minutes'],
                                'speaker_name': session['speaker_name'],
                                'hall': session['hall'],
                            }
                            for session in meeting['sessions']
                        ],
                    }
                    for meeting in event['meetings']
                ],
            }
            for event in programmes
        ]

        if dry_run:
            return Response({'dry_run': True, 'programmes': reading})

        made = []
        try:
            # All of it or none: half a programme is worse than a refusal,
            # because the half that landed has to be found and undone by
            # hand.
            with transaction.atomic():
                for event in programmes:
                    serializer = EventCreateSerializer(
                        data=event, context={'request': request}
                    )
                    serializer.is_valid(raise_exception=True)
                    made.append(serializer.save())
        except ValidationError as refusal:
            return Response(
                {
                    'error': 'The sheet was read, but the programme was refused.',
                    'code': 'refused',
                    'detail': refusal.detail,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        from src.apps.meetings.event_serializers import EventSerializer

        return Response(
            {
                'created': EventSerializer(made, many=True).data,
                'programmes': reading,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['get', 'post'])
    def invites(self, request, pk=None):
        """Who has been asked to this programme.

        An invitation is to the event, so it reaches every meeting inside
        it: being asked to the day should not mean being asked to each
        room separately. Meetings added later are covered when the invite
        list is next read.
        """
        from src.apps.meetings.models import MeetingInvite
        from src.apps.meetings.serializers import MeetingInviteSerializer

        event = self.get_object()
        if str(event.organizer_id) != str(request.user.id):
            return Response(
                {'error': 'Only the organizer can invite people to this event'},
                status=status.HTTP_403_FORBIDDEN
            )

        if request.method == 'POST':
            emails = request.data.get('emails') or []
            if isinstance(emails, str):
                emails = [emails]
            emails = [e.strip().lower() for e in emails if e and e.strip()]
            if not emails:
                return Response(
                    {'error': 'Give at least one email address'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if len(emails) > 500:
                return Response(
                    {'error': 'That is more than 500 addresses in one go'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            added = 0
            for meeting in event.meetings.all():
                for email in emails:
                    _, created = MeetingInvite.objects.get_or_create(
                        meeting=meeting,
                        email=email,
                        defaults={'invited_by': request.user},
                    )
                    added += int(created)
                    _match_existing_participant(meeting, email)

            logger.info(f"Invited {len(emails)} address(es) to event {event.id}")

        invites = MeetingInvite.objects.filter(meeting__event=event).select_related(
            'meeting', 'joined_user'
        )

        # One row per person, since the invitation was to the day.
        by_email = {}
        for invite in invites:
            row = by_email.setdefault(invite.email, {
                'email': invite.email,
                'meetings': 0,
                'joined': False,
                'invited_at': invite.created_at,
            })
            row['meetings'] += 1
            row['joined'] = row['joined'] or invite.joined_at is not None

        return Response({
            'invited': sorted(by_email.values(), key=lambda r: r['email']),
            'total_invited': len(by_email),
            'total_joined': sum(1 for r in by_email.values() if r['joined']),
        })

    @action(detail=True, methods=['get', 'post', 'delete'], url_path='roles')
    def roles(self, request, pk=None):
        """Who helps run this programme, and over how much of it.

        A role is given at one scope - the whole event, one meeting, or one
        session - and reaches exactly that far. Naming somebody a co-host of
        the morning does not make them one in the evening; that is a
        separate decision, taken here again.

        Speakers are listed alongside but not stored here: a session names
        its own speaker, and naming them is what makes them its presenter.
        """
        from src.apps.meetings.event_serializers import RoleGrantSerializer
        from src.apps.meetings.roles import claim_grants, grants_in_event, speakers_of

        event = self.get_object()
        if str(event.organizer_id) != str(request.user.id):
            return Response(
                {'error': 'Only the organizer sets the roles'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if request.method == 'GET':
            return Response({
                'granted': RoleGrantSerializer(grants_in_event(event), many=True).data,
                'speakers': [
                    {
                        'name': speaker['name'],
                        'email': speaker['email'],
                        'sessions': [
                            {'id': str(s.id), 'title': s.title, 'meeting': s.meeting.title}
                            for s in speaker['sessions']
                        ],
                    }
                    for speaker in speakers_of(event)
                ],
            })

        if request.method == 'DELETE':
            removed, _ = grants_in_event(event).filter(
                id=request.data.get('id')
            ).delete()
            if not removed:
                return Response(
                    {'error': 'No such role in this programme'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            return Response(status=status.HTTP_204_NO_CONTENT)

        email = (request.data.get('email') or '').strip()
        role = request.data.get('role')
        scope = request.data.get('scope')
        scope_id = request.data.get('scope_id')

        if not email:
            return Response(
                {'error': 'Give the address to send it to.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if role not in RoleGrant.Role.values:
            return Response(
                {'error': "role must be 'co_host' or 'presenter'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target = _resolve_scope(event, scope, scope_id)
        if target is None:
            return Response(
                {'error': 'Name what the role covers: this event, one of its '
                          'meetings, or one session of one.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        grant, created = RoleGrant.objects.get_or_create(
            email=email, role=role, **target,
            defaults={'granted_by': request.user},
        )
        # If that address already has an account, tie them together now
        # rather than waiting for them to arrive.
        claim_grants_for_address(grant)

        logger.info(f"{email} given {role} over a {grant.scope} in event {event.id}")
        return Response(
            RoleGrantSerializer(grant).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=['post'])
    def meetings(self, request, pk=None):
        """Add a meeting, with its sessions, to an existing event."""
        from src.apps.accounts.plans import check_can_add_meeting, check_session_count

        event = self.get_object()
        check_can_add_meeting(request.user, event)

        serializer = MeetingWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        check_session_count(
            request.user, len(serializer.validated_data.get('sessions') or [])
        )

        meeting = build_meeting(serializer.validated_data, event=event)
        from src.apps.meetings.event_serializers import MeetingSummarySerializer

        return Response(
            MeetingSummarySerializer(meeting).data, status=status.HTTP_201_CREATED
        )


class SessionViewSet(viewsets.ModelViewSet):
    """Segments of the running order inside a meeting."""
    serializer_class = SessionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # A session is visible to whoever may see the meeting holding it.
        from src.apps.meetings.access import sessions_visible_to

        queryset = (
            Session.objects.filter(sessions_visible_to(self.request.user))
            .distinct()
            .select_related('meeting')
        )

        # Anything left on stage past its slot is closed before the running
        # order is handed out, so nobody reads a session as live when its
        # time ran out an hour ago.
        sweep_expired(queryset)

        # A meeting is addressed by its id or its room code, and only one of
        # those parses as a UUID.
        meeting_ref = self.request.query_params.get('meeting')
        if meeting_ref:
            import uuid as _uuid

            try:
                _uuid.UUID(str(meeting_ref))
            except (ValueError, AttributeError, TypeError):
                queryset = queryset.filter(meeting__meeting_code=meeting_ref)
            else:
                queryset = queryset.filter(meeting_id=meeting_ref)
        return queryset

    def _require_host(self, session):
        if str(session.meeting.host_id) != str(self.request.user.id):
            return Response(
                {'error': 'Only the host can change the running order'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    def perform_create(self, serializer):
        meeting = serializer.validated_data['meeting']
        if str(meeting.host_id) != str(self.request.user.id):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Only the host can add sessions')

        from src.apps.accounts.plans import check_can_add_sessions
        from src.apps.meetings.scheduling import check_slot

        check_can_add_sessions(self.request.user, meeting)

        # A session being added has to fit the day as it stands. Moving one
        # that already exists is the other case, and that one shifts the
        # rest instead of being refused - see perform_update.
        check_slot(
            meeting,
            serializer.validated_data['starts_at'],
            serializer.validated_data.get('duration_minutes', 30),
        )
        serializer.save()

    def perform_update(self, serializer):
        """Move a session, and carry the rest of the day along with it.

        This is the agenda's behaviour applied wherever a session is
        edited: the order and the durations stand, the fifteen-minute gap
        stands, and everything after the change slides forward as far as it
        must. The shift is worked out and written in one locked
        transaction, so simultaneous edits cannot leave an overlap behind.
        """
        session = serializer.instance
        if str(session.meeting.host_id) != str(self.request.user.id):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Only the host can change the running order')

        from src.apps.meetings.scheduling import reschedule

        session = serializer.save()

        timing = {
            field: getattr(session, field)
            for field in ('starts_at', 'duration_minutes', 'hall')
            if field in serializer.validated_data
        }
        if timing:
            reschedule(session.meeting, {session.id: timing}, anchored_id=session.id)
            session.refresh_from_db()

    def perform_destroy(self, instance):
        if str(instance.meeting.host_id) != str(self.request.user.id):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Only the host can remove sessions')
        instance.delete()

    @action(detail=False, methods=['post'])
    def reschedule(self, request):
        """Save a whole rearranged day in one go.

        The agenda works out the new times as the organizer drags things
        about, and sends the finished plan here. Applying it as one locked
        transaction is what keeps two organizers saving at the same moment
        from interleaving into an overlap - and the server re-settles the
        plan on arrival, so a hand-made request cannot smuggle in an
        overlap the agenda would never have produced.
        """
        from src.apps.meetings.scheduling import reschedule as apply_reschedule

        changes = request.data.get('changes') or []
        if not isinstance(changes, list) or not changes:
            return Response(
                {'error': 'Send the sessions to move under "changes".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        wanted = {}
        for change in changes:
            session = self.get_queryset().filter(id=change.get('id')).first()
            if session is None:
                return Response(
                    {'error': f"No session {change.get('id')} in your programme"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if str(session.meeting.host_id) != str(request.user.id):
                return Response(
                    {'error': 'Only the host can change the running order'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            wanted[session] = change

        meeting = next(iter(wanted)).meeting
        edits = {}
        for session, change in wanted.items():
            edit = {}
            if change.get('starts_at'):
                edit['starts_at'] = parse_datetime(change['starts_at'])
            if change.get('duration_minutes') is not None:
                edit['duration_minutes'] = int(change['duration_minutes'])
            if change.get('hall') is not None:
                edit['hall'] = change['hall']
            edits[session.id] = edit

        moved = apply_reschedule(meeting, edits)
        return Response({
            'moved': SessionSerializer(moved, many=True).data,
            'moved_count': len(moved),
        })

    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        """Put this session on stage.

        Only one session runs at a time, so any other live session in the
        same meeting is closed first - otherwise transcript lines would not
        know which segment they belong to.
        """
        session = self.get_object()
        denied = self._require_host(session)
        if denied:
            return denied

        if session.status == Session.Status.LIVE:
            return Response(SessionSerializer(session).data)

        # A slot that has already been and gone cannot simply be opened
        # late: the schedule is what everyone else is reading, so it has to
        # be corrected before the session can run. Starting early is a
        # different matter and only warrants the warning the organizer
        # panel already gives.
        if deadline_passed(session):
            from src.apps.meetings.scheduling import earliest_start

            over_at = scheduled_end(session)
            soonest = earliest_start(session.meeting, exclude_id=session.id)
            return Response(
                {
                    'error': (
                        f'"{session.title}" was scheduled to finish at '
                        f'{timezone.localtime(over_at):%d %b %H:%M}. '
                        'Give it a new time before starting it.'
                    ),
                    'code': 'deadline_passed',
                    'scheduled_end': over_at.isoformat(),
                    'earliest_start': soonest.isoformat() if soonest else None,
                },
                status=status.HTTP_409_CONFLICT,
            )

        now = timezone.now()
        for other in session.meeting.sessions.filter(status=Session.Status.LIVE):
            _close_session(other, now)

        # A new run, not a rejoin: anything already on stage returned
        # further up, so reaching here means the clock starts now. Keeping
        # an older stamp would have the room counting from a sitting that
        # finished long ago.
        session.status = Session.Status.LIVE
        session.started_at = now
        session.ended_at = None
        session.save(update_fields=['status', 'started_at', 'ended_at', 'updated_at'])

        # A session on stage means the meeting is happening, so the room
        # opens with it rather than waiting to be started separately.
        meeting = session.meeting
        if meeting.status != Meeting.Status.ACTIVE:
            # Not running, so this opens it afresh and the clock starts now.
            meeting.status = Meeting.Status.ACTIVE
            meeting.started_at = now
            meeting.ended_at = None
            meeting.save(update_fields=['status', 'started_at', 'ended_at', 'updated_at'])

        _broadcast(meeting.meeting_code, session, 'session_started')
        return Response(SessionSerializer(session).data)

    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        """Close the session and record who was in the room for it."""
        session = self.get_object()
        denied = self._require_host(session)
        if denied:
            return denied

        recorded = _close_session(session, timezone.now())
        _broadcast(session.meeting.meeting_code, session, 'session_ended')

        from src.apps.meetings.lifecycle import close_meeting_if_spent
        from src.apps.meetings.views import broadcast_attendance_changed

        broadcast_attendance_changed(session.meeting)

        # The host ending the last session has ended the meeting. Not at
        # half past when its window happens to close - now, with the room
        # emptied and everybody told, so no screen is left saying a meeting
        # is running that the host has finished with.
        meeting_ended = close_meeting_if_spent(
            session.meeting, wait_for_window=False
        )
        if meeting_ended:
            session.meeting.refresh_from_db()

        return Response({
            **SessionSerializer(session).data,
            'attendance_recorded': recorded,
            'meeting_status': session.meeting.status,
            'meeting_ended': meeting_ended,
        })

    @action(detail=True, methods=['get'])
    def contact(self, request, pk=None):
        """How to reach this session's speaker, if the asker may know.

        A public speaker is readable once the session is over - the point
        is to let people follow up afterwards, not to hand out a phone
        number while the talk is still running. A private one is readable
        only by the host, and by anyone whose request the host approved.
        """
        session = self.get_object()
        is_host = str(session.meeting.host_id) == str(request.user.id)
        over = _session_is_over(session)

        body = {
            'speaker_name': session.speaker_name,
            'visibility': session.speaker_visibility,
            'session_is_over': over,
            'released': False,
            'request_status': None,
        }

        if session.speaker_visibility == Session.SpeakerVisibility.PUBLIC:
            body['released'] = over or is_host
            if not body['released']:
                body['reason'] = 'These open when the session is over.'
        else:
            standing = ContactRequest.objects.filter(
                session=session, user=request.user
            ).first()
            body['request_status'] = standing.status if standing else None
            approved = standing and standing.status == ContactRequest.Status.APPROVED
            body['released'] = bool(is_host or (approved and over))
            if not body['released']:
                body['reason'] = (
                    'The host passes these on.' if not approved
                    else 'These open when the session is over.'
                )

        if body['released']:
            body['email'] = session.speaker_email
            body['phone'] = session.speaker_phone

        return Response(body)

    @action(detail=False, methods=['post'], url_path='set_visibility')
    def set_visibility(self, request):
        """List a speaker publicly, or take them back off the list.

        A speaker is one person across however many sessions they appear
        in, so the organizer's card sets all of them at once rather than
        making them find each session. Public and private are one field
        with two values, not two switches - they cannot both be on.

        Turning a speaker private takes effect at once: the contact
        endpoint reads the stored visibility every time, so nothing stays
        readable on the strength of having been public a moment ago.
        Approvals already given stand, because an approval is a decision
        about a person, not about the setting that prompted it.
        """
        wanted = request.data.get('visibility')
        if wanted not in Session.SpeakerVisibility.values:
            return Response(
                {'error': "visibility must be 'public' or 'private'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ids = request.data.get('session_ids') or []
        if not isinstance(ids, list) or not ids:
            return Response(
                {'error': 'Name the sessions under "session_ids".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sessions = list(self.get_queryset().filter(id__in=ids))
        if len(sessions) != len(set(str(i) for i in ids)):
            return Response(
                {'error': 'One of those sessions is not in your programme'},
                status=status.HTTP_404_NOT_FOUND,
            )
        for session in sessions:
            if str(session.meeting.host_id) != str(request.user.id):
                return Response(
                    {'error': 'Only the host can change a speaker\'s visibility'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        changed = [s for s in sessions if s.speaker_visibility != wanted]
        for session in changed:
            session.speaker_visibility = wanted
            session.save(update_fields=['speaker_visibility', 'updated_at'])

        logger.info(
            f"Speaker visibility set to {wanted} on {len(changed)} session(s)"
        )
        return Response({
            'visibility': wanted,
            'sessions': SessionSerializer(
                sessions, many=True, context=self.get_serializer_context()
            ).data,
            'changed': len(changed),
        })

    @action(detail=True, methods=['post'], url_path='request_contact')
    def request_contact(self, request, pk=None):
        """Ask the host to pass on a private speaker's details."""
        session = self.get_object()

        if session.speaker_visibility == Session.SpeakerVisibility.PUBLIC:
            return Response(
                {'error': 'This speaker is listed publicly - no request is needed.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        existing = ContactRequest.objects.filter(
            session=session, user=request.user
        ).first()
        if existing:
            return Response(ContactRequestSerializer(existing).data)

        created = ContactRequest.objects.create(
            session=session,
            user=request.user,
            reason=(request.data.get('reason') or '').strip()[:2000],
        )
        logger.info(f"Contact request {created.id} for session {session.id}")
        return Response(
            ContactRequestSerializer(created).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['post'], url_path='decide_contact')
    def decide_contact(self, request, pk=None):
        """Pass a request on, or turn it down. Host only."""
        session = self.get_object()
        denied = self._require_host(session)
        if denied:
            return denied

        contact_request = ContactRequest.objects.filter(
            id=request.data.get('request_id'), session=session
        ).first()
        if contact_request is None:
            return Response(
                {'error': 'No such request on this session'},
                status=status.HTTP_404_NOT_FOUND
            )

        decision = request.data.get('decision')
        if decision not in ('approve', 'decline'):
            return Response(
                {'error': "decision must be 'approve' or 'decline'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        contact_request.status = (
            ContactRequest.Status.APPROVED if decision == 'approve'
            else ContactRequest.Status.DECLINED
        )
        contact_request.decided_at = timezone.now()
        contact_request.decided_by = request.user
        contact_request.save(update_fields=['status', 'decided_at', 'decided_by'])

        return Response(ContactRequestSerializer(contact_request).data)

    @action(detail=False, methods=['get'], url_path='contact_requests')
    def contact_requests(self, request):
        """Requests waiting on the host, across a meeting or everything."""
        requests = ContactRequest.objects.filter(
            session__meeting__host=request.user
        ).select_related('session', 'session__meeting', 'user', 'guest')

        meeting_ref = request.query_params.get('meeting')
        if meeting_ref:
            import uuid as _uuid

            try:
                _uuid.UUID(str(meeting_ref))
            except (ValueError, AttributeError, TypeError):
                requests = requests.filter(session__meeting__meeting_code=meeting_ref)
            else:
                requests = requests.filter(session__meeting_id=meeting_ref)

        event_id = request.query_params.get('event')
        if event_id:
            requests = requests.filter(session__meeting__event_id=event_id)

        state = request.query_params.get('status')
        if state:
            requests = requests.filter(status=state)

        return Response(
            ContactRequestSerializer(
                requests.order_by('-created_at'), many=True
            ).data
        )

    @action(detail=True, methods=['get', 'put'], url_path='summary')
    def summary(self, request, pk=None):
        """Read or rewrite a session's summary.

        A summary that has never been written comes back as a draft of the
        transcript, which is what somebody writing one starts from. It is
        not saved until they save it - an empty session should not acquire
        a summary just because a page was opened.
        """
        from src.apps.meetings.event_serializers import SessionSummarySerializer

        session = self.get_object()
        is_host = str(session.meeting.host_id) == str(request.user.id)
        existing = SessionSummary.objects.filter(session=session).first()

        if request.method == 'GET':
            if existing is None:
                if not is_host:
                    return Response(
                        {'error': 'There is no summary for this session yet'},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                return Response({
                    'session': str(session.id),
                    'session_title': session.title,
                    'body': _transcript_of(session),
                    'status': SessionSummary.Status.NEEDS_APPROVAL,
                    'is_published': False,
                    'saved': False,
                    'published_at': None,
                })

            # A draft is the host's working copy; nobody else reads it.
            if not existing.is_published and not is_host:
                return Response(
                    {'error': 'This summary has not been published yet'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            return Response(SessionSummarySerializer(existing).data)

        denied = self._require_host(session)
        if denied:
            return denied

        body = request.data.get('body')
        if body is None and 'actions' in request.data and existing is not None:
            # Only the action list is being changed; the prose stays.
            body = existing.body
        if body is None:
            return Response(
                {'error': 'Send the summary under "body".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        summary, _ = SessionSummary.objects.get_or_create(session=session)
        summary.body = body

        if 'actions' in request.data:
            from src.apps.meetings.conclusions import tidy_actions

            try:
                summary.actions = tidy_actions(request.data['actions'])
            except ValueError as wrong:
                return Response(
                    {'error': str(wrong), 'code': 'bad_actions'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        summary.updated_by = request.user
        # Editing a published summary sends it back for approval: what is
        # public should always be something somebody signed off on.
        if summary.is_published:
            summary.status = SessionSummary.Status.NEEDS_APPROVAL
            summary.published_at = None
        summary.save()
        return Response(SessionSummarySerializer(summary).data)

    @action(detail=True, methods=['post'], url_path='publish_summary')
    def publish_summary(self, request, pk=None):
        """Let a summary out to everyone who was in the session. Host only."""
        from src.apps.meetings.event_serializers import SessionSummarySerializer

        session = self.get_object()
        denied = self._require_host(session)
        if denied:
            return denied

        summary = SessionSummary.objects.filter(session=session).first()
        if summary is None or not summary.body.strip():
            return Response(
                {'error': 'Write the summary before publishing it'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        summary.status = SessionSummary.Status.PUBLISHED
        summary.published_at = timezone.now()
        summary.updated_by = request.user
        summary.save(update_fields=['status', 'published_at', 'updated_by', 'updated_at'])

        logger.info(f"Summary published for session {session.id}")
        return Response(SessionSummarySerializer(summary).data)

    @action(detail=True, methods=['get'])
    def attendance(self, request, pk=None):
        """Who was present for this session."""
        session = self.get_object()
        rows = session.attendance.select_related('user', 'guest')
        return Response(SessionAttendanceSerializer(rows, many=True).data)

    @action(detail=True, methods=['post'], url_path='mark')
    def mark(self, request, pk=None):
        """Tick somebody off by hand, for a person the room did not see."""
        session = self.get_object()
        denied = self._require_host(session)
        if denied:
            return denied

        user_id = request.data.get('user_id')
        guest_id = request.data.get('guest_id')
        if bool(user_id) == bool(guest_id):
            return Response(
                {'error': 'Name exactly one of user_id or guest_id'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        present = request.data.get('present', True)
        lookup = {'session': session, 'user_id': user_id, 'guest_id': guest_id}

        if present:
            SessionAttendance.objects.get_or_create(
                **lookup, defaults={'marked_manually': True}
            )
        else:
            SessionAttendance.objects.filter(**lookup).delete()

        # The attendance screens follow this rather than waiting to be
        # reloaded.
        from src.apps.meetings.views import broadcast_attendance_changed

        broadcast_attendance_changed(session.meeting)
        return Response({'present': bool(present)})


def _match_existing_participant(meeting, email):
    """Tie an invitation to somebody who had already joined.

    Inviting an address after the person walked in should still count as
    them having turned up.
    """
    from src.apps.meetings.models import MeetingInvite

    invite = MeetingInvite.objects.filter(
        meeting=meeting, email__iexact=email, joined_at__isnull=True
    ).first()
    if invite is None:
        return

    participant = meeting.participants.filter(
        user__email__iexact=email
    ).select_related('user').first()
    if participant:
        invite.joined_at = participant.joined_at
        invite.joined_user = participant.user
        invite.save(update_fields=['joined_at', 'joined_user'])


def _resolve_scope(event, scope, scope_id):
    """Turn a named scope into the field that records it.

    Everything has to sit inside the programme being edited, so a meeting
    id from somebody else's event cannot be smuggled through.
    """
    if scope == 'event':
        return {'event': event}
    if scope == 'meeting':
        meeting = Meeting.objects.filter(id=scope_id, event=event).first()
        return {'meeting': meeting} if meeting else None
    if scope == 'session':
        session = Session.objects.filter(
            id=scope_id, meeting__event=event
        ).first()
        return {'session': session} if session else None
    return None


def claim_grants_for_address(grant):
    """Link a grant to the account holding that address, if there is one."""
    from src.apps.accounts.models import User

    if grant.user_id:
        return
    owner = User.objects.filter(email__iexact=grant.email).first()
    if owner:
        grant.user = owner
        grant.save(update_fields=['user'])


def _transcript_of(session) -> str:
    """The session's spoken record, as a starting point for a summary."""
    from src.apps.transcription.models import TranscriptionSegment

    lines = TranscriptionSegment.objects.filter(
        session=session, is_final=True
    ).order_by('start_time').values_list('text', flat=True)
    return ' '.join(line.strip() for line in lines if line and line.strip())

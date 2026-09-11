import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMeetingStore } from '../store/meetingStore';
import { useAuthStore } from '../store/authStore';
import { apiClient } from '../services/api';
import { RESOURCE_POLL_MS } from '../services/polling';
import {
  Artifact, AttendanceReport, ChatMessage, ChatSettings, Session,
  GuestAttendee, MeetingParticipant,
} from '../types';
import toast from 'react-hot-toast';
import { ShareMeetingDialog } from '../components/ShareMeetingDialog';
import { ResourceControls } from '../organizer/ResourceVisibility';
import { PhotoUploads } from '../organizer/Photos';
import { MessageBoard } from '../organizer/MessageBoard';
import { FigmaIcon, FigmaIconName } from '../assets/icons';
import { OrganizerProvider } from '../organizer/i18n';


const formatFileSize = (bytes?: number | null): string => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
};

const formatElapsed = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
};

const MeetingRoomInner: React.FC = () => {
  const { meetingCode } = useParams<{ meetingCode: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentMeeting, setMeeting, participants, setParticipants, transcript, addTranscriptSegment } = useMeetingStore();
  const wsRef = useRef<WebSocket | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [resources, setResources] = useState<Artifact[]>([]);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Chat
  const [showChat, setShowChat] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    chat_enabled: false,
    direct_messages_enabled: false,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [dmTarget, setDmTarget] = useState<string>('');
  const [unread, setUnread] = useState(0);
  const [chatTab, setChatTab] = useState<'public' | 'private'>('public');
  const [unreadPublic, setUnreadPublic] = useState(0);
  const [unreadPrivate, setUnreadPrivate] = useState(0);
  const chatTabRef = useRef<'public' | 'private'>('public');
  const [savingSettings, setSavingSettings] = useState(false);
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [moderating, setModerating] = useState<string | null>(null);
  const [waitingGuests, setWaitingGuests] = useState<GuestAttendee[]>([]);
  const [decidingGuest, setDecidingGuest] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [showEndChoice, setShowEndChoice] = useState(false);
  const [roomGuests, setRoomGuests] = useState<GuestAttendee[]>([]);
  const [showAttendance, setShowAttendance] = useState(false);
  /** Panels the bar along the foot opens over the room. */
  const [showPeople, setShowPeople] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  /** The meeting's running order, for the agenda down the left. */
  const [agenda, setAgenda] = useState<Session[]>([]);
  const [attendance, setAttendance] = useState<AttendanceReport | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const showChatRef = useRef(false);
  // Read inside the socket handler, which is created once.
  const showAttendanceRef = useRef(false);
  /** The reloads the socket asks for, kept current without rebuilding it. */
  const refreshRef = useRef({
    roster: () => {},
    resources: () => {},
    attendance: () => {},
    meeting: () => {},
  });
  const meetingIdRef = useRef<string | null>(null);
  const elapsedRef = useRef(0);

  // Effects key off these primitives rather than the meeting object, whose
  // identity changes on every refetch and would otherwise tear down the
  // websocket, the camera and the timer.
  const meetingId = currentMeeting?.id ?? null;
  // A room is a session, not a meeting. The meeting may be a whole
  // morning; what people are sitting through is one talk, and that is
  // what the clock on the wall should count.
  const session = currentMeeting?.current_session ?? null;
  const startedAt = session?.started_at ?? null;

  useEffect(() => {
    meetingIdRef.current = meetingId;
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId) { setAgenda([]); return; }
    apiClient.listSessions(meetingId).then(setAgenda).catch(() => setAgenda([]));
  }, [meetingId]);

  /** Refresh participants only - no spinner, no meeting object churn. */
  const refreshParticipants = useCallback(async () => {
    const id = meetingIdRef.current;
    if (!id) return;
    try {
      setParticipants(await apiClient.getParticipants(id));
    } catch {
      // A dropped refresh is not worth interrupting the meeting for.
    }
  }, [setParticipants]);

  useEffect(() => {
    showChatRef.current = showChat;
    showAttendanceRef.current = showAttendance;
    if (showChat) {
      setUnread(0);
      if (chatTab === 'public') setUnreadPublic(0);
      else setUnreadPrivate(0);
    }
  }, [showChat, chatTab, showAttendance]);

  useEffect(() => {
    chatTabRef.current = chatTab;
    // Leaving the room tab means room messages are no longer being read.
    if (chatTab === 'public') setUnreadPublic(0);
    else setUnreadPrivate(0);
  }, [chatTab]);

  const isHost = !!user && currentMeeting?.host?.id === user.id;

  /** Whoever runs the room: the host, or anyone helping run it. */
  const canOrganize =
    isHost ||
    (participants as MeetingParticipant[]).some(
      (p) => p.user?.id === user?.id && ['host', 'co_host'].includes(p.role)
    );
  const visibleMessages = messages.filter((m) =>
    chatTab === 'private' ? m.is_direct : !m.is_direct
  );
  const myRole = (participants as MeetingParticipant[])
    .find((p) => p.user?.id === user?.id)?.role;

  /**
   * Who can be written to privately.
   *
   * Attendees may write to whoever is running the room. Whoever is running
   * it may write back to anybody in it, guests included - a reply you
   * cannot send is not a conversation, and until now the guest side of a
   * private thread simply had no return path: guests are not participants,
   * so they never appeared in this list at all.
   */
  const organizers = (participants as MeetingParticipant[]).filter(
    (p) => p.user?.id !== user?.id && ['host', 'co_host', 'presenter'].includes(p.role)
  );
  const others = (participants as MeetingParticipant[]).filter(
    (p) => p.user?.id !== user?.id && !['host', 'co_host', 'presenter'].includes(p.role)
  );

  const canReplyToAnyone = isHost;
  const dmTargets: { id: string; label: string }[] = [
    ...organizers.map((p) => ({
      id: p.user.id,
      label: `${p.user.email} (${p.role.replace('_', '-')})`,
    })),
    ...(canReplyToAnyone
      ? [
          ...others.map((p) => ({ id: p.user.id, label: p.user.email })),
          ...roomGuests.map((g) => ({ id: g.id, label: `${g.full_name} (guest)` })),
        ]
      : []),
  ];

  const [changingRole, setChangingRole] = useState<string | null>(null);

  const changeRole = async (
    participant: MeetingParticipant,
    role: 'host' | 'co_host' | 'presenter' | 'attendee'
  ) => {
    const id = meetingIdRef.current;
    if (!id || role === participant.role) return;

    if (role === 'host') {
      const ok = window.confirm(
        `Make ${participant.user.email} the host?\n\n` +
        'You will be demoted to co-host and lose host controls, including ' +
        'chat settings and role changes.'
      );
      if (!ok) return;
    }

    try {
      setChangingRole(participant.id);
      await apiClient.updateParticipantRole(id, participant.user.id, role);
      await refreshParticipants();
      if (role === 'host') {
        await loadMeeting();
        toast.success(`${participant.user.email} is now the host`);
      } else {
        toast.success(`${participant.user.email} is now ${role.replace('_', '-')}`);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error ?? 'Could not change role');
    } finally {
      setChangingRole(null);
    }
  };

  const loadChat = useCallback(async () => {
    const id = meetingIdRef.current;
    if (!id) return;
    try {
      const settings = await apiClient.getChatSettings(id);
      setChatSettings(settings);
      if (settings.chat_enabled) {
        setMessages(await apiClient.getChatMessages(id));
      } else {
        setMessages([]);
      }
    } catch {
      // Leave chat closed; the panel explains it needs enabling.
    }
  }, []);

  const toggleChatSetting = async (patch: Partial<ChatSettings>) => {
    const id = meetingIdRef.current;
    if (!id) return;
    try {
      setSavingSettings(true);
      const updated = await apiClient.updateChatSettings(id, patch);
      setChatSettings(updated);
      if (updated.chat_enabled) {
        setMessages(await apiClient.getChatMessages(id));
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error ?? 'Could not update chat settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const loadPending = useCallback(async () => {
    const id = meetingIdRef.current;
    if (!id) return;
    try {
      setPending(await apiClient.getPendingMessages(id));
    } catch {
      // Not the host, or chat closed - nothing to show.
    }
  }, []);

  const moderate = async (
    messageId: string,
    decision: 'approve' | 'decline' | 'remove'
  ) => {
    const id = meetingIdRef.current;
    if (!id) return;
    try {
      setModerating(messageId);
      await apiClient.moderateMessage(id, messageId, decision);
      setPending((prev) => prev.filter((m) => m.id !== messageId));
      toast.success(
        decision === 'approve' ? 'Message forwarded'
          : decision === 'decline' ? 'Message declined'
          : 'Message removed'
      );
    } catch (error: any) {
      toast.error(error.response?.data?.error ?? 'Could not moderate message');
    } finally {
      setModerating(null);
    }
  };

  const loadGuests = useCallback(async () => {
    const id = meetingIdRef.current;
    if (!id) return;
    try {
      const all = await apiClient.getGuests(id);
      setWaitingGuests(all.filter((g) => g.status === 'pending'));
      // The ones already in the room are who the host can write back to.
      setRoomGuests(all.filter((g) => g.status === 'admitted'));
    } catch {
      // Only the host may read this.
    }
  }, []);

  const decideGuest = async (guestId: string, decision: 'admit' | 'deny') => {
    const id = meetingIdRef.current;
    if (!id) return;
    try {
      setDecidingGuest(guestId);
      await apiClient.admitGuest(id, guestId, decision);
      setWaitingGuests((prev) => prev.filter((g) => g.id !== guestId));
      toast.success(decision === 'admit' ? 'Guest admitted' : 'Guest denied');
    } catch (error: any) {
      toast.error(error.response?.data?.error ?? 'Could not update guest');
    } finally {
      setDecidingGuest(null);
    }
  };

  const loadAttendance = useCallback(async () => {
    const id = meetingIdRef.current;
    if (!id) return;
    try {
      setAttendance(await apiClient.getAttendance(id));
    } catch {
      toast.error('Could not load attendance');
    }
  }, []);

  const sendMessage = () => {
    const body = draft.trim();
    if (!body) return;

    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast.error('Not connected to the meeting');
      return;
    }

    socket.send(JSON.stringify({
      type: 'chat_message',
      message: body,
      recipient_id: dmTarget || undefined,
    }));
    setDraft('');
  };

  /**
   * Re-read the meeting without the ceremony of arriving at it.
   *
   * ``loadMeeting`` puts a spinner up, joins the room and checks the door,
   * all of which is right on the way in and wrong for a socket saying the
   * running order moved on.
   */
  const refreshMeeting = useCallback(async () => {
    const id = meetingIdRef.current;
    if (!id || !meetingCode) return;
    try {
      setMeeting(await apiClient.getMeeting(meetingCode));
    } catch {
      // A dropped refresh is not worth interrupting the meeting for.
    }
  }, [meetingCode, setMeeting]);

  const loadMeeting = useCallback(async () => {
    try {
      setIsLoading(true);
      const meeting = await apiClient.getMeeting(meetingCode!);
      setMeeting(meeting);

      // The room opens a quarter of an hour before its hour. Coming
      // earlier is not an error to shout about - say when to come back.
      if (meeting.entry && !meeting.entry.is_open) {
        const opens = new Date(meeting.entry.opens_at);
        toast(
          `This room opens at ${opens.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. It is too early to go in.`,
          { icon: '\u23F1\uFE0F', duration: 6000 }
        );
        navigate('/');
        return;
      }

      // Walking into the room is joining it. Without this the page only
      // ever reads: somebody holding a code is not a participant, so every
      // member endpoint - participants, chat settings, files - answers 404
      // and the room comes up empty. Joining also records that they were
      // here, which is what attendance is counted from.
      await apiClient.joinMeeting(meeting.meeting_code);

      const participants = await apiClient.getParticipants(meeting.id);
      setParticipants(participants);
    } catch (error: any) {
      const refusal = error.response?.data;
      if (refusal?.code === 'too_early') {
        toast(refusal.error, { icon: '\u23F1\uFE0F', duration: 6000 });
      } else if (error.response?.status === 404) {
        toast.error('No meeting with that code.');
      } else {
        toast.error('Failed to load meeting: ' + error.message);
      }
      navigate('/');
    } finally {
      setIsLoading(false);
    }
  }, [meetingCode, navigate, setMeeting, setParticipants]);

  const connectWebSocket = useCallback(() => {
    // The websocket lives on the Django backend, not on the dev server that
    // serves this page, so derive the host from the API URL.
    const apiUrl = new URL(process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1');
    const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';

    // A websocket handshake cannot carry an Authorization header, so the
    // access token goes in the query string.
    const token = localStorage.getItem('access_token');
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const wsUrl = `${protocol}//${apiUrl.host}/ws/meeting/${meetingCode}/${query}`;

    wsRef.current = new WebSocket(wsUrl);
    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'transcription_update' && data.segment) {
        addTranscriptSegment(data.segment);
      } else if (data.type === 'state_update' || data.type === 'participant_joined'
                 || data.type === 'participant_left') {
        refreshParticipants();
        // The running order moving on changes which session the room is
        // holding, and a session ended early is over well before the time
        // it was given. Re-read it: whoever is sitting in a session that
        // has finished should be shown the door, and whoever is sitting in
        // one that has just been handed the stage should stay put.
        if (data.state?.session_ended || data.state?.session_started) {
          refreshRef.current.meeting();
        }
      } else if (data.type === 'chat_message') {
        setMessages((prev) => {
          if (data.message_id && prev.some((m) => m.id === data.message_id)) return prev;
          return [...prev, {
            id: data.message_id ?? `${data.user_id}-${data.timestamp}`,
            body: data.message,
            created_at: data.timestamp,
            is_direct: !!data.is_direct,
            moderation_status: data.moderation_status,
            sender_id: data.user_id,
            sender_name: data.user_name,
            sender_email: null,
            sender_is_guest: !!data.sender_is_guest,
            recipient_id: data.recipient_id ?? null,
            recipient_name: data.recipient_name ?? null,
            recipient_is_guest: !!data.recipient_is_guest,
          }];
        });
        const arrivedPrivate = !!data.is_direct;
        const watching =
          showChatRef.current &&
          chatTabRef.current === (arrivedPrivate ? 'private' : 'public');
        if (!watching) {
          setUnread((n) => n + 1);
          if (arrivedPrivate) setUnreadPrivate((n) => n + 1);
          else setUnreadPublic((n) => n + 1);
        }
      } else if (data.type === 'chat_pending') {
        setPending((prev) =>
          prev.some((m) => m.id === data.message_id) ? prev : [...prev, {
            id: data.message_id,
            body: data.message,
            created_at: data.timestamp,
            is_direct: true,
            moderation_status: 'pending',
            sender_id: data.user_id,
            sender_name: data.user_name,
            sender_email: null,
            sender_is_guest: !!data.sender_is_guest,
            recipient_id: data.recipient_id ?? null,
            recipient_name: data.recipient_name ?? null,
            recipient_is_guest: !!data.recipient_is_guest,
          }]
        );
        if (!showChatRef.current) setUnread((n) => n + 1);
      } else if (data.type === 'chat_moderated') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.message_id
              ? { ...m, moderation_status: data.moderation_status }
              : m
          )
        );
        if (data.moderation_status === 'declined') {
          toast(`Host declined your message to ${data.recipient_name ?? 'them'}`, { icon: '🚫' });
        } else if (data.moderation_status === 'approved') {
          toast.success(`Host forwarded your message to ${data.recipient_name ?? 'them'}`);
        }
      } else if (data.type === 'guest_waiting') {
        setWaitingGuests((prev) =>
          prev.some((g) => g.id === data.guest_id) ? prev : [...prev, {
            id: data.guest_id,
            full_name: data.full_name,
            phone: data.phone,
            status: 'pending',
            created_at: data.created_at,
            decided_at: null,
          }]
        );
        toast(`${data.full_name} is asking to join`, { icon: '🔔' });
      } else if (data.type === 'roster_update') {
        // Somebody came in or stepped out. Ask for the list rather than
        // patching it here: the server already knows who is in the room.
        // Read through refs so this handler - and with it the socket - is
        // not rebuilt every time one of them changes.
        refreshRef.current.roster();
      } else if (data.type === 'resources_update') {
        refreshRef.current.resources();
      } else if (data.type === 'attendance_update') {
        if (showAttendanceRef.current) refreshRef.current.attendance();
      } else if (data.type === 'meeting_started') {
        setMeeting({
          ...(useMeetingStore.getState().currentMeeting as any),
          started_at: data.started_at,
          status: data.status,
        });
      } else if (data.type === 'meeting_ended') {
        toast(
          data.reason === 'time_elapsed'
            ? 'The meeting time is over'
            : 'The host ended the meeting',
          { icon: '👋' }
        );
        navigate('/');
      } else if (data.type === 'chat_settings_update') {
        setChatSettings({
          chat_enabled: data.chat_enabled,
          direct_messages_enabled: data.direct_messages_enabled,
        });
        if (!data.chat_enabled) {
          setMessages([]);
          setDmTarget('');
        }
      } else if (data.type === 'chat_error') {
        toast.error(data.error);
      }
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      toast.error('Connection error');
    };
  }, [meetingCode, addTranscriptSegment, refreshParticipants, setMeeting, navigate]);

  useEffect(() => {
    if (meetingCode) {
      loadMeeting();
    }
  }, [meetingCode, loadMeeting]);

  // Keyed on the meeting id: re-running this on every meeting refetch would
  // drop the websocket and restart the camera mid-call.
  useEffect(() => {
    if (!meetingId) return;

    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [meetingId, connectWebSocket]);

  const loadResources = useCallback(async (meetingId: string) => {
    try {
      setResources(await apiClient.getResources(meetingId));
    } catch {
      // Resources are supplementary; a failure here must not break the room.
    }
  }, []);

  // Keep the socket's reloads pointing at the current functions. The
  // handler holds the ref, not the functions, so the connection survives.
  useEffect(() => {
    refreshRef.current = {
      roster: () => {
        const id = meetingIdRef.current;
        if (id) apiClient.getParticipants(id).then(setParticipants).catch(() => undefined);
      },
      resources: () => {
        const id = meetingIdRef.current;
        if (id) loadResources(id);
      },
      attendance: () => loadAttendance(),
      meeting: () => refreshMeeting(),
    };
  }, [loadResources, loadAttendance, setParticipants, refreshMeeting]);

  // The device streams new lines over the socket; this fills in what was
  // said before we arrived.
  useEffect(() => {
    if (!meetingCode) return;
    apiClient
      .getMeetingSegments(meetingCode)
      .then((segments) => segments.forEach(addTranscriptSegment))
      .catch(() => undefined);
  }, [meetingCode, addTranscriptSegment]);

  useEffect(() => {
    if (meetingId) loadChat();
  }, [meetingId, loadChat]);

  useEffect(() => {
    if (meetingId && isHost && chatSettings.chat_enabled) loadPending();
  }, [meetingId, isHost, chatSettings.chat_enabled, loadPending]);

  useEffect(() => {
    if (meetingId && isHost) loadGuests();
  }, [meetingId, isHost, loadGuests]);

  // Keep the newest message in view while the panel is open.
  useEffect(() => {
    if (showChat) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showChat]);

  // Anyone in the meeting can upload, so poll to pick up other people's
  // files. Also refresh on tab focus, since polling is paused while hidden.
  useEffect(() => {
    if (!meetingId) return;

    loadResources(meetingId);

    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadResources(meetingId);
      }
    }, RESOURCE_POLL_MS);

    const onFocus = () => loadResources(meetingId);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [meetingId, loadResources]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentMeeting) return;

    setUploadPercent(0);
    try {
      const artifact = await apiClient.uploadResource(
        currentMeeting.id,
        file,
        setUploadPercent
      );
      setResources((prev) => [artifact, ...prev]);
      toast.success(`Uploaded ${file.name}`);
    } catch (error: any) {
      const detail = error.response?.data?.error ?? error.message;
      toast.error(`Upload failed: ${detail}`);
    } finally {
      setUploadPercent(null);
      // Allow re-selecting the same file.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * The room shuts when the session it is holding is over.
   *
   * A room is one session. Once that session's time is up there is nothing
   * left to be in, so everybody is shown out rather than left sitting in a
   * room whose clock has stopped meaning anything. The server closes the
   * session itself; this is the room noticing.
   */
  useEffect(() => {
    if (!session?.ends_at) return;

    const shut = () => {
      toast(
        session.title
          ? `“${session.title}” has finished.`
          : 'This session has finished.',
        { icon: '\u2705', duration: 5000 }
      );
      navigate('/');
    };

    if (session.is_over) { shut(); return; }

    const remaining = +new Date(session.ends_at) - Date.now();
    if (remaining <= 0) { shut(); return; }

    const id = setTimeout(shut, remaining);
    return () => clearTimeout(id);
  }, [session?.ends_at, session?.is_over, session?.title, navigate]);

  // Session timer, anchored to the server's started_at so every participant
  // sees the same count, and leaving and returning resumes rather than resets.
  useEffect(() => {
    if (!meetingId || !startedAt) {
      setElapsed(0);
      return;
    }
    const origin = new Date(startedAt).getTime();

    const tick = () => {
      const secs = Math.max(0, Math.floor((Date.now() - origin) / 1000));
      elapsedRef.current = secs;
      setElapsed(secs);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [meetingId, startedAt]);

  /** Host only: closes the meeting for everyone. */
  /** Host only: call the meeting begun. The room was already open. */
  const startMeeting = async () => {
    if (!currentMeeting) return;
    try {
      const started = await apiClient.startMeeting(currentMeeting.id);
      setMeeting({ ...currentMeeting, ...started });
      toast.success('The meeting is under way');
    } catch (error: any) {
      toast.error(
        error.response?.data?.error ?? 'Could not start the meeting'
      );
    }
  };

  /**
   * Host only: end it for everyone.
   *
   * Kept apart from leaving, which is the other thing a host might mean.
   * The two are asked about rather than guessed at, because one of them
   * empties the hall.
   */
  const endMeeting = async () => {
    if (!currentMeeting) return;
    setShowEndChoice(false);
    try {
      await apiClient.endMeeting(currentMeeting.id);
      toast.success('Meeting ended');
      navigate('/');
    } catch (error: any) {
      toast.error(
        error.response?.data?.error ?? 'Failed to end meeting: ' + error.message
      );
    }
  };

  /** Everyone else: step out, meeting carries on. */
  const leaveMeeting = async () => {
    if (!currentMeeting) return;
    try {
      await apiClient.leaveMeeting(currentMeeting.id);
    } catch {
      // Leaving is best-effort; navigate away regardless.
    }
    navigate('/');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f1f4f8]">
        <p className="text-[16px] text-[#4a5567]">Loading meeting…</p>
      </div>
    );
  }

  if (!currentMeeting) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f1f4f8]">
        <p className="text-[16px] text-[#4a5567]">Meeting not found</p>
      </div>
    );
  }

  const speaker =
    agenda.find((s) => s.id === session?.id)?.speaker_name || '';

  return (
    <div className="min-h-screen bg-[#f1f4f8] text-[#030712] pb-[110px]">
      {showEndChoice && currentMeeting && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold">What would you like to do?</h3>
            <p className="mt-1 text-sm text-gray-600">
              Leaving and ending are different things, so this asks rather
              than guesses.
            </p>

            <button
              onClick={endMeeting}
              className="mt-5 w-full text-left rounded-xl border border-red-200 hover:border-red-400 p-4"
            >
              <span className="block font-semibold text-red-700">End the meeting</span>
              <span className="block text-sm text-gray-600 mt-0.5">
                It closes for everybody. Speakers, attendees and guests are
                all shown out, and nobody can rejoin.
              </span>
            </button>

            <button
              onClick={() => { setShowEndChoice(false); leaveMeeting(); }}
              className="mt-3 w-full text-left rounded-xl border border-navy-800/15 hover:border-navy-800/40 p-4"
            >
              <span className="block font-semibold">Just leave</span>
              <span className="block text-sm text-gray-600 mt-0.5">
                The meeting carries on without you, and you can come back.
              </span>
            </button>

            <button
              onClick={() => setShowEndChoice(false)}
              className="mt-4 w-full text-center text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showShare && currentMeeting && (
        <ShareMeetingDialog
          meetingId={currentMeeting.id}
          meetingCode={currentMeeting.meeting_code}
          onClose={() => setShowShare(false)}
          onInvited={() => loadAttendance()}
        />
      )}

      {/* Who is in the room, and what the host may do about it */}
      {showPeople && (
        <RoomPanel title="Participants" onClose={() => setShowPeople(false)}>
          <div className="flex flex-col">
            {(participants as MeetingParticipant[]).length === 0 ? (
              <p className="text-[14px] text-[#656565] px-4 py-3">Nobody is here yet.</p>
            ) : (
              (participants as MeetingParticipant[]).map((p) => {
                const isMe = p.user.id === user?.id;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-[#e3e8ef] last:border-0"
                  >
                    <RoomPortrait name={p.user.email} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-medium text-black truncate">
                        {p.user.email}
                        {isMe && <span className="text-[#656565] font-normal"> (you)</span>}
                      </p>
                      <p className="text-[12px] text-[#656565] uppercase tracking-wide">
                        {p.role.replace('_', '-')}
                        {p.is_muted && ' · muted'}
                      </p>
                    </div>
                    {isHost && !isMe && !(p as any).is_guest && (
                      <select
                        value={p.role}
                        disabled={changingRole === p.id}
                        onChange={(e) =>
                          changeRole(
                            p,
                            e.target.value as 'host' | 'co_host' | 'presenter' | 'attendee'
                          )
                        }
                        aria-label={`Role for ${p.user.email}`}
                        className="border border-[#e3e8ef] rounded-md px-2 py-1 text-[13px] bg-white
                          disabled:opacity-50 flex-none"
                      >
                        <option value="attendee">Attendee</option>
                        <option value="presenter">Presenter</option>
                        <option value="co_host">Co-host</option>
                        <option value="host">Host (transfers ownership)</option>
                      </select>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </RoomPanel>
      )}

      {/* The board of what the host has put up for everybody to read */}
      {showQuestions && meetingId && (
        <RoomPanel title="Questions" onClose={() => setShowQuestions(false)} wide>
          <div className="p-4">
            <MessageBoard meetingId={meetingId} refreshMs={20000} canAnswer={canOrganize} />
          </div>
        </RoomPanel>
      )}

      {showAttendance && (
        <RoomPanel title="Attendance" onClose={() => setShowAttendance(false)} wide>
          <div className="p-4">
            {!attendance ? (
              <p className="text-[14px] text-[#656565]">Loading…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  {[
                    ['On the roll', attendance.expected_total],
                    ['Attended', attendance.attended_count],
                    ['In meeting now', attendance.active_count],
                    ['Absent', attendance.absent_count],
                  ].map(([label, value]) => (
                    <div key={label as string} className="bg-[#fcfcfc] border border-[#e3e8ef] rounded-lg p-3">
                      <p className="text-2xl font-semibold">{value as number}</p>
                      <p className="text-[12px] text-[#656565]">{label as string}</p>
                    </div>
                  ))}
                </div>

                <h3 className="font-semibold mt-5 mb-2">
                  Came ({attendance.attended.length})
                </h3>
                <div className="flex flex-col">
                  {attendance.attended.map((a, i) => (
                    <div
                      key={`${a.type}-${i}`}
                      className="flex items-center gap-3 py-2 border-b border-[#e3e8ef] last:border-0"
                    >
                      <RoomPortrait name={a.name} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] truncate">{a.name}</p>
                        <p className="text-[12px] text-[#656565] truncate">
                          {a.email ?? a.phone ?? a.role}
                        </p>
                      </div>
                      <span
                        className={`text-[12px] rounded-full px-2 py-0.5 flex-none ${
                          a.is_active
                            ? 'bg-ok/[.12] text-ok'
                            : 'bg-navy-800/[.07] text-[#656565]'
                        }`}
                      >
                        {a.is_active ? 'in the room' : 'left'}
                      </span>
                    </div>
                  ))}
                </div>

                {attendance.did_not_attend.length > 0 && (
                  <>
                    <h3 className="font-semibold mt-5 mb-2">
                      Did not come ({attendance.did_not_attend.length})
                    </h3>
                    <div className="flex flex-col">
                      {attendance.did_not_attend.map((a) => (
                        <p
                          key={a.email}
                          className="text-[14px] text-[#656565] py-1.5 border-b border-[#e3e8ef] last:border-0"
                        >
                          {a.email}
                        </p>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </RoomPanel>
      )}

      {/* Guests knocking. They wait here rather than in a notification
          that has already gone. */}
      {isHost && waitingGuests.length > 0 && (
        <div className="fixed right-4 top-4 z-40 w-[300px] bg-white border border-[#e3e8ef]
          rounded-[12px] shadow-lg overflow-hidden">
          <p className="bg-[#fcfcfc] border-b border-[#e3e8ef] px-4 py-2.5 text-[14px] font-medium">
            Asking to come in ({waitingGuests.length})
          </p>
          {waitingGuests.map((g) => (
            <div
              key={g.id}
              aria-label={`${g.full_name} is asking to join`}
              className="px-4 py-3 border-b border-[#e3e8ef] last:border-0"
            >
              <p className="text-[14px] font-medium truncate">{g.full_name}</p>
              <p className="text-[12px] text-[#656565]">{g.phone}</p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => decideGuest(g.id, 'admit')}
                  disabled={decidingGuest === g.id}
                  className="flex-1 bg-navy-800 hover:bg-navy-700 text-white rounded-lg py-1.5
                    text-[13px] font-medium disabled:opacity-50"
                >
                  Let in
                </button>
                <button
                  onClick={() => decideGuest(g.id, 'deny')}
                  disabled={decidingGuest === g.id}
                  className="flex-1 border border-[#e3e8ef] hover:bg-cream rounded-lg py-1.5
                    text-[13px] font-medium disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The room itself: the running order, the stage, and the side panels */}
      <div className="grid gap-4 p-4 xl:grid-cols-[332px_minmax(0,1fr)_358px] items-start">
        {/* What the day runs through */}
        <RoomCard className="xl:sticky xl:top-4">
          <div className="bg-[#fcfcfc] h-12 grid place-items-center px-4">
            <h2 className="text-[20px] font-medium text-black leading-[1.2]">Agenda Summary</h2>
          </div>
          <div className="max-h-[458px] overflow-y-auto">
            {agenda.length === 0 ? (
              <p className="text-[14px] text-[#656565] px-4 py-3">
                Nothing in the running order yet.
              </p>
            ) : (
              agenda.map((item) => {
                const onStage = item.id === session?.id;
                return (
                  <div
                    key={item.id}
                    aria-current={onStage}
                    className={`flex items-center justify-between gap-2 px-1 py-2
                      border-b-[0.5px] border-[#b3b3b3] last:border-0
                      ${onStage ? 'bg-[#007092] text-white' : 'bg-[#fcfcfc]'}`}
                  >
                    <div className="flex gap-2 items-center p-1 min-w-0">
                      <RoomPortrait name={item.speaker_name || item.title} size={48} />
                      <div className="min-w-0">
                        <p className={`text-[16px] font-medium leading-[1.2] truncate
                          ${onStage ? 'text-white' : 'text-black'}`}>
                          {item.title}
                        </p>
                        <p className={`text-[14px] leading-[1.5] truncate
                          ${onStage ? 'text-white' : 'text-[#030712]'}`}>
                          {item.speaker_name || 'No speaker named'}
                        </p>
                      </div>
                    </div>
                    {onStage && <FigmaIcon name="chevronDown" size={24} />}
                  </div>
                );
              })
            )}
          </div>
        </RoomCard>

        {/* The stage */}
        <div className="flex flex-col gap-3 min-w-0">
          <RoomCard>
            <div className="bg-white border-b border-[#e3e8ef] flex items-center justify-between
              gap-3 px-4 py-2.5 flex-wrap">
              <h1 className="flex-1 min-w-0 text-[24px] font-medium text-black text-center
                leading-[1.2] truncate">
                {currentMeeting.title}
              </h1>

              <div className="flex items-center gap-2 flex-none">
                {isHost && (
                  <button
                    onClick={() => { setShowAttendance(true); loadAttendance(); }}
                    className="border border-[#e3e8ef] hover:bg-cream rounded-[8px] px-3 py-1.5
                      text-[13px] font-medium"
                  >
                    Attendance
                  </button>
                )}

                {isHost && !startedAt && currentMeeting.entry?.can_start ? (
                  <button
                    onClick={startMeeting}
                    className="bg-ok hover:brightness-110 text-white rounded-[8px] px-3 py-1.5
                      text-[13px] font-medium"
                  >
                    Start meeting
                  </button>
                ) : isHost && startedAt ? (
                  <button
                    onClick={() => setShowEndChoice(true)}
                    className="bg-live hover:brightness-110 text-white rounded-[8px] px-3 py-1.5
                      text-[13px] font-medium"
                  >
                    End meeting
                  </button>
                ) : null}

                {startedAt && (
                  <span className="bg-[#fce2ef] text-[#f83995] text-[12px] tracking-[-0.06px]
                    rounded-[4px] h-6 px-2 grid place-items-center">
                    Live
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 px-4 py-2.5">
              <div className="flex gap-2 items-center">
                <RoomPortrait name={speaker || currentMeeting.title} size={84} />
                <div className="min-w-0">
                  <p className="text-[22px] font-medium text-black leading-[1.2] truncate">
                    {session?.title || currentMeeting.title}
                  </p>
                  <p className="text-[18px] text-[#030712] leading-[1.5] truncate">
                    {speaker || 'No speaker named'}
                  </p>
                </div>
              </div>

              <div className="flex gap-3 items-center flex-wrap">
                <span className="border border-[#e3e8ef] rounded-[4px] h-6 px-2 flex items-center gap-1.5">
                  <i className="w-[5px] h-[5px] rounded-full bg-[#13cef7]" aria-hidden />
                  <span className="text-[14px] text-[#030712] tracking-[-0.07px]">
                    {currentMeeting.meeting_code}
                  </span>
                </span>
                <span aria-hidden className="w-px h-3 bg-[#e3e8ef]" />
                <span className="text-[14px] text-[#030712] tracking-[-0.07px] tabular-nums">
                  {startedAt ? formatElapsed(elapsed) : 'Not started'}
                </span>
              </div>
            </div>

            {/* What is being said */}
            <div className="border-t border-[#e3e8ef]">
              <div className="bg-white border-b border-[#e3e8ef] px-4 py-2.5">
                <h2 className="text-[20px] font-medium text-black text-center leading-[1.2]">
                  Live Transcript
                </h2>
              </div>
              <div className="flex flex-col gap-3 px-3 py-2.5 max-h-[420px] overflow-y-auto">
                {transcript.length === 0 ? (
                  <p className="text-[14px] text-[#656565]">
                    Lines appear here once the hall device starts sending them.
                  </p>
                ) : (
                  transcript.map((seg, idx) => (
                    <div key={idx} className="flex gap-3 items-start">
                      <span className="border border-[#e3e8ef] rounded-[4px] h-6 px-1 grid
                        place-items-center flex-none text-[12px] text-[#656565]
                        tracking-[-0.06px] tabular-nums">
                        {seg.created_at
                          ? new Date(seg.created_at).toLocaleTimeString([], {
                              hour: '2-digit', minute: '2-digit',
                            })
                          : formatElapsed(Math.round(seg.start_time))}
                      </span>
                      <span aria-hidden className="w-px h-3 bg-[#e3e8ef] mt-1.5 flex-none" />
                      <p className="flex-1 min-w-0 text-[14px] leading-[1.4] tracking-[-0.07px]
                        text-[#383838]">
                        {seg.speaker_name && (
                          <span className="text-[#4a5567]">{seg.speaker_name}: </span>
                        )}
                        {seg.text}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </RoomCard>
        </div>

        {/* Resources and chat */}
        <div className="flex flex-col gap-3 min-w-0">
          <RoomCard id="manch-room-resources">
            <div className="bg-[#fcfcfc] flex items-center justify-center px-4 pt-2 pb-1">
              <h2 className="flex-1 text-[18px] text-black text-center tracking-[-0.09px]">
                Resources ({resources.length})
              </h2>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadPercent !== null}
                className="text-[13px] px-3 py-1.5 rounded-lg bg-navy-800 hover:bg-navy-700
                  text-white disabled:opacity-50 flex-none"
              >
                {uploadPercent !== null ? `${uploadPercent}%` : '+ Upload'}
              </button>
            </div>

            <input ref={fileInputRef} type="file" onChange={handleUpload} className="hidden" />

            {uploadPercent !== null && (
              <div className="h-1 bg-[#e3e8ef] overflow-hidden">
                <div
                  className="h-full bg-navy-700 transition-all"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            )}

            <div className="max-h-[276px] overflow-y-auto">
              {resources.length === 0 ? (
                <p className="text-[14px] text-[#656565] px-4 py-3">
                  No files yet. Uploads are saved to the host's Google Drive and shared with
                  everyone here.
                </p>
              ) : (
                resources.map((r, i) => (
                  <div key={r.id} className="border-b border-[#e3e8ef] last:border-0">
                    <a
                      href={r.web_view_link ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-[21px] px-4 py-2.5 hover:bg-cream"
                    >
                      <FigmaIcon name="folder" size={24} />
                      <span className="min-w-0">
                        <span className="block text-[14px] text-[#383838] tracking-[-0.07px] truncate">
                          {r.display_name}
                        </span>
                        <span className="block text-[12px] text-[#656565] truncate">
                          {formatFileSize(r.file_size)}
                          {r.metadata?.uploaded_by_email &&
                            ` · ${
                              r.metadata.uploaded_by_email === user?.email
                                ? 'you'
                                : r.metadata.uploaded_by_email
                            }`}
                          {r.is_released === false && ' · not open to the room yet'}
                        </span>
                      </span>
                    </a>
                    {canOrganize && meetingId && (
                      <div className="px-4 pb-2.5">
                        <ResourceControls
                          meetingId={meetingId}
                          resource={r}
                          index={i}
                          total={resources.length}
                          onChanged={() => loadResources(meetingId)}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </RoomCard>

          {/* Photographs of the day. A different thing from the papers
              circulated during it, so a section of its own. */}
          {meetingCode && (
            <RoomCard>
              <div className="bg-[#fcfcfc] px-4 pt-2 pb-1">
                <h2 className="text-[18px] text-black text-center tracking-[-0.09px]">
                  Photos
                </h2>
              </div>
              <div className="px-4 py-3">
                <PhotoUploads meetingRef={meetingCode} />
              </div>
            </RoomCard>
          )}

          <RoomCard id="manch-room-chat">
            <div className="bg-[#fcfcfc] flex items-center justify-center px-4 pt-2 pb-1">
              <h2 className="flex-1 text-[18px] text-black text-center tracking-[-0.09px]">
                Chat
              </h2>
              {unread > 0 && (
                <span className="bg-live text-white text-[11px] font-bold rounded-full
                  min-w-[20px] h-5 px-1 grid place-items-center flex-none">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </div>

            {!chatSettings.chat_enabled ? (
              <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-[14px] text-[#656565]">
                  The room needs to be opened by the host.
                </p>
                {isHost && (
                  <button
                    onClick={() => toggleChatSetting({ chat_enabled: true })}
                    disabled={savingSettings}
                    className="bg-navy-800 hover:bg-navy-700 text-white px-4 py-2 rounded-lg
                      text-[13px] font-medium disabled:opacity-50"
                  >
                    {savingSettings ? 'Opening…' : 'Open the chat room'}
                  </button>
                )}
              </div>
            ) : (
              <>
                {isHost && (
                  <div className="px-4 py-3 border-b border-[#e3e8ef] flex flex-col gap-2 text-[12px]">
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-[#4a5567]">Room open to everyone</span>
                      <input
                        type="checkbox"
                        checked={chatSettings.chat_enabled}
                        disabled={savingSettings}
                        onChange={(e) => toggleChatSetting({ chat_enabled: e.target.checked })}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-[#4a5567]">Allow direct messages</span>
                      <input
                        type="checkbox"
                        checked={chatSettings.direct_messages_enabled}
                        disabled={savingSettings}
                        onChange={(e) =>
                          toggleChatSetting({ direct_messages_enabled: e.target.checked })
                        }
                      />
                    </label>
                  </div>
                )}

                {isHost && pending.length > 0 && (
                  <div className="border-b border-[#e3e8ef] bg-amber/[.08] p-3 flex flex-col gap-2">
                    <p className="text-[12px] font-semibold text-amber-700">
                      Awaiting your approval ({pending.length})
                    </p>
                    {pending.map((m) => (
                      <div key={m.id} className="bg-white border border-[#e3e8ef] rounded p-2 text-[12px]">
                        <p className="text-[#4a5567]">
                          <span className="font-semibold">{m.sender_name}</span>
                          {' → '}
                          <span className="font-semibold">{m.recipient_name}</span>
                        </p>
                        <p className="my-1 break-words text-[#030712]">{m.body}</p>
                        <div className="flex gap-1">
                          <button
                            onClick={() => moderate(m.id, 'approve')}
                            disabled={moderating === m.id}
                            className="flex-1 bg-ok text-white rounded py-1 disabled:opacity-50"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => moderate(m.id, 'decline')}
                            disabled={moderating === m.id}
                            className="flex-1 bg-amber-700 text-white rounded py-1 disabled:opacity-50"
                          >
                            Decline
                          </button>
                          <button
                            onClick={() => moderate(m.id, 'remove')}
                            disabled={moderating === m.id}
                            className="flex-1 bg-live text-white rounded py-1 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex border-b border-[#e3e8ef]" role="tablist">
                  {([
                    ['public', 'Room', unreadPublic],
                    ['private', 'Private', unreadPrivate],
                  ] as const).map(([key, label, count]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={chatTab === key}
                      onClick={() => {
                        setChatTab(key);
                        if (key === 'public') setDmTarget('');
                      }}
                      className={`flex-1 py-2 text-[13px] font-medium transition ${
                        chatTab === key
                          ? 'text-black border-b-2 border-black'
                          : 'text-[#49454f] hover:text-black'
                      }`}
                    >
                      {label}
                      {count > 0 && chatTab !== key && (
                        <span className="ms-2 inline-grid place-items-center min-w-[18px] h-[18px]
                          px-1 text-[10px] font-bold bg-live text-white rounded-full align-middle">
                          {count > 9 ? '9+' : count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="h-[280px] overflow-y-auto p-3 flex flex-col gap-3">
                  {visibleMessages.length === 0 ? (
                    <p className="text-[13px] text-[#656565]">
                      {chatTab === 'public'
                        ? 'No messages in the room yet.'
                        : 'No private messages yet.'}
                    </p>
                  ) : (
                    visibleMessages.map((m) => {
                      const mine = m.sender_id === user?.id && !m.sender_is_guest;
                      return (
                        <div key={m.id} className={mine ? 'text-right' : ''}>
                          <div
                            className={`inline-block max-w-[85%] text-left px-3 py-2 rounded-[12px]
                              text-[14px] ${
                              mine
                                ? 'bg-navy-800 text-white'
                                : 'bg-[#f1f4f8] text-[#030712] border border-[#e3e8ef]'
                            }`}
                          >
                            <p className={`text-[11px] mb-0.5 ${
                              mine ? 'text-[#c9daf1]' : 'text-[#656565]'
                            }`}>
                              {mine ? 'You' : m.sender_name}
                              {m.is_direct && (
                                <span className={mine ? ' text-amber' : ' text-amber-700'}>
                                  {' '}· {mine ? `to ${m.recipient_name}` : 'privately'}
                                </span>
                              )}
                            </p>
                            <p className="break-words">{m.body}</p>
                            {mine && m.moderation_status === 'pending' && (
                              <p className="text-[11px] text-amber mt-1">
                                Waiting for host approval
                              </p>
                            )}
                            {mine && m.moderation_status === 'declined' && (
                              <p className="text-[11px] text-[#ffb4b4] mt-1">Declined by host</p>
                            )}
                            {mine && m.moderation_status === 'approved' && (
                              <p className="text-[11px] text-[#a9e5c8] mt-1">Forwarded by host</p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="p-3 border-t border-[#e3e8ef] flex flex-col gap-2">
                  {chatTab === 'private' &&
                    chatSettings.direct_messages_enabled &&
                    dmTargets.length > 0 && (
                    <select
                      value={dmTarget}
                      onChange={(e) => setDmTarget(e.target.value)}
                      className="w-full border border-[#e3e8ef] rounded-lg px-2 py-1.5 text-[13px] bg-white"
                    >
                      <option value="">Everyone in the room</option>
                      {dmTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          Direct to {target.label}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder={
                        chatTab === 'private'
                          ? dmTarget
                            ? 'Private message…'
                            : 'Pick someone above first'
                          : 'Message the room…'
                      }
                      maxLength={2000}
                      className="flex-1 min-w-0 bg-[#f9fafb] border border-[#e5e7eb] rounded-[12px]
                        px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-navy-500"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!draft.trim() || (chatTab === 'private' && !dmTarget)}
                      className="bg-navy-800 hover:bg-navy-700 text-white px-4 rounded-[12px]
                        text-[14px] font-medium disabled:opacity-50 flex-none"
                    >
                      Send
                    </button>
                  </div>

                  <p className="text-[11px] text-[#656565]">
                    {chatTab === 'public'
                      ? 'Everyone in the meeting can see these messages.'
                      : chatSettings.direct_messages_enabled
                      ? dmTarget && !isHost && myRole === 'attendee'
                        ? 'The host reviews this before it reaches them.'
                        : 'Direct messages are visible only to you and the recipient.'
                      : 'Direct messages need to be enabled by the host.'}
                  </p>
                </div>
              </>
            )}
          </RoomCard>
        </div>
      </div>

      {/* The room's own controls, along the foot of it */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 bg-navy-800 flex items-center justify-center
          gap-2 sm:gap-[38px] px-4 py-3 overflow-x-auto"
        aria-label="Meeting controls"
      >
        <RoomBarButton
          icon="participants"
          label={`Participants${participants.length ? ` (${participants.length})` : ''}`}
          onClick={() => setShowPeople(true)}
        />
        <RoomBarButton
          icon="chat"
          label="Chat"
          badge={unread}
          onClick={() => { setShowChat(true); scrollToRoomCard('manch-room-chat'); }}
        />
        <RoomBarButton
          icon="questions"
          label="Questions"
          onClick={() => setShowQuestions(true)}
        />
        <RoomBarButton
          icon="resources"
          label="Resources"
          onClick={() => scrollToRoomCard('manch-room-resources')}
        />
        <RoomBarButton icon="share" label="Share" onClick={() => setShowShare(true)} />

        <span className="ms-auto ps-4 flex-none">
          <RoomBarButton
            icon="leave"
            label="Leave"
            tone="leave"
            onClick={() => (isHost && startedAt ? setShowEndChoice(true) : leaveMeeting())}
          />
        </span>
      </nav>
    </div>
  );
};

/** A white card, the way every panel in this room is drawn. */
const RoomCard: React.FC<{
  id?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ id, className = '', children }) => (
  <div
    id={id}
    className={`bg-white border border-[#e3e8ef] rounded-[12px] overflow-hidden ${className}`}
  >
    {children}
  </div>
);

/**
 * A round portrait.
 *
 * The mock uses a stock photograph for everybody; nobody here has one, so
 * the initial stands on the same warm disc rather than a grey box where a
 * face should be.
 */
const RoomPortrait: React.FC<{ name: string; size: number }> = ({ name, size }) => (
  <span
    className="bg-[#fbecd1] rounded-full grid place-items-center flex-none text-navy-900
      font-semibold overflow-hidden"
    style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
    aria-hidden
  >
    {(name || '?').trim().charAt(0).toUpperCase()}
  </span>
);

/** One control on the bar along the foot of the room. */
const RoomBarButton: React.FC<{
  icon: FigmaIconName;
  label: string;
  onClick: () => void;
  badge?: number;
  tone?: 'default' | 'leave';
}> = ({ icon, label, onClick, badge = 0, tone = 'default' }) => (
  <button
    type="button"
    onClick={onClick}
    className="relative flex flex-col items-center gap-[9px] px-3 py-2 rounded-[12px] w-[92px]
      flex-none hover:bg-white/[.08] transition-colors"
  >
    <FigmaIcon name={icon} size={24} />
    <span
      className={`text-[14px] tracking-[-0.07px] whitespace-nowrap ${
        tone === 'leave' ? 'text-[#f75656]' : 'text-white'
      }`}
    >
      {label}
    </span>
    {badge > 0 && (
      <span className="absolute top-1 right-2 min-w-[18px] h-[18px] px-1 grid place-items-center
        text-[10px] font-bold bg-live text-white rounded-full">
        {badge > 9 ? '9+' : badge}
      </span>
    )}
  </button>
);

/** A panel the bar opens over the room. */
const RoomPanel: React.FC<{
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}> = ({ title, onClose, wide, children }) => (
  <div
    className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
    onClick={onClose}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      className={`bg-white border border-[#e3e8ef] rounded-[12px] w-full overflow-hidden
        max-h-[85vh] flex flex-col ${wide ? 'max-w-[760px]' : 'max-w-[420px]'}`}
    >
      <div className="bg-[#fcfcfc] border-b border-[#e3e8ef] flex items-center gap-2 px-4 py-2.5">
        <h2 className="flex-1 text-[18px] text-black text-center tracking-[-0.09px]">{title}</h2>
        <button
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()}`}
          className="text-[#9ea8b7] hover:text-navy-800 text-[22px] leading-none px-2 flex-none"
        >
          &#10005;
        </button>
      </div>
      <div className="overflow-y-auto">{children}</div>
    </div>
  </div>
);

/** Bring one of the side cards into view, for the bar's shortcuts. */
const scrollToRoomCard = (id: string) => {
  const card = document.getElementById(id);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.animate?.(
    [{ boxShadow: '0 0 0 0 rgba(18,56,110,0)' }, { boxShadow: '0 0 0 4px rgba(18,56,110,.25)' },
     { boxShadow: '0 0 0 0 rgba(18,56,110,0)' }],
    { duration: 900 }
  );
};

/**
 * The room, with the reader's language and accessibility settings.
 *
 * It shares components with the dashboards - the resource controls, the
 * photo section - and those speak both languages, which means they need
 * the same context every other screen gives them. Without it they throw
 * on first render, and the whole room goes down with them.
 */
export const MeetingRoomPage: React.FC = () => (
  <OrganizerProvider>
    <MeetingRoomInner />
  </OrganizerProvider>
);

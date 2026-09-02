import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMeetingStore } from '../store/meetingStore';
import { useAuthStore } from '../store/authStore';
import { apiClient } from '../services/api';
import {
  Artifact, AttendanceReport, ChatMessage, ChatSettings,
  GuestAttendee, MeetingParticipant,
} from '../types';
import toast from 'react-hot-toast';
import { ShareMeetingDialog } from '../components/ShareMeetingDialog';
import { LiveTranscriptStage } from '../components/LiveTranscriptStage';

const RESOURCE_POLL_MS = 8000;

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

export const MeetingRoomPage: React.FC = () => {
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
  const [showAttendance, setShowAttendance] = useState(false);
  const [attendance, setAttendance] = useState<AttendanceReport | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const showChatRef = useRef(false);
  const meetingIdRef = useRef<string | null>(null);
  const elapsedRef = useRef(0);

  // Effects key off these primitives rather than the meeting object, whose
  // identity changes on every refetch and would otherwise tear down the
  // websocket, the camera and the timer.
  const meetingId = currentMeeting?.id ?? null;
  const startedAt = currentMeeting?.started_at ?? null;

  useEffect(() => {
    meetingIdRef.current = meetingId;
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
    if (showChat) {
      setUnread(0);
      if (chatTab === 'public') setUnreadPublic(0);
      else setUnreadPrivate(0);
    }
  }, [showChat, chatTab]);

  useEffect(() => {
    chatTabRef.current = chatTab;
    // Leaving the room tab means room messages are no longer being read.
    if (chatTab === 'public') setUnreadPublic(0);
    else setUnreadPrivate(0);
  }, [chatTab]);

  const isHost = !!user && currentMeeting?.host?.id === user.id;
  const visibleMessages = messages.filter((m) =>
    chatTab === 'private' ? m.is_direct : !m.is_direct
  );
  const myRole = (participants as MeetingParticipant[])
    .find((p) => p.user?.id === user?.id)?.role;

  /** Participants who can be addressed directly: hosts and presenters. */
  const presenters = (participants as MeetingParticipant[]).filter(
    (p) => p.user?.id !== user?.id && ['host', 'co_host', 'presenter'].includes(p.role)
  );

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

  const loadMeeting = useCallback(async () => {
    try {
      setIsLoading(true);
      const meeting = await apiClient.getMeeting(meetingCode!);
      setMeeting(meeting);
      const participants = await apiClient.getParticipants(meeting.id);
      setParticipants(participants);
    } catch (error: any) {
      toast.error('Failed to load meeting: ' + error.message);
      navigate('/dashboard');
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
        navigate('/dashboard');
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

  // The host starts the clock once; the server timestamp is then the single
  // source of truth for everyone.
  useEffect(() => {
    if (!meetingId || !isHost || startedAt) return;
    (async () => {
      try {
        const updated = await apiClient.startMeeting(meetingId);
        setMeeting(updated);
      } catch {
        // A meeting that cannot be started still renders; the clock waits.
      }
    })();
  }, [meetingId, isHost, startedAt, setMeeting]);

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
  const endMeeting = async () => {
    if (!currentMeeting) return;
    const ok = window.confirm(
      'End this meeting for everyone?\n\n' +
      'Nobody will be able to rejoin. To step out yourself without ending ' +
      'it, close this tab instead.'
    );
    if (!ok) return;

    try {
      await apiClient.endMeeting(currentMeeting.id);
      toast.success('Meeting ended');
      navigate('/dashboard');
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
    navigate('/dashboard');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-600">Loading meeting...</p>
        </div>
      </div>
    );
  }

  if (!currentMeeting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-600">Meeting not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {showShare && currentMeeting && (
        <ShareMeetingDialog
          meetingId={currentMeeting.id}
          meetingCode={currentMeeting.meeting_code}
          onClose={() => setShowShare(false)}
          onInvited={() => loadAttendance()}
        />
      )}

      {showAttendance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white text-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="p-6 border-b flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">Attendance</h2>
                <p className="text-sm text-gray-600">
                  Expected headcount comes from the links you shared.
                </p>
              </div>
              <button
                onClick={() => setShowAttendance(false)}
                aria-label="Close attendance"
                className="text-gray-400 hover:text-gray-700 px-2"
              >
                &#10005;
              </button>
            </div>

            {!attendance ? (
              <p className="p-6 text-sm text-gray-500">Loading...</p>
            ) : (
              <div className="p-6 overflow-y-auto space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  {[
                    ['Invited', attendance.expected_from_invites],
                    ['Attended', attendance.attended_count],
                    ['In meeting now', attendance.active_count],
                    ['No-shows', attendance.invited_who_did_not],
                  ].map(([label, value]) => (
                    <div key={label as string} className="bg-gray-50 rounded-lg p-3">
                      <p className="text-2xl font-bold">{value as number}</p>
                      <p className="text-xs text-gray-600">{label as string}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <h3 className="font-semibold mb-2">
                    Attended ({attendance.attended.length})
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {attendance.active_count} in meeting ·{' '}
                      {attendance.inactive_count} left
                    </span>
                  </h3>
                  <div className="space-y-1">
                    {attendance.attended.map((a, i) => (
                      <div
                        key={`${a.type}-${a.email ?? a.phone}-${i}`}
                        className="flex items-center justify-between text-sm border-b border-gray-100 py-2"
                      >
                        <div>
                          <p className="font-medium">{a.name}</p>
                          <p className="text-xs text-gray-500">
                            {a.email ?? a.phone} &middot; {a.role}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-xs px-2 py-1 rounded-full ${
                              a.is_active
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-200 text-gray-600'
                            }`}
                          >
                            {a.is_active ? 'Active' : 'Left'}
                          </span>
                          <span
                            className={`text-xs px-2 py-1 rounded-full ${
                              a.type === 'guest'
                                ? 'bg-purple-100 text-purple-800'
                                : a.was_invited
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {a.type === 'guest'
                              ? 'Guest'
                              : a.was_invited
                              ? 'Invited'
                              : 'By code'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">
                    Invited but did not join ({attendance.did_not_attend.length})
                  </h3>
                  {attendance.did_not_attend.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      Everyone invited has joined.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {attendance.did_not_attend.map((n) => (
                        <div
                          key={n.email}
                          className="flex items-center justify-between text-sm border-b border-gray-100 py-2"
                        >
                          <span>{n.email}</span>
                          <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-800">
                            No-show
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Waiting room: guests asking to be let in */}
      {isHost && waitingGuests.length > 0 && (
        <div className="fixed top-4 right-4 z-50 w-80 space-y-3">
          {waitingGuests.map((g) => (
            <div
              key={g.id}
              role="alertdialog"
              aria-label={`${g.full_name} is asking to join`}
              className="bg-white text-gray-800 rounded-lg shadow-2xl p-4 border-l-4 border-blue-600"
            >
              <p className="text-xs uppercase tracking-wide text-blue-700 font-semibold mb-2">
                Asking to join
              </p>
              <p className="font-semibold text-lg leading-tight">{g.full_name}</p>
              <p className="text-sm text-gray-600 mb-3">{g.phone}</p>
              <p className="text-xs text-gray-500 mb-3">
                Verify these details before letting them in.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => decideGuest(g.id, 'admit')}
                  disabled={decidingGuest === g.id}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded font-semibold text-sm disabled:opacity-50"
                >
                  Allow
                </button>
                <button
                  onClick={() => decideGuest(g.id, 'deny')}
                  disabled={decidingGuest === g.id}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded font-semibold text-sm disabled:opacity-50"
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex h-screen">
        {/* Main Video Area */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 bg-gray-950 flex flex-col relative min-h-0">
            <LiveTranscriptStage transcript={transcript} />

            {/* Session timer */}
            <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full text-sm">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono tabular-nums">
                {startedAt ? formatElapsed(elapsed) : 'Not started'}
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="bg-gray-800 px-4 py-4 flex justify-center items-center gap-4">
            <h2 className="text-xl font-semibold mr-auto">{currentMeeting.title}</h2>

            <button
              onClick={() => setShowShare(true)}
              className="px-6 py-2 rounded-lg font-semibold bg-gray-700 hover:bg-gray-600"
            >
              Share link
            </button>

            {isHost && (
              <button
                onClick={() => {
                  setShowAttendance(true);
                  loadAttendance();
                }}
                className="px-6 py-2 rounded-lg font-semibold bg-gray-700 hover:bg-gray-600"
              >
                Attendance
              </button>
            )}

            <button
              onClick={() => setShowChat((v) => !v)}
              aria-label="Toggle chat"
              className={`relative px-6 py-2 rounded-lg font-semibold ${
                showChat ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <span aria-hidden="true">&#128172;</span> Chat
              {unread > 0 && !showChat && (
                <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 flex items-center justify-center text-xs font-bold bg-red-500 rounded-full">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {isHost ? (
              <button
                onClick={endMeeting}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold"
              >
                End Meeting
              </button>
            ) : (
              <button
                onClick={leaveMeeting}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold"
              >
                Leave
              </button>
            )}
          </div>

          {/* Live Transcript */}
          {transcript.length > 0 && (
            <div className="bg-gray-800 border-t border-gray-700 p-4 max-h-32 overflow-y-auto">
              <h3 className="font-semibold mb-2">Live Transcript:</h3>
              <div className="text-sm text-gray-300 space-y-1">
                {transcript.slice(-5).map((seg, idx) => (
                  <p key={idx} className="text-xs">
                    <span className="font-semibold">{seg.speaker_name}:</span> {seg.text}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chat panel */}
        {showChat && (
          <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col min-h-0">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="font-semibold">Chat</h3>
              <button
                onClick={() => setShowChat(false)}
                aria-label="Close chat"
                className="text-gray-400 hover:text-white px-2"
              >
                &#10005;
              </button>
            </div>

            {!chatSettings.chat_enabled ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <span className="text-4xl" aria-hidden="true">&#128274;</span>
                <p className="text-sm text-gray-300">
                  Room needs to be enabled by host
                </p>
                {isHost && (
                  <button
                    onClick={() => toggleChatSetting({ chat_enabled: true })}
                    disabled={savingSettings}
                    className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                  >
                    {savingSettings ? 'Enabling...' : 'Enable chat room'}
                  </button>
                )}
              </div>
            ) : (
              <>
                {isHost && (
                  <div className="px-4 py-3 border-b border-gray-700 space-y-2 text-xs">
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-gray-300">Room open to everyone</span>
                      <input
                        type="checkbox"
                        checked={chatSettings.chat_enabled}
                        disabled={savingSettings}
                        onChange={(e) => toggleChatSetting({ chat_enabled: e.target.checked })}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-gray-300">Allow direct messages</span>
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
                  <div className="border-b border-gray-700 bg-yellow-900/20 p-3 space-y-2">
                    <p className="text-xs font-semibold text-yellow-200">
                      Awaiting your approval ({pending.length})
                    </p>
                    {pending.map((m) => (
                      <div key={m.id} className="bg-gray-700 rounded p-2 text-xs">
                        <p className="text-gray-300">
                          <span className="font-semibold">{m.sender_name}</span>
                          {' → '}
                          <span className="font-semibold">{m.recipient_name}</span>
                        </p>
                        <p className="my-1 break-words">{m.body}</p>
                        <div className="flex gap-1">
                          <button
                            onClick={() => moderate(m.id, 'approve')}
                            disabled={moderating === m.id}
                            className="flex-1 bg-green-600 hover:bg-green-700 rounded py-1 disabled:opacity-50"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => moderate(m.id, 'decline')}
                            disabled={moderating === m.id}
                            className="flex-1 bg-yellow-700 hover:bg-yellow-600 rounded py-1 disabled:opacity-50"
                          >
                            Decline
                          </button>
                          <button
                            onClick={() => moderate(m.id, 'remove')}
                            disabled={moderating === m.id}
                            className="flex-1 bg-red-700 hover:bg-red-600 rounded py-1 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Room / Private */}
                <div className="flex border-b border-gray-700" role="tablist">
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
                      className={`flex-1 py-2 text-sm font-semibold relative transition ${
                        chatTab === key
                          ? 'text-white border-b-2 border-blue-500 bg-gray-700/40'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {label}
                      {count > 0 && chatTab !== key && (
                        <span className="ml-2 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 text-[10px] font-bold bg-red-500 text-white rounded-full align-middle">
                          {count > 9 ? '9+' : count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                  {visibleMessages.length === 0 ? (
                    <p className="text-xs text-gray-400">
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
                            className={`inline-block max-w-[85%] text-left px-3 py-2 rounded-lg text-sm ${
                              mine ? 'bg-blue-600' : 'bg-gray-700'
                            }`}
                          >
                            <p className="text-xs text-gray-200 mb-0.5">
                              {mine ? 'You' : m.sender_name}
                              {m.is_direct && (
                                <span className="ml-1 text-yellow-300">
                                  &#128274; {mine ? `to ${m.recipient_name}` : 'privately'}
                                </span>
                              )}
                            </p>
                            <p className="break-words">{m.body}</p>
                            {mine && m.moderation_status === 'pending' && (
                              <p className="text-[11px] text-yellow-200 mt-1">
                                &#9203; Waiting for host approval
                              </p>
                            )}
                            {mine && m.moderation_status === 'declined' && (
                              <p className="text-[11px] text-red-200 mt-1">
                                &#128683; Declined by host
                              </p>
                            )}
                            {mine && m.moderation_status === 'approved' && (
                              <p className="text-[11px] text-green-200 mt-1">
                                &#10003; Forwarded by host
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="p-3 border-t border-gray-700 space-y-2">
                  {chatTab === 'private' &&
                    chatSettings.direct_messages_enabled &&
                    presenters.length > 0 && (
                    <select
                      value={dmTarget}
                      onChange={(e) => setDmTarget(e.target.value)}
                      className="w-full bg-gray-700 text-sm rounded px-2 py-1.5"
                    >
                      <option value="">Everyone in the room</option>
                      {presenters.map((p) => (
                        <option key={p.id} value={p.user.id}>
                          Direct to {p.user.email} ({p.role.replace('_', '-')})
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
                            ? 'Private message...'
                            : 'Pick someone above first'
                          : 'Message the room...'
                      }
                      maxLength={2000}
                      className="flex-1 bg-gray-700 text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={
                        !draft.trim() || (chatTab === 'private' && !dmTarget)
                      }
                      className="bg-blue-600 hover:bg-blue-700 px-4 rounded text-sm font-semibold disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>

                  {chatTab === 'public' ? (
                    <p className="text-[11px] text-gray-400">
                      Everyone in the meeting can see these messages.
                    </p>
                  ) : chatSettings.direct_messages_enabled ? (
                    <p className="text-[11px] text-gray-400">
                      {dmTarget && !isHost && myRole === 'attendee'
                        ? 'The host reviews this before it reaches them.'
                        : 'Direct messages are visible only to you and the recipient.'}
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-400">
                      Direct messages need to be enabled by the host.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Sidebar - Participants & Chat */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
          {/* Participants */}
          <div className="flex-1 overflow-y-auto p-4 border-b border-gray-700">
            <h3 className="font-semibold mb-4">Participants ({participants.length})</h3>
            <div className="space-y-2">
              {(participants as MeetingParticipant[]).map((p) => {
                const isMe = p.user.id === user?.id;
                return (
                  <div key={p.id} className="bg-gray-700 p-3 rounded text-sm">
                    <p className="font-semibold truncate">
                      {p.user.email}
                      {isMe && <span className="text-gray-300 font-normal"> (you)</span>}
                    </p>
                    <p className="text-gray-300 text-xs mt-1">
                      <span className="uppercase tracking-wide">
                        {p.role.replace('_', '-')}
                      </span>
                      {p.is_muted && ' · 🔇 Muted'}
                      {p.is_video_on && ' · 📹 Video'}
                    </p>

                    {isHost && !isMe && !(p as any).is_guest && (
                      <select
                        value={p.role}
                        disabled={changingRole === p.id}
                        onChange={(e) =>
                          changeRole(p, e.target.value as MeetingParticipant['role'])
                        }
                        aria-label={`Role for ${p.user.email}`}
                        className="mt-2 w-full bg-gray-800 text-xs rounded px-2 py-1.5 disabled:opacity-50"
                      >
                        <option value="attendee">Attendee</option>
                        <option value="presenter">Presenter</option>
                        <option value="co_host">Co-host</option>
                        <option value="host">Host (transfers ownership)</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Shared Resources */}
          <div className="flex-1 overflow-y-auto p-4 border-b border-gray-700 min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Resources ({resources.length})</h3>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadPercent !== null}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
              >
                {uploadPercent !== null ? `${uploadPercent}%` : '+ Upload'}
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              onChange={handleUpload}
              className="hidden"
            />

            {uploadPercent !== null && (
              <div className="h-1 bg-gray-700 rounded mb-3 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            )}

            {resources.length === 0 ? (
              <p className="text-xs text-gray-400">
                No files yet. Uploads are saved to the host's Google Drive and
                shared with everyone here.
              </p>
            ) : (
              <div className="space-y-2">
                {resources.map((r) => (
                  <a
                    key={r.id}
                    href={r.web_view_link ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-gray-700 hover:bg-gray-600 p-3 rounded text-sm transition"
                  >
                    <p className="font-medium truncate">{r.display_name}</p>
                    <p className="text-gray-300 text-xs mt-1 truncate">
                      {formatFileSize(r.file_size)}
                      {r.metadata?.uploaded_by_email &&
                        ` · ${
                          r.metadata.uploaded_by_email === user?.email
                            ? 'you'
                            : r.metadata.uploaded_by_email
                        }`}
                    </p>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Meeting Info */}
          <div className="p-4 bg-gray-700 text-sm">
            <p className="text-gray-300">Meeting Code:</p>
            <p className="font-mono font-semibold text-lg">{currentMeeting.meeting_code}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

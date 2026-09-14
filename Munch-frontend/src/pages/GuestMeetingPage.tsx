import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api';
import { RESOURCE_POLL_MS } from '../services/polling';
import { ChatMessage, ChatPerson, ChatSettings, GuestResource } from '../types';
import toast from 'react-hot-toast';
import { TranscriptionSegment } from '../types';
import { RoomQuestions } from '../organizer/RoomQuestions';
import { OrganizerProvider } from '../organizer/i18n';
import { RoomAgenda } from '../organizer/RoomAgenda';
import { RoomBarButton, RoomCard, RoomPortrait, SidePanelHead } from './roomChrome';

/** The only three things allowed to sit beside a guest's room. */
type GuestPanel = 'chat' | 'questions' | 'resources';

const API_BASE = (
  process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1'
).replace(/\/api\/v1\/?$/, '');


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
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/**
 * The meeting as a guest sees it.
 *
 * Guests have no account, so anything attributed to a user - chat, presence,
 * role - is not available to them. They get their own camera and mic.
 */
export const GuestMeetingPage: React.FC = () => {
  const navigate = useNavigate();

  const token = sessionStorage.getItem('guest_token');
  const meetingCode = sessionStorage.getItem('guest_meeting_code') ?? '';
  const meetingTitle = sessionStorage.getItem('guest_meeting_title') ?? 'Meeting';
  const guestName = sessionStorage.getItem('guest_name') ?? 'Guest';

  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  /** What the host has yet to put on stage, so the wait has a name. */
  const [nextTitle, setNextTitle] = useState('');
  // Guests read the transcript; only account holders can speak into it.
  const [transcript, setTranscript] = useState<TranscriptionSegment[]>([]);


  // Chat
  const wsRef = useRef<WebSocket | null>(null);
  const [showChat, setShowChat] = useState(false);
  const showChatRef = useRef(false);
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    chat_enabled: false,
    direct_messages_enabled: false,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [draft, setDraft] = useState('');
  const [dmTarget, setDmTarget] = useState('');
  const [unread, setUnread] = useState(0);
  const [myGuestId, setMyGuestId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Shared files
  const [resources, setResources] = useState<GuestResource[]>([]);

  /**
   * What sits beside the room, in the order it was asked for.
   *
   * The same rule as the account holders' room, because it is the same
   * room: two at a time, and a third lets the oldest go.
   */
  const [side, setSide] = useState<GuestPanel[]>([]);
  const toggleSide = (panel: GuestPanel) =>
    setSide((open) => {
      if (open.includes(panel)) return open.filter((x) => x !== panel);
      return [...open, panel].slice(-2);
    });
  const closeSide = (panel: GuestPanel) =>
    setSide((open) => open.filter((x) => x !== panel));

  // "The chat is open" is now "the chat is one of the two beside the
  // room". The socket reads it through a ref to decide whether a message
  // arriving counts as unread, so it follows the column rather than a
  // second switch that could disagree with it.
  const chatBeside = side.includes('chat');
  useEffect(() => { setShowChat(chatBeside); }, [chatBeside]);

  /** The running order, and the meeting's own hours, to read only. */
  const [agenda, setAgenda] = useState<any[]>([]);
  const [meeting, setMeeting] = useState<any>(null);

  const leave = useCallback(async () => {
    if (token) {
      try {
        await apiClient.guestLeave(token);
      } catch {
        // Best-effort.
      }
    }
    sessionStorage.clear();
    navigate('/login');
  }, [token, navigate]);

  useEffect(() => {
    showChatRef.current = showChat;
    if (showChat) setUnread(0);
  }, [showChat]);

  const loadChat = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiClient.guestChat(token);
      setChatSettings(data.settings);
      setMessages(data.messages);
      if (data.me) setMyGuestId(data.me.id);
    } catch {
      // Chat may simply be closed by the host.
    }
    try {
      setPeople(await apiClient.guestPresenters(token));
    } catch {
      // Optional.
    }
  }, [token]);

  useEffect(() => {
    if (!token || !meetingCode) return;
    apiClient
      .getGuestSegments(meetingCode, token)
      .then(setTranscript)
      .catch(() => undefined);
  }, [token, meetingCode]);

  useEffect(() => {
    loadChat();
  }, [loadChat]);

  /*
   * Which session the room is holding, and whether its clock has started.
   *
   * The room is the meeting's; the clock is the talk's. Kept polling
   * rather than stopped once a clock appears, because the day moves on -
   * one talk ends, the room waits, and the host puts the next on stage.
   */
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const fetchStart = async () => {
      try {
        const { meeting } = await apiClient.guestStatus(token);
        if (cancelled) return;
        const running = (meeting as any)?.current_session;
        setMeeting(meeting);
        setAgenda((meeting as any)?.sessions ?? []);
        // The room's session, if one is on stage. Between talks there is
        // no title and no clock - and the room is still the guest's to sit
        // in, because the room belongs to the meeting.
        setSessionTitle(running?.title ?? '');
        setStartedAt(running?.started_at ?? null);
        setNextTitle(running?.next_title ?? '');
      } catch {
        // Try again on the next tick.
      }
    };

    fetchStart();
    const id = setInterval(fetchStart, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  // Live chat over the same socket that delivered the admission decision.
  useEffect(() => {
    if (!token || !meetingCode) return;

    const apiUrl = new URL(process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1');
    const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${apiUrl.host}/ws/meeting/${meetingCode}/?guest_token=${encodeURIComponent(token)}`
    );
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'transcription_update' && data.segment) {
        setTranscript((prev) => [...prev, data.segment]);
        return;
      }

      if (data.type === 'chat_message') {
        setMessages((prev) =>
          prev.some((m) => m.id === data.message_id) ? prev : [...prev, {
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
          }]
        );
        if (!showChatRef.current) setUnread((n) => n + 1);
      } else if (data.type === 'meeting_started') {
        setStartedAt(data.started_at);
      } else if (data.type === 'meeting_ended') {
        toast(
          data.reason === 'time_elapsed'
            ? 'The meeting time is over'
            : 'The host ended the meeting',
          { icon: '👋' }
        );
        leave();
      } else if (data.type === 'chat_settings_update') {
        setChatSettings({
          chat_enabled: data.chat_enabled,
          direct_messages_enabled: data.direct_messages_enabled,
        });
        if (!data.chat_enabled) {
          setMessages([]);
          setDmTarget('');
        }
      } else if (data.type === 'chat_moderated') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.message_id
              ? { ...m, moderation_status: data.moderation_status }
              : m
          )
        );
        if (data.moderation_status === 'declined') {
          toast('The host declined your message', { icon: '🚫' });
        }
      } else if (data.type === 'chat_error') {
        toast.error(data.error);
      }
    };

    return () => ws.close();
  }, [token, meetingCode, leave]);

  useEffect(() => {
    if (showChat) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showChat]);

  const loadResources = useCallback(async () => {
    if (!token) return;
    try {
      setResources(await apiClient.guestResources(token));
    } catch {
      // Files are supplementary; a failed refresh is not worth a toast.
    }
  }, [token]);

  useEffect(() => {
    loadResources();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') loadResources();
    }, RESOURCE_POLL_MS);
    return () => clearInterval(id);
  }, [loadResources]);

  /*
   * Everything a guest writes goes to somebody: the host, or the speaker.
   * There is no room-wide thread on either side of the room any more.
   */
  const visibleMessages = messages.filter((m) => m.is_direct);

  const sendMessage = () => {
    const body = draft.trim();
    if (!body) return;
    if (!dmTarget) {
      toast.error('Choose who this is for');
      return;
    }
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast.error('Not connected to the meeting');
      return;
    }
    socket.send(JSON.stringify({
      type: 'chat_message',
      message: body,
      recipient_id: dmTarget,
    }));
    setDraft('');
  };

  useEffect(() => {
    if (!token) navigate('/login');
  }, [token, navigate]);

  // Keep verifying we are still admitted - the host may remove us.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(async () => {
      try {
        const { guest, meeting } = await apiClient.guestStatus(token);
        if (meeting?.started_at) setStartedAt(meeting.started_at);
        if (meeting?.status === 'ended') {
          toast('The meeting has ended');
          leave();
        } else if (guest.status !== 'admitted') {
          toast('You are no longer in this meeting');
          leave();
        }
      } catch {
        // Ignore a single failed check.
      }
    }, 15000);
    return () => clearInterval(id);
  }, [token, leave]);


  // Same clock as everyone else: anchored to the host's start timestamp.
  /**
   * A session ending is not the room ending.
   *
   * A guest is admitted to the meeting, and the meeting is the room: it
   * holds the whole running order, gaps and all. So when a talk comes off
   * stage the guest is told, and stays. They leave when the meeting ends,
   * which arrives over the socket as ``meeting_ended``.
   */
  const lastOnStage = useRef<string>('');
  useEffect(() => {
    const before = lastOnStage.current;
    lastOnStage.current = sessionTitle;
    if (before && !sessionTitle) {
      toast(`“${before}” has finished. The room stays open.`, {
        icon: '\u2705',
        duration: 4000,
      });
    }
  }, [sessionTitle]);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const origin = new Date(startedAt).getTime();
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - origin) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const onStage = (meeting as any)?.current_session ?? null;
  const speaker =
    agenda.find((item) => item.id === onStage?.id)?.speaker_name || '';

  /*
   * A transcript belongs to the talk it was said during, so the room shows
   * the lines of whatever is on stage and the next speaker starts on a
   * clean page. Between talks, what there is to show is the record so far.
   */
  const roomLines = onStage?.id
    ? transcript.filter(
        (line: any) => !line.session_id || line.session_id === onStage.id
      )
    : transcript;

  return (
    <OrganizerProvider>
    <div className="min-h-screen bg-[#f1f4f8] text-[#030712] pb-[110px]">
      <div
        className={`grid gap-4 p-4 items-start ${
          side.length > 0
            ? 'xl:grid-cols-[332px_minmax(0,1fr)_358px]'
            : 'xl:grid-cols-[332px_minmax(0,1fr)]'
        }`}
      >
        {/* The running order, exactly as everybody else in the room sees
            it - and to read only, like every other guest thing. */}
        <RoomCard className="xl:sticky xl:top-4">
          <RoomAgenda
            meeting={{
              id: meeting?.id ?? '',
              title: meetingTitle,
              meeting_code: meetingCode,
              status: meeting?.status ?? 'active',
              scheduled_start: meeting?.scheduled_start ?? new Date().toISOString(),
              scheduled_end: meeting?.scheduled_end ?? new Date().toISOString(),
            } as any}
            sessions={agenda as any}
            liveSessionId={onStage?.id ?? null}
            canEdit={false}
            onChanged={() => {}}
          />
        </RoomCard>

        {/* The stage */}
        <div className="flex flex-col gap-3 min-w-0">
          <RoomCard>
            <div className="bg-white border-b border-[#e3e8ef] flex items-center justify-between
              gap-3 px-4 py-2.5 flex-wrap">
              <h1 className="flex-1 min-w-0 text-[24px] font-medium text-black text-center
                leading-[1.2] truncate">
                {meetingTitle}
              </h1>
              <span className="text-[12px] text-[#4a5567] flex-none">
                Joined as guest · {guestName}
              </span>
              {startedAt && (
                <span className="bg-[#fce2ef] text-[#f83995] text-[12px] tracking-[-0.06px]
                  rounded-[4px] h-6 px-2 grid place-items-center flex-none">
                  Live
                </span>
              )}
            </div>

            <div className="flex flex-col gap-3 px-4 py-2.5">
              <div className="flex gap-2 items-center">
                <RoomPortrait name={speaker || sessionTitle || meetingTitle} size={84} />
                <div className="min-w-0">
                  <p className="text-[22px] font-medium text-black leading-[1.2] truncate">
                    {sessionTitle || meetingTitle}
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
                    {meetingCode}
                  </span>
                </span>
                <span aria-hidden className="w-px h-3 bg-[#e3e8ef]" />
                <span className="text-[14px] text-[#030712] tracking-[-0.07px] tabular-nums">
                  {startedAt ? formatElapsed(elapsed) : 'Not started'}
                </span>
              </div>

              {!sessionTitle && (
                <div className="rounded-[10px] border border-dashed border-[#cfd8e6]
                  bg-[#f8fafc] px-4 py-3">
                  <p className="text-[16px] font-medium text-[#030712]">
                    Between sessions
                  </p>
                  <p className="text-[14px] text-[#4a5567]">
                    {nextTitle
                      ? `Up next: ${nextTitle}`
                      : 'The host will start the next session shortly.'}
                  </p>
                </div>
              )}
            </div>

            {/* What is being said */}
            <div className="border-t border-[#e3e8ef]">
              <div className="bg-white border-b border-[#e3e8ef] px-4 py-2.5">
                <h2 className="text-[20px] font-medium text-black text-center leading-[1.2]">
                  Live Transcript
                </h2>
              </div>
              <div className="flex flex-col gap-3 px-3 py-2.5 max-h-[420px] overflow-y-auto">
                {roomLines.length === 0 ? (
                  <p className="text-[14px] text-[#656565]">
                    Waiting for the room device. Whatever is said in the hall
                    will appear here.
                  </p>
                ) : (
                  roomLines.map((line: any, index: number) => (
                    <div key={index} className="flex gap-3 items-start">
                      <span className="border border-[#e3e8ef] rounded-[4px] h-6 px-1 grid
                        place-items-center flex-none text-[12px] text-[#656565]
                        tracking-[-0.06px] tabular-nums">
                        {line.created_at
                          ? new Date(line.created_at).toLocaleTimeString([], {
                              hour: '2-digit', minute: '2-digit',
                            })
                          : formatElapsed(Math.round(line.start_time ?? 0))}
                      </span>
                      <span aria-hidden className="w-px h-3 bg-[#e3e8ef] mt-1.5 flex-none" />
                      <p className="flex-1 min-w-0 text-[14px] leading-[1.4] tracking-[-0.07px]
                        text-[#383838]">
                        {line.speaker_name && (
                          <span className="text-[#4a5567]">{line.speaker_name}: </span>
                        )}
                        {line.text}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </RoomCard>
        </div>

        {/* Whatever the bar has been asked for, in the order it was asked. */}
        {side.length > 0 && (
          <div className="flex flex-col gap-3 min-w-0">
            {side.map((panel) => (
              <React.Fragment key={panel}>
                {panel === 'resources' && (
                  <RoomCard>
                    <SidePanelHead
                      title="Resources"
                      onClose={() => closeSide('resources')}
                    />
                    <div className="p-3 max-h-[420px] overflow-y-auto flex flex-col gap-2">
                      {resources.length === 0 ? (
                        <p className="text-[13px] text-[#656565]">
                          Nothing shared yet. Files the host or presenters add
                          will appear here.
                        </p>
                      ) : (
                        resources.map((file) => (
                          <a
                            key={file.id}
                            href={`${API_BASE}${file.download_url}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block border border-[#e3e8ef] hover:border-navy-800/40
                              rounded-[10px] px-3 py-2"
                          >
                            <p className="text-[14px] font-medium truncate">
                              {file.display_name}
                            </p>
                            <p className="text-[12px] text-[#656565] truncate">
                              {formatFileSize(file.file_size)}
                              {file.uploaded_by && ` · ${file.uploaded_by}`}
                            </p>
                          </a>
                        ))
                      )}
                      <p className="text-[11px] text-[#656565] mt-1">
                        Files are downloaded through this meeting — you do not
                        need a Google account.
                      </p>
                    </div>
                  </RoomCard>
                )}

                {panel === 'questions' && (
                  <RoomCard>
                    <SidePanelHead
                      title="Questions"
                      onClose={() => closeSide('questions')}
                    />
                    {token && (
                      <RoomQuestions guestToken={token} refreshMs={20000} />
                    )}
                  </RoomCard>
                )}

                {panel === 'chat' && (
                  <RoomCard>
                    <SidePanelHead
                      title="Chat"
                      badge={unread}
                      onClose={() => closeSide('chat')}
                    />
                    {!chatSettings.chat_enabled ? (
                      <p className="text-[13px] text-[#656565] px-4 py-6 text-center">
                        Messages need to be enabled by the host.
                      </p>
                    ) : (
                      <>
                        <div className="h-[280px] overflow-y-auto p-3 flex flex-col gap-3">
                          {visibleMessages.length === 0 ? (
                            <p className="text-[13px] text-[#656565]">
                              No messages yet. Write to the host or to the speaker.
                            </p>
                          ) : (
                            visibleMessages.map((m) => {
                              const mine =
                                m.sender_is_guest && m.sender_id === myGuestId;
                              return (
                                <div key={m.id} className={mine ? 'text-right' : ''}>
                                  <div
                                    className={`inline-block max-w-[85%] text-left px-3 py-2
                                      rounded-[12px] text-[14px] ${
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
                                      <p className="text-[11px] text-live mt-1">
                                        Declined by host
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                          <div ref={messagesEndRef} />
                        </div>

                        <div className="p-3 border-t border-[#e3e8ef] flex flex-col gap-2">
                          {chatSettings.direct_messages_enabled && people.length > 0 && (
                            <select
                              value={dmTarget}
                              onChange={(e) => setDmTarget(e.target.value)}
                              aria-label="Who to write to"
                              className="w-full border border-[#e3e8ef] rounded-lg px-2 py-1.5
                                text-[13px] bg-white"
                            >
                              <option value="">Who is this for?</option>
                              {people.map((person) => (
                                <option key={person.id} value={person.id}>
                                  {person.name} ({person.role.replace('_', '-')})
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
                                dmTarget
                                  ? 'Write your message here'
                                  : 'Pick someone above first'
                              }
                              maxLength={2000}
                              className="flex-1 min-w-0 bg-[#f9fafb] border border-[#e5e7eb]
                                rounded-[12px] px-3 py-2 text-[14px] focus:outline-none
                                focus:ring-2 focus:ring-navy-500"
                            />
                            <button
                              onClick={sendMessage}
                              aria-label="Send"
                              disabled={!draft.trim() || !dmTarget}
                              className="text-navy-700 hover:text-navy-900 px-2 flex-none
                                disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <path d="M3 20.5v-6l8-2.5-8-2.5v-6l19 8.5-19 8.5Z" fill="currentColor" />
                              </svg>
                            </button>
                          </div>

                          <p className="text-[11px] text-[#656565]">
                            {!chatSettings.direct_messages_enabled
                              ? 'Messages need to be enabled by the host.'
                              : dmTarget
                              ? 'The host reviews this before it reaches them.'
                              : 'Pick someone above to write to them.'}
                          </p>
                        </div>
                      </>
                    )}
                  </RoomCard>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* The bar. A guest has no roster to open, no register to read and
          no meeting to end - only the three things beside the room, and
          the way out. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 bg-navy-800 px-4 py-3"
        aria-label="Meeting controls"
      >
        <div className="flex items-center justify-center gap-2 sm:gap-[38px] overflow-x-auto">
          <RoomBarButton
            icon="chat"
            label="Chat"
            badge={side.includes('chat') ? 0 : unread}
            open={side.includes('chat')}
            onClick={() => toggleSide('chat')}
          />
          <RoomBarButton
            icon="questions"
            label="Questions"
            open={side.includes('questions')}
            onClick={() => toggleSide('questions')}
          />
          <RoomBarButton
            icon="resources"
            label="Resources"
            open={side.includes('resources')}
            onClick={() => { toggleSide('resources'); loadResources(); }}
          />
        </div>
        <span className="absolute end-4 top-1/2 -translate-y-1/2 hidden sm:block">
          <RoomBarButton icon="leave" label="Leave" tone="leave" onClick={leave} />
        </span>
        <div className="sm:hidden flex justify-center mt-1">
          <RoomBarButton icon="leave" label="Leave" tone="leave" onClick={leave} />
        </div>
      </nav>
    </div>
    </OrganizerProvider>
  );
};

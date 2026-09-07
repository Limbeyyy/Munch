import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api';
import { RESOURCE_POLL_MS } from '../services/polling';
import { ChatMessage, ChatPerson, ChatSettings, GuestResource } from '../types';
import toast from 'react-hot-toast';
import { LiveTranscriptStage } from '../components/LiveTranscriptStage';
import { TranscriptionSegment } from '../types';

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
  const [chatTab, setChatTab] = useState<'public' | 'private'>('public');
  const [unreadPublic, setUnreadPublic] = useState(0);
  const [unreadPrivate, setUnreadPrivate] = useState(0);
  const chatTabRef = useRef<'public' | 'private'>('public');
  const [myGuestId, setMyGuestId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Shared files
  const [showResources, setShowResources] = useState(false);
  const [resources, setResources] = useState<GuestResource[]>([]);

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
    if (showChat) {
      setUnread(0);
      if (chatTab === 'public') setUnreadPublic(0);
      else setUnreadPrivate(0);
    }
  }, [showChat, chatTab]);

  useEffect(() => {
    chatTabRef.current = chatTab;
    if (chatTab === 'public') setUnreadPublic(0);
    else setUnreadPrivate(0);
  }, [chatTab]);

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
   * The clock belongs to the host. If the meeting has not started when we
   * arrive, keep asking until it has, rather than waiting on the slower
   * admission poll and showing "Not started" in the meantime.
   */
  useEffect(() => {
    if (!token || startedAt) return;

    let cancelled = false;
    const fetchStart = async () => {
      try {
        const { meeting } = await apiClient.guestStatus(token);
        if (!cancelled && meeting?.started_at) setStartedAt(meeting.started_at);
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
  }, [token, startedAt]);

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
        const arrivedPrivate = !!data.is_direct;
        const watching =
          showChatRef.current &&
          chatTabRef.current === (arrivedPrivate ? 'private' : 'public');
        if (!watching) {
          setUnread((n) => n + 1);
          if (arrivedPrivate) setUnreadPrivate((n) => n + 1);
          else setUnreadPublic((n) => n + 1);
        }
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

  const visibleMessages = messages.filter((m) =>
    chatTab === 'private' ? m.is_direct : !m.is_direct
  );

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

  return (
    <div className="min-h-screen bg-gray-900 text-white flex">
      <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 bg-gray-950 flex flex-col relative min-h-0">
        <LiveTranscriptStage transcript={transcript} />

        <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full text-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-mono tabular-nums">
            {startedAt ? formatElapsed(elapsed) : 'Not started'}
          </span>
        </div>

        <div className="absolute top-4 right-4 bg-black/60 px-3 py-1.5 rounded-full text-xs">
          Joined as guest &middot; {guestName}
        </div>
      </div>

      <div className="bg-gray-800 px-4 py-4 flex flex-wrap justify-center items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">{meetingTitle}</h2>
          <p className="text-xs text-gray-400">Code {meetingCode}</p>
        </div>

        <button
          onClick={() => {
            setShowResources((v) => !v);
            loadResources();
          }}
          className={`px-6 py-2 rounded-lg font-semibold ${
            showResources ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'
          }`}
        >
          <span aria-hidden="true">&#128206;</span> Files ({resources.length})
        </button>

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

        <button
          onClick={leave}
          className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold"
        >
          Leave
        </button>
      </div>
      </div>

      {showResources && (
        <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col min-h-0">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold">Shared files</h3>
            <button
              onClick={() => setShowResources(false)}
              aria-label="Close files"
              className="text-gray-400 hover:text-white px-2"
            >
              &#10005;
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {resources.length === 0 ? (
              <p className="text-xs text-gray-400">
                Nothing shared yet. Files the host or presenters add will appear
                here.
              </p>
            ) : (
              <div className="space-y-2">
                {resources.map((r) => (
                  <a
                    key={r.id}
                    href={`${API_BASE}${r.download_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-gray-700 hover:bg-gray-600 p-3 rounded text-sm transition"
                  >
                    <p className="font-medium truncate">{r.display_name}</p>
                    <p className="text-gray-300 text-xs mt-1 truncate">
                      {formatFileSize(r.file_size)}
                      {r.uploaded_by && ` · ${r.uploaded_by}`}
                    </p>
                    <p className="text-[11px] text-blue-300 mt-1">
                      &#11015; Download
                    </p>
                  </a>
                ))}
              </div>
            )}
          </div>

          <p className="p-3 text-[11px] text-gray-400 border-t border-gray-700">
            Files are downloaded through this meeting - you do not need a
            Google account.
          </p>
        </div>
      )}

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
            </div>
          ) : (
            <>
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
                    const mine = m.sender_is_guest && m.sender_id === myGuestId;
                    return (
                      <div key={m.id} className={mine ? 'text-right' : ''}>
                        <div
                          className={`inline-block max-w-[85%] text-left px-3 py-2 rounded-lg text-sm ${
                            mine ? 'bg-blue-600' : 'bg-gray-700'
                          }`}
                        >
                          <p className="text-xs text-gray-200 mb-0.5">
                            {mine ? 'You' : m.sender_name}
                            {m.sender_is_guest && !mine && (
                              <span className="ml-1 text-purple-200">(guest)</span>
                            )}
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
                  people.length > 0 && (
                  <select
                    value={dmTarget}
                    onChange={(e) => setDmTarget(e.target.value)}
                    className="w-full bg-gray-700 text-sm rounded px-2 py-1.5"
                  >
                    <option value="">Everyone in the room</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        Direct to {p.name} ({p.role.replace('_', '-')})
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

                <p className="text-[11px] text-gray-400">
                  {chatTab === 'public'
                    ? 'Everyone in the meeting can see these messages.'
                    : !chatSettings.direct_messages_enabled
                    ? 'Direct messages need to be enabled by the host.'
                    : dmTarget
                    ? 'The host reviews this before it reaches them.'
                    : 'Pick someone above to message them directly.'}
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

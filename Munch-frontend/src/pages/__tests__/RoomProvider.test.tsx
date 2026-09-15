import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MeetingRoomPage } from '../MeetingRoomPage';
import { apiClient } from '../../services/api';

/**
 * The room shares components with the dashboards, and those speak both
 * languages - which means they read the organizer context. When the room
 * did not provide one they threw on first render and took the whole room
 * down with them, which is how a photo section brought down a meeting.
 */
// Every call the room makes answers with something harmless unless this
// test says otherwise. The question here is whether the page mounts, not
// which endpoints it happens to touch on the way.
jest.mock('../../services/api', () => {
  const made = new Map<string, jest.Mock>();
  return {
    apiClient: new Proxy({} as any, {
      get: (_target, name: string) => {
        if (name === 'hasSession') return () => false;
        if (!made.has(name)) made.set(name, jest.fn());
        const fn = made.get(name)!;
        // This project resets mock implementations between tests, so the
        // harmless default is re-applied on each access rather than once.
        if (fn.getMockImplementation() === undefined) {
          fn.mockImplementation(async () => []);
        }
        return fn;
      },
    }),
  };
});

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn(),
  }),
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const meeting = {
  id: 'm1',
  meeting_code: 'ABC123',
  title: 'Opening day',
  status: 'active',
  scheduled_start: new Date(Date.now() - 600000).toISOString(),
  scheduled_end: new Date(Date.now() + 3600000).toISOString(),
  started_at: new Date(Date.now() - 600000).toISOString(),
  host: { id: 'u1', email: 'host@example.com' },
  participant_count: 1,
  entry: {
    is_open: true, can_start: true, opens_at: new Date().toISOString(),
    scheduled_start: new Date().toISOString(), entry_window_minutes: 15,
  },
  current_session: {
    id: 's1', title: 'Haldi', starts_at: new Date(Date.now() - 600000).toISOString(),
    started_at: new Date(Date.now() - 600000).toISOString(),
    ends_at: new Date(Date.now() + 1800000).toISOString(),
    duration_minutes: 40, status: 'live', is_over: false,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  // Nepali is the default, and this test reads the English wording.
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  // jsdom has no layout, so it has no scrollIntoView either; the chat
  // keeps its newest message in view through one.
  (Element.prototype as any).scrollIntoView = jest.fn();
  (window as any).WebSocket = class {
    // The room refuses to send down a socket that is not open, so the
    // stand-in has to say it is one - including the constant the check
    // reads it against.
    static OPEN = 1;
    onmessage: any; onopen: any; onerror: any; onclose: any;
    readyState = 1;
    constructor() { (window as any).__roomSocket = this; }
    close() {}
    send() {}
  };
  api.getMeeting.mockResolvedValue(meeting as any);
  api.getChatSettings.mockResolvedValue(
    { chat_enabled: true, direct_messages_enabled: true } as any
  );
  // The board answers with two lists, not the bare array the tolerant
  // default hands back for everything else.
  api.getMeetingBoard.mockResolvedValue({ faq: [], suggestions: [] } as any);
  api.getReviewedMessages.mockResolvedValue(
    { from_users: [], from_guests: [] } as any
  );
  api.getPhotos.mockResolvedValue({
    meeting_id: 'm1', meeting_code: 'ABC123', meeting_title: 'Opening day',
    meeting_is_finished: false, can_upload: false, is_a_photographer: true,
    can_arrange: true, folders: [], photos: [],
  } as any);
});

const showRoom = () =>
  render(
    <MemoryRouter initialEntries={['/meeting/ABC123']}>
      <Routes>
        <Route path="/meeting/:meetingCode" element={<MeetingRoomPage />} />
      </Routes>
    </MemoryRouter>
  );

/** Press one of the bar's controls. */
const openSide = async (label: string) => {
  const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
  fireEvent.click(within(bar).getByRole('button', { name: new RegExp(label) }));
};

describe('the meeting room', () => {
  it('renders without the shared components asking for a context it has not got', async () => {
    // React reports a render failure across several arguments and in a
    // second "the above error occurred" line, so the whole of each
    // complaint is kept rather than its first word.
    const complaints: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      complaints.push(args.map((a) => String((a as any)?.message ?? a)).join(' '));
    };

    try {
      showRoom();
      await waitFor(() => expect(api.getMeeting).toHaveBeenCalled());
      // The parts that read the context are drawn once the meeting has
      // arrived, so the failure would come after that first paint.
      await screen.findByRole('heading', { name: 'Agenda Summary' });
    } finally {
      console.error = realError;
    }

    const missingContext = complaints.filter((c) =>
      c.includes('useOrganizer must be used inside OrganizerProvider')
    );
    expect(missingContext).toEqual([]);
  });

  it('draws the photo section, which is what asked for the context', async () => {
    showRoom();

    await openSide('Resources');
    fireEvent.click(await screen.findByRole('tab', { name: 'photos' }));

    await waitFor(() => expect(api.getPhotos).toHaveBeenCalled());
  });
});

describe('the room as the design lays it out', () => {
  it('gives the transcript the width until something is asked for', async () => {
    showRoom();

    // By heading: the bar along the foot names some of these too.
    expect(
      await screen.findByRole('heading', { name: 'Agenda Summary' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live Transcript' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Resources' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Chat' })).not.toBeInTheDocument();
  });

  it('carries the controls along its foot', async () => {
    showRoom();

    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    for (const label of ['Chat', 'Questions', 'Resources', 'Share', 'Leave']) {
      expect(
        within(bar).getByRole('button', { name: new RegExp(label) })
      ).toBeInTheDocument();
    }
  });

  it('opens the people beside the room, like everything else', async () => {
    // It used to open over the room. Nothing does now: a roster is
    // something you consult while the meeting carries on, not a door you
    // shut behind you.
    showRoom();

    await openSide('Participants');

    expect(await screen.findByRole('heading', { name: 'Participants' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has both halves of it: who is here, and who came', async () => {
    api.getAttendance.mockResolvedValue({
      expected_total: 2, attended_count: 2, active_count: 2, absent_count: 0,
      attended: [
        { type: 'user', name: 'Rahul Ingnam', email: 'rahul@example.com',
          role: 'attendee', is_active: true },
        { type: 'guest', name: 'Rahul Ingnam', email: null, role: 'guest',
          is_active: true },
      ],
      did_not_attend: [],
    } as any);

    showRoom();
    await openSide('Participants');

    fireEvent.click(await screen.findByRole('tab', { name: 'Attendance' }));

    expect(await screen.findByText('On the roll')).toBeInTheDocument();
    expect(screen.getByText('Came (2)')).toBeInTheDocument();
    expect(screen.getAllByText('Rahul Ingnam')).toHaveLength(2);
  });

  it('opens the board from the questions control', async () => {
    showRoom();

    await openSide('Questions');

    expect(await screen.findByRole('heading', { name: 'Questions' })).toBeInTheDocument();
    // The board is what people asked, sorted into two - and, for the
    // host, the queue of what has not been sorted yet.
    expect(await screen.findByRole('tab', { name: /Questions/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Suggestions/ })).toBeInTheDocument();
  });

  it('lets the host sort what people wrote without leaving the room', async () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
    api.getPendingMessages.mockResolvedValue([{
      id: 'm9', body: 'Please slow down', created_at: new Date().toISOString(),
      is_direct: true, moderation_status: 'pending', sender_id: 'g1',
      sender_name: 'Rahul', sender_is_guest: true, recipient_name: 'The host',
    }] as any);

    showRoom();
    await openSide('Questions');
    fireEvent.click(await screen.findByRole('tab', { name: /Requests \(1\)/ }));

    expect(await screen.findByText('Please slow down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'To questions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'To suggestions' })).toBeInTheDocument();
    useAuthStore.setState({ user: null });
  });

  it('opens sharing from the share control', async () => {
    showRoom();

    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    fireEvent.click(within(bar).getByRole('button', { name: /Share/ }));

    expect(
      await screen.findByRole('dialog', { name: 'Share this meeting' })
    ).toBeInTheDocument();
  });

  it('opens what the bar asks for, beside the room', async () => {
    showRoom();

    await openSide('Chat');

    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
  });

  it('stacks them in the order they were asked for', async () => {
    // First asked for sits at the top: the column is a queue, not a
    // fixed arrangement.
    showRoom();

    await openSide('Resources');
    await openSide('Chat');

    const headings = screen
      .getAllByRole('heading')
      .map((h) => h.textContent?.replace(/\s+/g, ' ').trim())
      .filter((text) => text === 'Resources' || text?.startsWith('Chat'));
    expect(headings[0]).toBe('Resources');

    // Asked for the other way round, they stack the other way round.
    await openSide('Resources');
    await openSide('Chat');
    await openSide('Chat');
    await openSide('Resources');

    const reversed = screen
      .getAllByRole('heading')
      .map((h) => h.textContent?.replace(/\s+/g, ' ').trim())
      .filter((text) => text === 'Resources' || text?.startsWith('Chat'));
    expect(reversed[0]?.startsWith('Chat')).toBe(true);
  });

  it('holds two beside the room, and the third pushes out the first', async () => {
    // Three stacked left each one a letterbox with a scrollbar. The
    // column holds two, and the one that has been there longest goes -
    // the same first-in-first-out the order already follows.
    showRoom();

    await openSide('Chat');
    await openSide('Resources');
    await openSide('Questions');

    const beside = () =>
      screen
        .getAllByRole('heading')
        .map((h) => h.textContent?.replace(/\s+/g, ' ').trim())
        .filter((text) =>
          text === 'Resources' || text === 'Questions' || text?.startsWith('Chat')
        );

    // Chat was first in, so Chat is first out; the other two keep their order.
    expect(beside()).toEqual(['Resources', 'Questions']);
  });

  it('lets the one that was pushed out come back, in its turn', async () => {
    showRoom();

    await openSide('Chat');
    await openSide('Resources');
    await openSide('Questions');
    await openSide('Chat');

    const beside = screen
      .getAllByRole('heading')
      .map((h) => h.textContent?.replace(/\s+/g, ' ').trim())
      .filter((text) =>
        text === 'Resources' || text === 'Questions' || text?.startsWith('Chat')
      );

    // Resources is now the oldest, so it makes way for Chat.
    expect(beside).toEqual(['Questions', 'Chat']);
  });

  it('sends a panel away when its control is pressed again', async () => {
    showRoom();

    await openSide('Chat');
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();

    await openSide('Chat');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Chat' })).not.toBeInTheDocument()
    );
  });

  it('closes one from its own cross as well', async () => {
    showRoom();

    await openSide('Resources');
    fireEvent.click(await screen.findByRole('button', { name: 'Close resources' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Resources' })).not.toBeInTheDocument()
    );
  });

  it('lets nothing else take that column', async () => {
    // Sharing is the one thing that still opens over the room: it is a
    // thing you do and finish, not one you keep beside you.
    showRoom();

    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    fireEvent.click(within(bar).getByRole('button', { name: /Share/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the controls centred and leaving out at the end', async () => {
    // A right-hand button that joins the centring drags the rest off
    // centre, which is what it had been doing.
    showRoom();

    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    const leave = within(bar).getByRole('button', { name: /Leave/ });
    const group = within(bar).getByRole('button', { name: /Chat/ }).parentElement!;

    expect(group.className).toContain('justify-center');
    expect(group).not.toContainElement(leave);
    expect(leave.parentElement!.className).toContain('absolute');
  });

  it('has no browser chrome pretending to be part of the app', async () => {
    // The mock was drawn inside a Safari window; the toolbar and its
    // traffic lights are the picture frame, not the room.
    showRoom();

    await screen.findByText('Agenda Summary');
    expect(screen.queryByText('zenwork.com')).not.toBeInTheDocument();
  });
});

/**
 * The room is the meeting's, and it outlives every talk inside it.
 *
 * A meeting of ten sessions is one room that all ten happen in: a session
 * ending closes off that session - its transcript, its chat, its resources
 * - and the room goes on, offering the host the next speaker. It used to
 * show everybody the door the moment a talk's clock ran out.
 */
describe('the room between two sessions', () => {
  const waiting = {
    ...meeting,
    current_session: {
      id: null, title: '', starts_at: undefined,
      started_at: null, ends_at: null,
      duration_minutes: null, status: null, is_over: false,
      between_sessions: true, awaiting_next: true,
      next_id: 's2', next_title: 'Mehendi',
      next_starts_at: new Date(Date.now() + 300000).toISOString(),
    },
  };

  it('stays open and says what is coming', async () => {
    api.getMeeting.mockResolvedValue(waiting as any);

    showRoom();

    expect(await screen.findByText('Between sessions')).toBeInTheDocument();
    expect(screen.getByText('Up next: Mehendi')).toBeInTheDocument();
  });

  it('does not show anybody out because a talk finished', async () => {
    // The shape the room used to be given when a session closed: over,
    // with its hour behind it. That navigated everybody home.
    api.getMeeting.mockResolvedValue({
      ...meeting,
      current_session: {
        ...meeting.current_session,
        ends_at: new Date(Date.now() - 60000).toISOString(),
        status: 'done',
        is_over: true,
      },
    } as any);

    showRoom();

    // Still the room, not the page it navigated to on the way out.
    expect(
      await screen.findByRole('navigation', { name: 'Meeting controls' })
    ).toBeInTheDocument();
  });

  it('offers the host the next speaker, and starts them', async () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
    api.getMeeting.mockResolvedValue(waiting as any);
    api.startSession.mockResolvedValue({ id: 's2' } as any);

    showRoom();

    const start = await screen.findByRole('button', { name: 'Start Mehendi' });
    fireEvent.click(start);

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith('s2'));
    useAuthStore.setState({ user: null });
  });

  it('says nothing about starting one when the running order is spent', async () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
    api.getMeeting.mockResolvedValue({
      ...meeting,
      current_session: {
        ...waiting.current_session,
        awaiting_next: false, next_id: null, next_title: '',
      },
    } as any);

    showRoom();

    const band = (
      await screen.findByText(/Nothing left in the running order/)
    ).closest('div')!.parentElement!;
    // The band says the room stays open, and offers nothing to start:
    // there is nothing left in the running order to put on stage.
    expect(within(band).queryByRole('button')).toBeNull();
    useAuthStore.setState({ user: null });
  });

  it('shows only the lines said during the talk on stage', async () => {
    // A transcript belongs to its session: the next speaker should not
    // start underneath the last one's words.
    api.getMeetingSegments.mockResolvedValue([
      { text: 'From the first talk', session_id: 's0', created_at: new Date().toISOString(),
        start_time: 0, end_time: 1, speaker_name: 'Asha', is_final: true },
      { text: 'From the one on stage', session_id: 's1', created_at: new Date().toISOString(),
        start_time: 0, end_time: 1, speaker_name: 'Bina', is_final: true },
    ] as any);

    showRoom();

    expect(await screen.findByText(/From the one on stage/)).toBeInTheDocument();
    expect(screen.queryByText(/From the first talk/)).toBeNull();
  });
});

/**
 * The running order, live, inside the room.
 *
 * The host rearranges what is left of the meeting they are standing in and
 * everybody else's copy follows. The times are on show for both, because
 * the whole point is watching them move when a talk runs long.
 */
describe('the running order inside the room', () => {
  const hour = 3600000;
  const start = new Date(Date.now() - hour).toISOString();
  const running = [
    {
      id: 's1', title: 'Haldi', speaker_name: 'Asha', hall: '', status: 'live',
      starts_at: start, duration_minutes: 40, meeting: 'm1', position: 0,
    },
    {
      id: 's2', title: 'Mehendi', speaker_name: 'Bina', hall: '', status: 'scheduled',
      starts_at: new Date(Date.now() + hour).toISOString(),
      duration_minutes: 60, meeting: 'm1', position: 1,
    },
    {
      id: 's3', title: 'Sangeet', speaker_name: 'Chandra', hall: '', status: 'scheduled',
      starts_at: new Date(Date.now() + 3 * hour).toISOString(),
      duration_minutes: 60, meeting: 'm1', position: 2,
    },
  ];

  const asHost = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
  };
  const asAttendee = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u9', email: 'someone@example.com' } });
  };

  afterEach(() => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: null });
  });

  beforeEach(() => {
    api.listSessions.mockResolvedValue(running as any);
  });

  const order = async () =>
    within(await screen.findByRole('list', { name: 'Running order' }))
      .getAllByRole('listitem')
      .map((row) => row.textContent);

  it('shows every talk with the time it now runs at', async () => {
    asAttendee();
    showRoom();

    const rows = await order();
    expect(rows[0]).toContain('Haldi');
    expect(rows[1]).toContain('Mehendi');
    // A time range, and how long it runs for.
    expect(rows[1]).toMatch(/\d{1,2}:\d{2}/);
    expect(rows[1]).toContain('60 min');
  });

  it('is read-only for anybody who is not the host', async () => {
    asAttendee();
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
  });

  it('gives the host a handle on every talk still to run', async () => {
    asHost();
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    expect(await within(list).findByRole('button', { name: /Move “Mehendi”/ }))
      .toBeEnabled();
    // The one on stage is not the host's to move: somebody is speaking.
    expect(within(list).getByRole('button', { name: /Move “Haldi”/ })).toBeDisabled();
  });

  it('writes the new order down the moment one is dropped on another', async () => {
    asHost();
    api.rescheduleSessions.mockResolvedValue({ moved: [], moved_count: 2 } as any);
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    const handle = await within(list).findByRole('button', { name: /Move “Sangeet”/ });
    const rows = within(list).getAllByRole('listitem');

    const dataTransfer = { setData: jest.fn(), getData: () => 's3', effectAllowed: '' };
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.drop(rows[1], { dataTransfer });

    await waitFor(() => expect(api.rescheduleSessions).toHaveBeenCalled());
    const sent = api.rescheduleSessions.mock.calls[0][0];
    // Both talks move: they have changed places.
    expect(sent.map((c: any) => c.id).sort()).toEqual(['s2', 's3']);
    // Sangeet takes the hour Mehendi held.
    expect(sent.find((c: any) => c.id === 's3')!.starts_at)
      .toBe(new Date(running[1].starts_at).toISOString());
  });

  it('re-reads the running order when the host elsewhere moves it', async () => {
    asAttendee();
    showRoom();
    await screen.findByRole('list', { name: 'Running order' });
    const readsBefore = api.listSessions.mock.calls.length;

    // The socket the room opened, told the day has been rearranged.
    const socket = (window as any).__roomSocket;
    socket.onmessage({
      data: JSON.stringify({ type: 'state_update', state: { schedule_changed: true } }),
    });

    await waitFor(() =>
      expect(api.listSessions.mock.calls.length).toBeGreaterThan(readsBefore)
    );
  });
});

/**
 * Nothing in the room is said to the room.
 *
 * There is no public thread on either side of it: what people have to say
 * goes to the host or to the speaker. So the panel is a list of people
 * rather than a box with a dropdown over it - a conversation with somebody
 * has a face, a name and a last line.
 */
describe('the room chat', () => {
  const openChat = async () => {
    await openSide('Chat');
    return screen.findByRole('heading', { name: 'Chat' });
  };

  beforeEach(() => {
    api.getParticipants.mockResolvedValue([
      { id: 'p1', role: 'presenter', is_active: true,
        user: { id: 'u5', email: 'speaker@example.com' } },
    ] as any);
  });

  it('has no room-wide thread to write into', async () => {
    showRoom();
    await openChat();

    expect(screen.queryByRole('tab', { name: /Room/ })).toBeNull();
    expect(screen.queryByText(/Everyone in the meeting can see these/)).toBeNull();
  });

  it('offers the people there are to write to, by name', async () => {
    showRoom();
    await openChat();

    expect(await screen.findByText('Chats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /speaker@example.com/ }))
      .toBeInTheDocument();
    // The dropdown it replaces is gone.
    expect(screen.queryByLabelText('Who to write to')).toBeNull();
  });

  it('opens a conversation with whoever is chosen', async () => {
    showRoom();
    await openChat();

    fireEvent.click(await screen.findByRole('button', { name: /speaker@example.com/ }));

    expect(await screen.findByPlaceholderText('Write your message here'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to chats' })).toBeInTheDocument();
  });

  it('sends what is written to the person it is open with', async () => {
    showRoom();
    await openChat();

    // The socket the room itself opened, not one left over from before.
    const sent: any[] = [];
    (window as any).__roomSocket.send = (raw: string) => sent.push(JSON.parse(raw));

    fireEvent.click(await screen.findByRole('button', { name: /speaker@example.com/ }));

    const box = await screen.findByPlaceholderText('Write your message here');
    fireEvent.change(box, { target: { value: 'A question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(sent).toContainEqual({
      type: 'chat_message', message: 'A question', recipient_id: 'u5',
    });
  });
});

/**
 * The room is open; whether anybody may write in it is the host's.
 *
 * "Room open to everyone" went with the public thread it described. What
 * is left is one switch, and until it is on there is nothing to send with.
 */
describe('the one chat switch', () => {
  const asHost = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
  };

  afterEach(() => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: null });
  });

  it('has nothing to say about opening the room', async () => {
    asHost();
    showRoom();
    await openSide('Chat');

    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.queryByText('Room open to everyone')).toBeNull();
  });

  it('is a switch, and the host is the one who has it', async () => {
    asHost();
    api.updateChatSettings.mockResolvedValue(
      { chat_enabled: true, direct_messages_enabled: false } as any
    );
    showRoom();
    await openSide('Chat');

    const control = await screen.findByRole('switch', { name: 'Allow direct messages' });
    expect(control).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(control);

    await waitFor(() => expect(api.updateChatSettings).toHaveBeenCalledWith(
      'm1', { direct_messages_enabled: false }
    ));
  });

  it('nobody else has it', async () => {
    showRoom();
    await openSide('Chat');

    await screen.findByRole('heading', { name: 'Chat' });
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('and until it is on, there is nothing to send with', async () => {
    api.getChatSettings.mockResolvedValue(
      { chat_enabled: true, direct_messages_enabled: false } as any
    );
    api.getParticipants.mockResolvedValue([
      { id: 'p1', role: 'presenter', is_active: true,
        user: { id: 'u5', email: 'speaker@example.com' } },
    ] as any);

    showRoom();
    await openSide('Chat');
    fireEvent.click(await screen.findByRole('button', { name: /speaker@example.com/ }));

    const sent: any[] = [];
    (window as any).__roomSocket.send = (raw: string) => sent.push(JSON.parse(raw));

    const box = await screen.findByPlaceholderText(/has not opened messages/);
    expect(box).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    // And pressing it anyway writes nothing down the socket.
    fireEvent.change(box, { target: { value: 'A question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sent).toEqual([]);
  });
});

/**
 * The running order, live, inside the room.
 *
 * The host rearranges what is left of the meeting they are standing in and
 * everybody else's copy follows. The times are on show for both, because
 * the whole point is watching them move when a talk runs long.
 */
describe('the running order inside the room', () => {
  const hour = 3600000;
  const start = new Date(Date.now() - hour).toISOString();
  const running = [
    {
      id: 's1', title: 'Haldi', speaker_name: 'Asha', hall: '', status: 'live',
      starts_at: start, duration_minutes: 40, meeting: 'm1', position: 0,
    },
    {
      id: 's2', title: 'Mehendi', speaker_name: 'Bina', hall: '', status: 'scheduled',
      starts_at: new Date(Date.now() + hour).toISOString(),
      duration_minutes: 60, meeting: 'm1', position: 1,
    },
    {
      id: 's3', title: 'Sangeet', speaker_name: 'Chandra', hall: '', status: 'scheduled',
      starts_at: new Date(Date.now() + 3 * hour).toISOString(),
      duration_minutes: 60, meeting: 'm1', position: 2,
    },
  ];

  const asHost = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
  };
  const asAttendee = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u9', email: 'someone@example.com' } });
  };

  afterEach(() => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: null });
  });

  beforeEach(() => {
    api.listSessions.mockResolvedValue(running as any);
  });

  const order = async () =>
    within(await screen.findByRole('list', { name: 'Running order' }))
      .getAllByRole('listitem')
      .map((row) => row.textContent);

  it('shows every talk with the time it now runs at', async () => {
    asAttendee();
    showRoom();

    const rows = await order();
    expect(rows[0]).toContain('Haldi');
    expect(rows[1]).toContain('Mehendi');
    // A time range, and how long it runs for.
    expect(rows[1]).toMatch(/\d{1,2}:\d{2}/);
    expect(rows[1]).toContain('60 min');
  });

  it('is read-only for anybody who is not the host', async () => {
    asAttendee();
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
  });

  it('gives the host a handle on every talk still to run', async () => {
    asHost();
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    expect(await within(list).findByRole('button', { name: /Move “Mehendi”/ }))
      .toBeEnabled();
    // The one on stage is not the host's to move: somebody is speaking.
    expect(within(list).getByRole('button', { name: /Move “Haldi”/ })).toBeDisabled();
  });

  it('writes the new order down the moment one is dropped on another', async () => {
    asHost();
    api.rescheduleSessions.mockResolvedValue({ moved: [], moved_count: 2 } as any);
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    const handle = await within(list).findByRole('button', { name: /Move “Sangeet”/ });
    const rows = within(list).getAllByRole('listitem');

    const dataTransfer = { setData: jest.fn(), getData: () => 's3', effectAllowed: '' };
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.drop(rows[1], { dataTransfer });

    await waitFor(() => expect(api.rescheduleSessions).toHaveBeenCalled());
    const sent = api.rescheduleSessions.mock.calls[0][0];
    // Both talks move: they have changed places.
    expect(sent.map((c: any) => c.id).sort()).toEqual(['s2', 's3']);
    // Sangeet takes the hour Mehendi held.
    expect(sent.find((c: any) => c.id === 's3')!.starts_at)
      .toBe(new Date(running[1].starts_at).toISOString());
  });

  it('re-reads the running order when the host elsewhere moves it', async () => {
    asAttendee();
    showRoom();
    await screen.findByRole('list', { name: 'Running order' });
    const readsBefore = api.listSessions.mock.calls.length;

    // The socket the room opened, told the day has been rearranged.
    const socket = (window as any).__roomSocket;
    socket.onmessage({
      data: JSON.stringify({ type: 'state_update', state: { schedule_changed: true } }),
    });

    await waitFor(() =>
      expect(api.listSessions.mock.calls.length).toBeGreaterThan(readsBefore)
    );
  });
});


/**
 * What the host is asked when they press Leave.
 *
 * Ending a session and ending the meeting are different things - one
 * closes off a talk and leaves the room standing, the other closes the
 * room for everybody - and so is simply stepping out. The button asks
 * rather than guessing.
 */
describe('the end choice', () => {
  const asHost = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
  };

  afterEach(() => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: null });
  });

  const openIt = async () => {
    asHost();
    showRoom();
    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    fireEvent.click(within(bar).getByRole('button', { name: /Leave/ }));
  };

  it('offers ending the meeting, or simply leaving', async () => {
    await openIt();

    expect(await screen.findByRole('button', { name: /End the meeting/ }))
      .toBeInTheDocument();
    // Stepping out is still there: the host has to be able to leave.
    expect(screen.getByRole('button', { name: /Just leave/ })).toBeInTheDocument();
  });

  it('and says nothing about the session, which is ended on its own card', async () => {
    await openIt();

    await screen.findByRole('button', { name: /End the meeting/ });
    expect(screen.queryByRole('button', { name: /End the session/ })).toBeNull();
  });

  it('ends the talk from the card that shows it, and stays in the room', async () => {
    api.endSession.mockResolvedValue({} as any);
    asHost();
    showRoom();

    fireEvent.click(await screen.findByRole('button', { name: 'End Session' }));

    await waitFor(() => expect(api.endSession).toHaveBeenCalledWith('s1'));
    expect(api.endMeeting).not.toHaveBeenCalled();
    // Still the room, not the page it navigates to on the way out.
    expect(
      await screen.findByRole('navigation', { name: 'Meeting controls' })
    ).toBeInTheDocument();
  });

  it('offers it to nobody else', async () => {
    showRoom();

    await screen.findByRole('navigation', { name: 'Meeting controls' });
    expect(screen.queryByRole('button', { name: 'End Session' })).toBeNull();
  });

  it('nor when nothing is on stage', async () => {
    asHost();
    api.getMeeting.mockResolvedValue({
      ...meeting,
      current_session: {
        id: null, title: '', started_at: null, ends_at: null, is_over: false,
        between_sessions: true, awaiting_next: false,
      },
    } as any);

    showRoom();

    await screen.findByRole('navigation', { name: 'Meeting controls' });
    expect(screen.queryByRole('button', { name: 'End Session' })).toBeNull();
  });

  it('and the meeting can still be ended between two talks', async () => {
    api.getMeeting.mockResolvedValue({
      ...meeting,
      current_session: {
        id: null, title: '', started_at: null, ends_at: null, is_over: false,
        between_sessions: true, awaiting_next: false,
      },
    } as any);
    await openIt();

    expect(await screen.findByRole('button', { name: /End the meeting/ }))
      .toBeInTheDocument();
  });
});

/**
 * The running order as cards.
 *
 * Each talk carries where it comes in the order, who is giving it, when it
 * runs and how long for - and, for the host, a way to put it on stage.
 * Any of them, not only the next one: starting a talk puts it at the head
 * of what is left, so the speaker who is actually in the hall goes on
 * without the day being rearranged first.
 */
describe('the agenda cards', () => {
  const hour = 3600000;
  const running = [
    {
      id: 's1', title: 'Haldi', speaker_name: 'Asha', hall: '', status: 'live',
      starts_at: new Date(Date.now() - hour).toISOString(),
      duration_minutes: 40, meeting: 'm1', position: 0,
    },
    {
      id: 's2', title: 'Mehendi', speaker_name: 'Bina', hall: '', status: 'scheduled',
      starts_at: new Date(Date.now() + hour).toISOString(),
      duration_minutes: 60, meeting: 'm1', position: 1,
    },
  ];

  const asHost = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
  };

  afterEach(() => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: null });
  });

  beforeEach(() => {
    api.listSessions.mockResolvedValue(running as any);
  });

  it('numbers each talk in the order it runs', async () => {
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[1]).toHaveTextContent('2');
  });

  it('keeps the time, the length and the speaker on the card', async () => {
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    const second = within(list).getAllByRole('listitem')[1];
    expect(second).toHaveTextContent('Mehendi');
    expect(second).toHaveTextContent('Bina');
    expect(second).toHaveTextContent('60 min');
    expect(second.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('offers the host a start on a talk still to run', async () => {
    asHost();
    api.startSession.mockResolvedValue({} as any);
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    const starts = within(list).getAllByRole('button', { name: 'Start Session' });
    expect(starts).toHaveLength(1);

    fireEvent.click(starts[0]);

    // That one, not whichever the server thinks is next.
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith('s2'));
  });

  it('marks the one on stage rather than offering to start it', async () => {
    asHost();
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    const onStage = within(list).getAllByRole('listitem')[0];
    expect(onStage).toHaveTextContent('Live');
    expect(within(onStage).queryByRole('button', { name: 'Start Session' })).toBeNull();
  });

  it('offers nobody else a start at all', async () => {
    showRoom();

    const list = await screen.findByRole('list', { name: 'Running order' });
    expect(within(list).queryByRole('button', { name: 'Start Session' })).toBeNull();
  });
});

/**
 * What a finished talk settled.
 *
 * A talk that is over is not nothing - it is the part of the day people
 * most often want back - and the running order used to forget it the
 * moment it finished. Where the host has written one up and published it,
 * the card says so and opens to show it.
 */
describe('a summary on the agenda', () => {
  const finished = [{
    id: 's0', title: 'Kataho', speaker_name: 'Sumin', hall: '', status: 'done',
    starts_at: new Date(Date.now() - 7200000).toISOString(),
    duration_minutes: 60, meeting: 'm1', position: 0,
  }];

  const published = {
    conclusions: [{
      session_id: 's0', session_title: 'Kataho',
      session_starts_at: new Date().toISOString(),
      speaker_name: 'Sumin', hall: '', meeting_id: 'm1', meeting_title: 'Opening day',
      event_id: 'e1', event_title: 'NEA',
      findings: ['The grant is released in two parts.'],
      actions: [{ task: 'Send the letter', owner: 'Bina', due: 'Friday' }],
      published_at: new Date().toISOString(),
    }],
    mine: [],
  };

  beforeEach(() => {
    api.listSessions.mockResolvedValue(finished as any);
  });

  it('says so on the talk it belongs to', async () => {
    api.getConclusions.mockResolvedValue(published as any);
    showRoom();

    // The tag says a summary exists; the control that opens it is its own
    // thing, at the top of the card where an expander belongs.
    expect(await screen.findByText('Summary ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Summary of “Kataho”/ }))
      .toBeInTheDocument();
  });

  it('opens it where the card is, rather than somewhere else', async () => {
    api.getConclusions.mockResolvedValue(published as any);
    showRoom();

    const opener = await screen.findByRole('button', { name: /Summary of “Kataho”/ });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(opener);

    expect(await screen.findByText('The grant is released in two parts.'))
      .toBeInTheDocument();
    expect(screen.getByText(/Send the letter/)).toBeInTheDocument();
    expect(opener).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes again when it is pressed a second time', async () => {
    api.getConclusions.mockResolvedValue(published as any);
    showRoom();

    const opener = await screen.findByRole('button', { name: /Summary of “Kataho”/ });
    fireEvent.click(opener);
    await screen.findByText('The grant is released in two parts.');
    fireEvent.click(opener);

    expect(screen.queryByText('The grant is released in two parts.')).toBeNull();
  });

  it('has no opener at all on a talk with nothing published', async () => {
    api.getConclusions.mockResolvedValue({ conclusions: [], mine: [] } as any);
    showRoom();

    await screen.findByRole('list', { name: 'Running order' });
    expect(screen.queryByRole('button', { name: /Summary of/ })).toBeNull();
  });

  it('says nothing where nothing has been published', async () => {
    api.getConclusions.mockResolvedValue({ conclusions: [], mine: [] } as any);
    showRoom();

    await screen.findByRole('list', { name: 'Running order' });
    expect(screen.queryByText('Summary ready')).toBeNull();
  });

  it('and nothing about another meeting', async () => {
    api.getConclusions.mockResolvedValue({
      conclusions: [{ ...published.conclusions[0], meeting_id: 'somewhere-else' }],
      mine: [],
    } as any);
    showRoom();

    await screen.findByRole('list', { name: 'Running order' });
    expect(screen.queryByText('Summary ready')).toBeNull();
  });
});

/**
 * One face per person in the chat.
 *
 * A guest arrives in two lists at once - the roster projects them as a
 * participant under the guest's own id, and the guest list carries them
 * again under the same id. Both are the same seat, and showing it twice
 * put the same face in the chat over and over.
 */
describe('who there is to write to', () => {
  const asHost = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
  };

  afterEach(() => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: null });
  });

  it('lists a guest once, not once per list they turn up in', async () => {
    asHost();
    api.getParticipants.mockResolvedValue([
      { id: 'p1', role: 'host', is_active: true,
        user: { id: 'u1', email: 'host@example.com' } },
      { id: 'g1', role: 'guest', is_active: true, is_guest: true,
        user: { id: 'g1', email: 'Rahul Ingnam' } },
    ] as any);
    api.getGuests.mockResolvedValue([
      { id: 'g1', full_name: 'Rahul Ingnam', status: 'admitted' },
    ] as any);

    showRoom();
    await openSide('Chat');

    const faces = await screen.findAllByRole('button', { name: /Rahul Ingnam/ });
    expect(faces).toHaveLength(1);
  });

  it('and never offers the reader themselves', async () => {
    asHost();
    api.getParticipants.mockResolvedValue([
      { id: 'p1', role: 'host', is_active: true,
        user: { id: 'u1', email: 'host@example.com' } },
    ] as any);
    api.getGuests.mockResolvedValue([] as any);

    showRoom();
    await openSide('Chat');

    await screen.findByText('Chats');
    expect(screen.queryByRole('button', { name: /host@example.com/ })).toBeNull();
  });
});

/**
 * What arrived while you were reading something else.
 *
 * A meeting carries on behind whichever panel is open: a question is asked
 * while the files are up, a file is shared while you are in the chat. Each
 * control carries the count of what has piled up behind it, and opening
 * that panel is what clears it - not a timer, and not the next thing to
 * arrive.
 */
describe('the count on a closed panel', () => {
  const asHost = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
  };

  afterEach(() => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: null });
  });

  const barButton = async (name: RegExp) => {
    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    return within(bar).getByRole('button', { name });
  };

  const arrive = (payload: any) => {
    const socket = (window as any).__roomSocket;
    act(() => { socket.onmessage({ data: JSON.stringify(payload) }); });
  };

  const badgeOn = async (name: RegExp, count: string) =>
    waitFor(async () => expect(await barButton(name)).toHaveTextContent(count));

  it('counts a question waiting to be sorted', async () => {
    asHost();
    showRoom();
    await screen.findByRole('navigation', { name: 'Meeting controls' });

    arrive({
      type: 'chat_pending', message_id: 'm1', message: 'Why this budget?',
      user_id: 'g1', user_name: 'Rahul', timestamp: new Date().toISOString(),
    });

    await badgeOn(/Questions/, '1');
  });

  it('adds them up while nobody looks', async () => {
    asHost();
    showRoom();
    await screen.findByRole('navigation', { name: 'Meeting controls' });

    arrive({ type: 'chat_pending', message_id: 'm1', message: 'One',
             user_id: 'g1', user_name: 'Rahul', timestamp: new Date().toISOString() });
    arrive({ type: 'chat_pending', message_id: 'm2', message: 'Two',
             user_id: 'g1', user_name: 'Rahul', timestamp: new Date().toISOString() });

    await badgeOn(/Questions/, '2');
  });

  it('counts a file somebody shared', async () => {
    showRoom();
    await screen.findByRole('navigation', { name: 'Meeting controls' });

    arrive({ type: 'resources_update' });

    await badgeOn(/Resources/, '1');
  });

  it('clears the moment that panel is opened', async () => {
    asHost();
    showRoom();
    await screen.findByRole('navigation', { name: 'Meeting controls' });
    arrive({ type: 'chat_pending', message_id: 'm1', message: 'One',
             user_id: 'g1', user_name: 'Rahul', timestamp: new Date().toISOString() });
    await badgeOn(/Questions/, '1');

    await openSide('Questions');

    expect(await barButton(/Questions/)).not.toHaveTextContent('1');
  });

  it('and does not count what arrives while it is open', async () => {
    asHost();
    showRoom();
    await openSide('Questions');

    arrive({ type: 'chat_pending', message_id: 'm3', message: 'Three',
             user_id: 'g1', user_name: 'Rahul', timestamp: new Date().toISOString() });

    expect(await barButton(/Questions/)).not.toHaveTextContent('1');
  });

  it('keeps each count to its own panel', async () => {
    asHost();
    showRoom();
    await screen.findByRole('navigation', { name: 'Meeting controls' });

    arrive({ type: 'resources_update' });

    await badgeOn(/Resources/, '1');
    expect(await barButton(/Questions/)).not.toHaveTextContent('1');
  });
});

/**
 * Nothing in the room starts the meeting.
 *
 * Putting a talk on stage does that, and it is the same decision. Asking
 * for it twice only made it possible to be half-started: a meeting under
 * way with nobody speaking, and a button that did nothing anybody could
 * see.
 */
describe('starting the meeting', () => {
  const asHost = () => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: { id: 'u1', email: 'host@example.com' } });
  };

  afterEach(() => {
    const { useAuthStore } = require('../../store/authStore');
    useAuthStore.setState({ user: null });
  });

  it('is not something the room offers separately', async () => {
    asHost();
    api.getMeeting.mockResolvedValue({
      ...meeting,
      started_at: null,
      current_session: {
        id: null, title: '', started_at: null, ends_at: null, is_over: false,
        between_sessions: false, awaiting_next: true,
        next_id: 's2', next_title: 'Mehendi',
      },
    } as any);

    showRoom();

    await screen.findByRole('navigation', { name: 'Meeting controls' });
    expect(screen.queryByRole('button', { name: 'Start meeting' })).toBeNull();
    // What is offered instead is the thing that actually opens it.
    expect(screen.getByRole('button', { name: 'Start Mehendi' })).toBeInTheDocument();
  });

  it('happens by putting somebody on stage', async () => {
    asHost();
    api.startSession.mockResolvedValue({} as any);
    api.getMeeting.mockResolvedValue({
      ...meeting,
      started_at: null,
      current_session: {
        id: null, title: '', started_at: null, ends_at: null, is_over: false,
        between_sessions: false, awaiting_next: true,
        next_id: 's2', next_title: 'Mehendi',
      },
    } as any);

    showRoom();
    fireEvent.click(await screen.findByRole('button', { name: 'Start Mehendi' }));

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith('s2'));
    expect(api.startMeeting).not.toHaveBeenCalled();
  });
});

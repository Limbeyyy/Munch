import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    onmessage: any; onopen: any; onerror: any; onclose: any;
    readyState = 0;
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

  it('keeps the people in the room reachable, which the mock hides', async () => {
    // The design ships the icon but hides the control; losing the roster
    // and its role picker would lose the host real work.
    showRoom();

    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    fireEvent.click(within(bar).getByRole('button', { name: /Participants/ }));

    expect(await screen.findByRole('dialog', { name: 'Participants' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Question' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggestion' })).toBeInTheDocument();
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
    // Participants and sharing open over the room; only three things sit
    // beside it.
    showRoom();

    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    fireEvent.click(within(bar).getByRole('button', { name: /Participants/ }));

    expect(await screen.findByRole('dialog', { name: 'Participants' })).toBeInTheDocument();
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
 * There is no public thread on either side of it any more: what people
 * have to say goes to the host or to the speaker, and the host decides
 * what to do with it - which is the moderation queue that was already
 * there. A message with nobody to receive it cannot be sent.
 */
describe('the room chat', () => {
  const openChat = async () => {
    await openSide('Chat');
    return screen.findByPlaceholderText(/Pick someone above first|Write your message here/);
  };

  it('has no room-wide thread to write into', async () => {
    showRoom();
    await openChat();

    expect(screen.queryByRole('tab', { name: /Room/ })).toBeNull();
    expect(screen.queryByText(/Everyone in the meeting can see these/)).toBeNull();
  });

  it('asks who the message is for, and will not send until it knows', async () => {
    api.getChatSettings.mockResolvedValue(
      { chat_enabled: true, direct_messages_enabled: true } as any
    );
    api.getParticipants.mockResolvedValue([
      { id: 'p1', role: 'presenter', is_active: true,
        user: { id: 'u5', email: 'speaker@example.com' } },
    ] as any);

    showRoom();
    const box = await openChat();

    expect(box).toHaveAttribute('placeholder', 'Pick someone above first');
    fireEvent.change(box, { target: { value: 'A question' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    fireEvent.change(await screen.findByLabelText('Who to write to'), {
      target: { value: 'u5' },
    });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
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

  it('offers the session and the meeting, and neither by accident', async () => {
    await openIt();

    expect(await screen.findByRole('button', { name: /End the session/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /End the meeting/ })).toBeInTheDocument();
    // Stepping out is still there: the host has to be able to leave.
    expect(screen.getByRole('button', { name: /Just leave/ })).toBeInTheDocument();
  });

  it('ends only the session, and stays in the room', async () => {
    api.endSession.mockResolvedValue({} as any);
    await openIt();

    fireEvent.click(await screen.findByRole('button', { name: /End the session/ }));

    await waitFor(() => expect(api.endSession).toHaveBeenCalledWith('s1'));
    expect(api.endMeeting).not.toHaveBeenCalled();
    // Still the room, not the page it navigates to on the way out.
    expect(
      await screen.findByRole('navigation', { name: 'Meeting controls' })
    ).toBeInTheDocument();
  });

  it('offers nothing to end when nothing is on stage', async () => {
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
    expect(screen.queryByRole('button', { name: /End the session/ })).toBeNull();
  });
});

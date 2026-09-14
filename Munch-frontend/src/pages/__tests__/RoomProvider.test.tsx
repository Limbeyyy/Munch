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
    close() {}
    send() {}
  };
  api.getMeeting.mockResolvedValue(meeting as any);
  api.getChatSettings.mockResolvedValue(
    { chat_enabled: true, direct_messages_enabled: true } as any
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

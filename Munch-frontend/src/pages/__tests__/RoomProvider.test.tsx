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
      // The section that reads the context is drawn once the meeting has
      // arrived, so the failure would come after that first paint.
      await waitFor(() => expect(api.getPhotos).toHaveBeenCalled());
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

    expect(await screen.findByText('Photos')).toBeInTheDocument();
  });
});

describe('the room as the design lays it out', () => {
  it('puts the running order, the stage and the side panels on one screen', async () => {
    showRoom();

    // By heading: the bar along the foot names some of these too.
    expect(
      await screen.findByRole('heading', { name: 'Agenda Summary' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live Transcript' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Resources \(/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
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

    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    fireEvent.click(within(bar).getByRole('button', { name: /Questions/ }));

    expect(await screen.findByRole('dialog', { name: 'Questions' })).toBeInTheDocument();
  });

  it('opens sharing from the share control', async () => {
    showRoom();

    const bar = await screen.findByRole('navigation', { name: 'Meeting controls' });
    fireEvent.click(within(bar).getByRole('button', { name: /Share/ }));

    expect(
      await screen.findByRole('dialog', { name: 'Share this meeting' })
    ).toBeInTheDocument();
  });

  it('has no browser chrome pretending to be part of the app', async () => {
    // The mock was drawn inside a Safari window; the toolbar and its
    // traffic lights are the picture frame, not the room.
    showRoom();

    await screen.findByText('Agenda Summary');
    expect(screen.queryByText('zenwork.com')).not.toBeInTheDocument();
  });
});

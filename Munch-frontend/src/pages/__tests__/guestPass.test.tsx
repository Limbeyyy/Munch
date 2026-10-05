import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GuestWaitingPage } from '../GuestWaitingPage';
import { GuestEventPage } from '../GuestEventPage';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    guestStatus: jest.fn(),
    guestLeave: jest.fn(),
    guestChat: jest.fn(),
    guestPresenters: jest.fn(),
    guestResources: jest.fn(),
    getGuestSegments: jest.fn(),
    getHub: jest.fn(),
    getSchedulingPrefs: jest.fn(),
    hasSession: () => false,
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn(),
  }),
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

beforeEach(() => {
  window.sessionStorage.clear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: jest.fn(),
  });
  api.guestLeave.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile',
  });
  window.sessionStorage.setItem('guest_token', 'a-pass-for-a-event-that-ended');
  window.sessionStorage.setItem('guest_event_code', 'RY0-SDV');
  window.sessionStorage.setItem('guest_name', 'Rahul Ingnam');
  api.guestChat.mockResolvedValue({ settings: {}, messages: [] } as any);
  api.guestPresenters.mockResolvedValue([]);
  api.guestResources.mockResolvedValue([]);
  api.getGuestSegments.mockResolvedValue([]);
  api.getHub.mockResolvedValue({
    questions: [], ideas: [], suggestions: [],
  } as any);
  api.getSchedulingPrefs.mockResolvedValue({ session_gap_minutes: 0 } as any);
  (window as any).WebSocket = class {
    onmessage: any; onopen: any; onerror: any; onclose: any;
    static OPEN = 1;
    readyState = 1;
    close() {}
    send() {}
  };
});

const show = () =>
  render(
    <MemoryRouter initialEntries={['/guest/waiting']}>
      <Routes>
        <Route path="/guest/waiting" element={<GuestWaitingPage />} />
        <Route path="/login" element={<p>the door</p>} />
      </Routes>
    </MemoryRouter>
  );

const showEvent = () =>
  render(
    <MemoryRouter initialEntries={['/guest/event']}>
      <Routes>
        <Route path="/guest/event" element={<GuestEventPage />} />
        <Route path="/login" element={<p>the door</p>} />
      </Routes>
    </MemoryRouter>
  );

/**
 * A pass that no longer names anybody.
 *
 * A guest's pass belongs to one event and lasts as long as it does: when
 * the event ends everybody in it is forgotten, and the pass stops
 * resolving. A browser still holding one sat on this screen retrying a
 * socket that would never open, saying nothing at all - which is how a
 * guest ends up staring at a page that is never going to change.
 */
describe('a guest pass that has stopped meaning anything', () => {
  const dead = Object.assign(new Error('gone'), { response: { status: 401 } });

  it('sends them back to the door rather than waiting for ever', async () => {
    api.guestStatus.mockRejectedValue(dead);

    show();

    expect(await screen.findByText('the door')).toBeInTheDocument();
  });

  it('and does not leave the dead pass lying in the browser', async () => {
    api.guestStatus.mockRejectedValue(dead);

    show();

    await screen.findByText('the door');
    expect(window.sessionStorage.getItem('guest_token')).toBeNull();
  });

  it('but keeps waiting through an ordinary dropped poll', async () => {
    // A network blip is not a decision, and not a reason to throw somebody
    // out of the queue they are standing in.
    api.guestStatus.mockRejectedValue(new Error('offline'));

    show();

    await waitFor(() => expect(api.guestStatus).toHaveBeenCalled());
    expect(screen.queryByText('the door')).toBeNull();
    expect(window.sessionStorage.getItem('guest_token')).not.toBeNull();
  });

  it('and stays put while the host is simply slow to answer', async () => {
    api.guestStatus.mockResolvedValue({ guest: { status: 'pending' } } as any);

    show();

    await waitFor(() => expect(api.guestStatus).toHaveBeenCalled());
    expect(screen.queryByText('the door')).toBeNull();
  });

  it('allows desktop guests to wait for host approval without releasing their pass', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0',
    });
    api.guestStatus.mockResolvedValue({
      guest: { status: 'pending' },
    } as any);

    show();

    expect(await screen.findByText('The host can see your name, and will admit you shortly.'))
      .toBeInTheDocument();
    expect(api.guestLeave).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('guest_token')).toBe(
      'a-pass-for-a-event-that-ended'
    );
  });

  it('allows desktop guests into the admitted guest room', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0',
    });
    api.guestStatus.mockResolvedValue({
      guest: { status: 'admitted' },
      event: {
        id: 'event-1',
        code: 'RY0-SDV',
        title: 'Guest test event',
        status: 'active',
        scheduled_start: '2026-10-05T00:00:00Z',
        scheduled_end: '2026-10-05T01:00:00Z',
        sessions: [],
      },
    } as any);

    showEvent();

    expect((await screen.findAllByRole('button', { name: 'Leave' })).length)
      .toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Transcript' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Q&A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull();
    await waitFor(() => expect(api.getGuestSegments).toHaveBeenCalledWith(
      'RY0-SDV',
      'a-pass-for-a-event-that-ended'
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Q&A' }));
    await waitFor(() => expect(api.getHub).toHaveBeenCalledWith(
      'RY0-SDV',
      'a-pass-for-a-event-that-ended'
    ));
    expect(api.guestLeave).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('guest_token')).toBe(
      'a-pass-for-a-event-that-ended'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(await screen.findByText('the door')).toBeInTheDocument();
    await waitFor(() => expect(api.guestLeave).toHaveBeenCalledWith(
      'a-pass-for-a-event-that-ended'
    ));
    expect(window.sessionStorage.getItem('guest_token')).toBe(
      'a-pass-for-a-event-that-ended'
    );
  });
});

/**
 * Where somebody is, against whether they are allowed to be there.
 *
 * `left` is written when the page closes and by the sweep that lets go
 * of a tab nobody is looking at. The room read it as the host taking
 * the admission back, so a guest who stepped out and came in again was
 * told they were no longer in the event and put out - which also marked
 * them as having left, so doing it again did the same thing.
 */
describe('a guest the room has recorded as away', () => {
  const inTheRoom = (guestStatus: string) => {
    api.guestStatus.mockResolvedValue({
      guest: { status: guestStatus },
      event: {
        id: 'event-1', code: 'RY0-SDV', title: 'Guest test event',
        status: 'active',
        scheduled_start: '2026-10-05T00:00:00Z',
        scheduled_end: '2026-10-05T01:00:00Z',
        sessions: [],
      },
    } as any);
  };

  const settle = async () => {
    await waitFor(() => expect(api.guestStatus).toHaveBeenCalled());
    // The eviction check runs on the status poll, not on first paint.
    await new Promise((done) => setTimeout(done, 0));
  };

  it('is not turned out of a room it is plainly still in', async () => {
    inTheRoom('left');

    showEvent();
    await settle();

    expect(screen.queryByText('the door')).not.toBeInTheDocument();
    expect(api.guestLeave).not.toHaveBeenCalled();
  });

  it('still reads the room while it is marked away', async () => {
    inTheRoom('left');

    showEvent();

    await waitFor(() => expect(api.getGuestSegments).toHaveBeenCalledWith(
      'RY0-SDV', 'a-pass-for-a-event-that-ended'
    ));
  });

  /**
   * The host not having answered yet, or having said no, is a
   * different thing entirely - and the poll that notices runs on its
   * own clock, so the clock is wound on rather than waited out.
   */
  const evictedOn = async (guestStatus: string) => {
    jest.useFakeTimers();
    try {
      inTheRoom(guestStatus);
      showEvent();
      await act(async () => { jest.advanceTimersByTime(16000); });
    } finally {
      jest.useRealTimers();
    }
    return screen.queryByText('the door');
  };

  it('but one still waiting on the host is sent back to the door', async () => {
    expect(await evictedOn('pending')).toBeInTheDocument();
  });

  it('and so is one the host turned away', async () => {
    expect(await evictedOn('denied')).toBeInTheDocument();
  });

  /** The same wound-on clock leaves somebody merely away where they are. */
  it('while the clock running on does not disturb one marked away', async () => {
    expect(await evictedOn('left')).not.toBeInTheDocument();
  });
});

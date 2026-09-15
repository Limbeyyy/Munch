import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GuestWaitingPage } from '../GuestWaitingPage';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    guestStatus: jest.fn(),
    guestLeave: jest.fn(),
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
  window.sessionStorage.setItem('guest_token', 'a-pass-for-a-meeting-that-ended');
  window.sessionStorage.setItem('guest_meeting_code', 'RY0-SDV');
  window.sessionStorage.setItem('guest_name', 'Rahul Ingnam');
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

/**
 * A pass that no longer names anybody.
 *
 * A guest's pass belongs to one meeting and lasts as long as it does: when
 * the meeting ends everybody in it is forgotten, and the pass stops
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
});

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OrganizerPage } from '../OrganizerPage';
import { apiClient } from '../../services/api';

/**
 * Where a refresh lands.
 *
 * Reloading mid-morning used to put the host on the programme, which is
 * where a day is built rather than run.
 */
jest.mock('../../services/api', () => {
  const made = new Map<string, jest.Mock>();
  return {
    apiClient: new Proxy({} as any, {
      get: (_target, name: string) => {
        if (name === 'hasSession') return () => false;
        if (!made.has(name)) made.set(name, jest.fn());
        const fn = made.get(name)!;
        // This project resets implementations between tests, so the
        // harmless default is re-applied on access.
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
  Toaster: () => null,
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
  participant_count: 1,
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  (window as any).WebSocket = class {
    onmessage: any; onopen: any; onerror: any; onclose: any;
    readyState = 0;
    close() {}
    send() {}
  };
  api.listMeetings.mockResolvedValue([meeting]);
  api.getReminders.mockResolvedValue({
    reminders: [], unread: 0, meeting_lead_minutes: 60, session_lead_minutes: 15,
  } as any);
  api.listSessions.mockResolvedValue([] as any);
});

const showOrganizer = () =>
  render(
    <MemoryRouter initialEntries={['/organizer']}>
      <OrganizerPage />
    </MemoryRouter>
  );

describe('opening the organizer', () => {
  it('lands on the live desk', async () => {
    showOrganizer();

    await waitFor(() => expect(api.listMeetings).toHaveBeenCalled());
    expect(
      await screen.findByRole('heading', { name: 'Live control' })
    ).toBeInTheDocument();
  });

  it('marks the desk as the section being read', async () => {
    showOrganizer();

    const desk = await screen.findByRole('button', { name: /Live control/ });
    expect(desk).toHaveAttribute('aria-current', 'true');
  });

  it('does not land on the programme', async () => {
    showOrganizer();

    await screen.findByRole('heading', { name: 'Live control' });
    expect(screen.queryByRole('heading', { name: 'Programme' })).not.toBeInTheDocument();
  });

  it('says plainly when there is nothing to run', async () => {
    // A host with an empty programme still lands here, so it has to read
    // sensibly rather than looking broken.
    api.listMeetings.mockResolvedValue([] as any);

    showOrganizer();

    expect(await screen.findByText(/Nothing is scheduled/)).toBeInTheDocument();
  });
});

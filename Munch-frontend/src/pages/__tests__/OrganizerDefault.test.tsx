import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OrganizerPage } from '../OrganizerPage';
import { apiClient } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

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

const event = {
  id: 'm1',
  code: 'ABC123',
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
  api.listEvents.mockResolvedValue([event]);
  api.getReminders.mockResolvedValue({
    reminders: [], unread: 0, event_lead_minutes: 60, session_lead_minutes: 15,
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

    await waitFor(() => expect(api.listEvents).toHaveBeenCalled());
    expect(
      await screen.findByRole('heading', { name: 'Live Dashboard' })
    ).toBeInTheDocument();
  });

  it('marks the desk as the section being read', async () => {
    showOrganizer();

    const desk = await screen.findByRole('button', { name: /Live control/ });
    expect(desk).toHaveAttribute('aria-current', 'true');
  });

  it('does not land on the programme', async () => {
    showOrganizer();

    await screen.findByRole('heading', { name: 'Live Dashboard' });
    expect(screen.queryByRole('heading', { name: 'Programme' })).not.toBeInTheDocument();
  });

  it('says plainly when there is nothing to run', async () => {
    // A host with an empty programme still lands here, so it has to read
    // sensibly rather than looking broken.
    api.listEvents.mockResolvedValue([] as any);

    showOrganizer();

    expect(await screen.findByText(/Nothing is scheduled/)).toBeInTheDocument();
  });

  /**
   * These events feed every section of the panel - the live desk, the
   * files, moderation, attendance, the speakers - so asking the broad
   * question here put somebody else's event into all of them at once.
   */
  it('asks only for the events this person runs', async () => {
    showOrganizer();

    await waitFor(() => expect(api.listEvents).toHaveBeenCalledWith('host'));
  });

  /**
   * The bar carries three controls and no event name. The name was a
   * chip saying which event the panel was pointed at, which the
   * breadcrumb and the page itself already say.
   */
  it('offers a way out as an icon, not a word', async () => {
    showOrganizer();
    await waitFor(() => expect(api.listEvents).toHaveBeenCalled());

    const out = screen.getByRole('button', { name: 'Logout' });
    expect(out.querySelector('img')).not.toBeNull();
    expect(out).not.toHaveTextContent('Logout');
  });

  it('and it still signs out', async () => {
    const bye = jest.fn();
    useAuthStore.setState({ logout: bye } as any);
    showOrganizer();
    await waitFor(() => expect(api.listEvents).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    expect(bye).toHaveBeenCalled();
  });

  it('puts notifications between accessibility and the way out', async () => {
    showOrganizer();
    await waitFor(() => expect(api.listEvents).toHaveBeenCalled());

    const bar = screen.getByRole('button', { name: 'Logout' })
      .parentElement as HTMLElement;
    const order = Array.from(bar.querySelectorAll('button'))
      .map((b) => b.getAttribute('title'));

    expect(order.slice(-3)).toEqual([
      'Accessibility and appearance', 'Notifications', 'Logout',
    ]);
  });

  it('draws notifications with the same line icon treatment as the other controls', async () => {
    showOrganizer();
    await waitFor(() => expect(api.listEvents).toHaveBeenCalled());

    const bar = screen.getByRole('button', { name: 'Logout' })
      .parentElement as HTMLElement;
    const bell = within(bar).getByRole('button', { name: 'Notifications' });

    expect(bell.querySelector('svg')).toHaveAttribute('stroke', 'currentColor');
  });

  it('opens the notifications page when the bell is pressed', async () => {
    showOrganizer();
    await waitFor(() => expect(api.listEvents).toHaveBeenCalled());

    // The rail carries one of these too; this is the bar's.
    const bar = screen.getByRole('button', { name: 'Logout' })
      .parentElement as HTMLElement;
    fireEvent.click(within(bar).getByRole('button', { name: 'Notifications' }));

    expect(
      await screen.findByRole('heading', { name: /Notifications/ })
    ).toBeInTheDocument();
    const bell = within(bar).getByRole('button', { name: 'Notifications' });
    expect(bell).toHaveAttribute('aria-current', 'page');
    expect(bell).toHaveClass('bg-black/[.04]', 'text-navy-800');
    expect(bell).not.toHaveClass('bg-navy-800');
  });

  it('no longer names the event in the bar', async () => {
    showOrganizer();
    await waitFor(() => expect(api.listEvents).toHaveBeenCalled());

    const bar = screen.getByRole('navigation', { name: 'Breadcrumb' })
      .parentElement as HTMLElement;
    expect(bar).not.toHaveTextContent('Test day');
  });
});

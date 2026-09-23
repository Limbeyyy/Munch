import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { EventsView } from '../views/EventsView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    listEvents: jest.fn(),
    getProgrammeRoles: jest.fn(),
    getEventInvites: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const event = (over: any = {}) => ({
  id: 'mine', code: 'ABC', title: 'Mine', description: '', venue: '',
  status: 'scheduled', event_date: '2026-09-18',
  scheduled_start: '2026-09-18T09:30:00', scheduled_end: '2026-09-18T10:30:00',
  participant_count: 0, sessions: [], session_count: 0,
  host: { id: 'u1', email: 'me@example.com' },
  created_at: '', updated_at: '',
  ...over,
}) as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  const { useAuthStore } = require('../../store/authStore');
  useAuthStore.setState({ user: { id: 'u1', email: 'me@example.com' } });
  api.getProgrammeRoles.mockResolvedValue({ granted: [], speakers: [] } as any);
  api.getEventInvites.mockResolvedValue({
    added: 0, invited: [], total_invited: 3, total_joined: 0,
  } as any);
});

const show = (events: any[]) => {
  api.listEvents.mockResolvedValue(events as any);
  render(
    <OrganizerProvider>
      <EventsView onOpenRoom={jest.fn()} onChanged={jest.fn()} />
    </OrganizerProvider>
  );
};

/**
 * The two numbers a card shows that the list itself does not carry.
 *
 * Both are the host's to read. The list is wider than that - somebody
 * speaking at an event, or helping run it, sees it here too - so asking
 * for every event meant two refusals per event belonging to somebody
 * else. They were caught and the card carried on, so nothing looked
 * wrong; the cost was two round trips that could not succeed and a
 * server log of forbidden requests to read past.
 */
describe('the counts on an event card', () => {
  it('are asked for an event this person hosts', async () => {
    show([event()]);

    await waitFor(() => expect(api.getEventInvites).toHaveBeenCalledWith('mine'));
    expect(api.getProgrammeRoles).toHaveBeenCalledWith('mine');
  });

  /** The card is still listed; only the two host-only reads are skipped. */
  it('leave the event itself on the page', async () => {
    show([event({
      id: 'theirs', title: 'Theirs',
      host: { id: 'u2', email: 'them@example.com' },
    })]);

    expect(await screen.findByText('Theirs')).toBeInTheDocument();
  });

  /**
   * Asserted against a mixed list rather than a foreign event on its
   * own. With nothing to fetch there is no moment to wait for, so the
   * assertion runs before the effect and passes whatever the code does.
   * Waiting for the one call that should happen pins the one that
   * should not.
   */
  it('are not asked for one belonging to somebody else', async () => {
    show([
      event(),
      event({ id: 'theirs', title: 'Theirs', host: { id: 'u2', email: 'x@y.z' } }),
    ]);

    await waitFor(() => expect(api.getEventInvites).toHaveBeenCalledTimes(1));
    expect(api.getEventInvites).toHaveBeenCalledWith('mine');
    expect(api.getProgrammeRoles).toHaveBeenCalledTimes(1);
    expect(api.getProgrammeRoles).toHaveBeenCalledWith('mine');
  });
});

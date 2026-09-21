import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { PeopleView } from '../views/PeopleView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    listEvents: jest.fn(),
    getParticipants: jest.fn(),
    getAttendance: jest.fn(),
    getProgrammeRoles: jest.fn(),
    listContactRequests: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const event = {
  id: 'm1', title: 'Wedding Preparation', code: 'IRL-NH7', status: 'ended',
  event_date: '2026-09-08', venue: '',
  scheduled_start: '2026-09-08T03:30:00Z', scheduled_end: '2026-09-08T09:00:00Z',
  sessions: [],
} as any;

/** A signed-in attendee, as the roster reports one. */
const person = (over: any = {}) => ({
  id: 'p1',
  user: { id: 'u1', email: 'sabina@example.org', first_name: 'Sabina', last_name: 'Rai' },
  role: 'attendee',
  session_id: '',
  joined_at: '2026-09-08T04:00:00Z',
  is_active: false,
  is_muted: false,
  is_video_on: false,
  is_screen_sharing: false,
  is_guest: false,
  ...over,
});

const show = () =>
  render(
    <OrganizerProvider>
      <PeopleView events={[event]} currentUserId="host-1" />
    </OrganizerProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.listEvents.mockResolvedValue([event]);
  api.getParticipants.mockResolvedValue([]);
  api.getAttendance.mockResolvedValue(null as any);
  api.getProgrammeRoles.mockResolvedValue({ granted: [] } as any);
  api.listContactRequests.mockResolvedValue([] as any);
});

/**
 * What the page offers.
 *
 * Team and Roles were two more ways of listing people who are listed on
 * an event's own People tab, so the page is the speakers it is named
 * after, and the requests to reach them.
 */
describe('the speakers and team page', () => {
  it('offers the speakers and the contact requests', async () => {
    show();

    expect(await screen.findByRole('tab', { name: /Speakers/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Contact requests/ })).toBeInTheDocument();
  });

  it('offers no team roster and no role grants', async () => {
    show();
    await screen.findByRole('tab', { name: /Speakers/ });

    expect(screen.queryByRole('tab', { name: /Team/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Roles/ })).toBeNull();
  });

  /** Nothing reads the roster now, so nothing should go asking for it. */
  it('does not go asking for a roster it no longer shows', async () => {
    show();
    await screen.findByRole('tab', { name: /Speakers/ });

    expect(api.getParticipants).not.toHaveBeenCalled();
  });
});

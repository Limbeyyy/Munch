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

const meeting = {
  id: 'm1', title: 'Wedding Preparation', meeting_code: 'IRL-NH7', status: 'ended',
  scheduled_start: '2026-09-08T03:30:00Z', scheduled_end: '2026-09-08T09:00:00Z',
  sessions: [],
} as any;

const event = {
  id: 'e1', title: 'Kalika Wedding Events', event_date: '2026-09-08',
  venue: '', status: 'done', meetings: [meeting],
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

/**
 * A guest, as the roster projects one: no account, and a role of their
 * own. This is the row that took the page down.
 */
const guest = (over: any = {}) => person({
  id: 'g1',
  user: { id: 'g1', email: 'Bishnu Prasad', first_name: 'Bishnu Prasad', last_name: '' },
  role: 'guest',
  is_guest: true,
  ...over,
});

const show = () =>
  render(
    <OrganizerProvider>
      <PeopleView meetings={[meeting]} currentUserId="host-1" />
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

const openTeam = async () => {
  show();
  fireEvent.click(await screen.findByRole('tab', { name: /Team/ }));
};

describe('a guest in the roster', () => {
  it('is named rather than taking the page down', async () => {
    // The roster projects guests into the same shape with a role of their
    // own. The label list did not know that role, and an unnamed label is
    // not a bad string - it is a crash.
    api.getParticipants.mockResolvedValue([guest()] as any);

    await openTeam();

    expect(await screen.findByText('Bishnu Prasad')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
  });

  it('is not offered a role to be changed to', async () => {
    // There is no account to give a role to.
    api.getParticipants.mockResolvedValue([guest()] as any);

    await openTeam();

    await screen.findByText('Bishnu Prasad');
    expect(screen.getByText('A guest holds no role')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('sits beside the people who do hold roles', async () => {
    api.getParticipants.mockResolvedValue([person(), guest()] as any);

    await openTeam();

    // Scoped to each row: "Attendee" is also one of the options in the
    // role picker on the row beside it.
    const attendeeRow = (await screen.findByText('Sabina Rai')).closest('tr')!;
    const guestRow = screen.getByText('Bishnu Prasad').closest('tr')!;

    expect(attendeeRow).toHaveTextContent('Attendee');
    expect(guestRow).toHaveTextContent('Guest');
    expect(guestRow).toHaveTextContent('A guest holds no role');
  });

  it('does not crash on a role nobody has heard of either', async () => {
    // Whatever the server adds next, the page should read oddly rather
    // than disappear.
    api.getParticipants.mockResolvedValue([
      guest({ role: 'stenographer', is_guest: false, id: 'x1' }),
    ] as any);

    await openTeam();

    expect(await screen.findByText('stenographer')).toBeInTheDocument();
  });

  it('still asks for everyone who was there, not just who is', async () => {
    // A finished meeting has an empty room; its team is not empty.
    await openTeam();

    await waitFor(() => expect(api.getParticipants).toHaveBeenCalled());
    expect(api.getParticipants).toHaveBeenCalledWith('m1', true);
  });
});

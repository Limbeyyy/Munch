import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { AttendanceView } from '../views/AttendanceView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    listEvents: jest.fn(),
    getAttendance: jest.fn(),
    getSessionAttendance: jest.fn(),
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

const event = (over: any = {}) => ({
  id: 'e1',
  code: 'ABC-123',
  title: 'Disaster Management Review',
  description: '',
  status: 'ended',
  started_at: '2026-09-05T09:00:00Z',
  venue: 'City Hall, Room 201',
  event_date: '2026-09-05',
  scheduled_start: '2026-09-05T09:00:00Z',
  scheduled_end: '2026-09-05T12:00:00Z',
  participant_count: 0,
  sessions: [],
  session_count: 0,
  created_at: '', updated_at: '',
  ...over,
});

const report = (over: any = {}) => ({
  expected_from_invites: 4,
  expected_total: 10,
  absent_count: 2,
  walked_in_uninvited: 0,
  session_attendance_total: 8,
  sessions: [],
  attended_count: 9,
  active_count: 0,
  inactive_count: 8,
  invited_who_attended: 8,
  invited_who_did_not: 2,
  guests_admitted: 5,
  attended: [],
  did_not_attend: [],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.listEvents.mockResolvedValue([event()] as any);
  api.getAttendance.mockResolvedValue(report() as any);
  api.getSessionAttendance.mockResolvedValue([] as any);
});

const show = () =>
  render(
    <OrganizerProvider>
      <AttendanceView events={[]} />
    </OrganizerProvider>
  );

/**
 * Attendance, as a card per event.
 *
 * It used to open on one event's roll with a dropdown to change which,
 * which meant the question every host actually arrives with - how did
 * the events go - was answered one event at a time.
 */
describe('the attendance grid', () => {
  it('gives each event a card with how it went', async () => {
    show();

    expect(await screen.findByText('Disaster Management Review')).toBeInTheDocument();
    expect(screen.getByText('City Hall, Room 201', { exact: false })).toBeInTheDocument();
  });

  /**
   * Everybody the day counted, and the two ways they got there: an
   * invitation, or the door.
   */
  it('counts the total, the invited and the guests', async () => {
    show();
    await screen.findByText('Disaster Management Review');

    // The figures land a tick after the card, once the report is back.
    await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Invited')).toBeInTheDocument();
    expect(screen.getByText('Guests')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('reads the share who came against the total, not the invitations', async () => {
    show();
    await screen.findByText('Disaster Management Review');

    // Nine of the ten counted, though only four were invited.
    await waitFor(() => expect(screen.getByText('90%')).toBeInTheDocument());
  });

  /** The old reading, which said nothing about anyone who walked in. */
  it('no longer counts attended and no-show', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Total')).toBeInTheDocument());

    expect(screen.queryByText('Attended')).toBeNull();
    expect(screen.queryByText('No-show')).toBeNull();
  });

  it('says how the event stands', async () => {
    show();

    expect(await screen.findByText('Finished')).toBeInTheDocument();
  });

  it('narrows the grid to what is searched for', async () => {
    api.listEvents.mockResolvedValue([
      event(), event({ id: 'e2', title: 'Budget Hearing' }),
    ] as any);
    show();
    await screen.findByText('Budget Hearing');

    fireEvent.change(screen.getByLabelText('Search events'), {
      target: { value: 'budget' },
    });

    expect(screen.getByText('Budget Hearing')).toBeInTheDocument();
    expect(screen.queryByText('Disaster Management Review')).toBeNull();
  });

  it('narrows it by how the event stands', async () => {
    api.listEvents.mockResolvedValue([
      event(),
      event({
        id: 'e2', title: 'Budget Hearing', status: 'scheduled', started_at: null,
        scheduled_start: '2099-01-01T09:00:00Z', scheduled_end: '2099-01-01T12:00:00Z',
      }),
    ] as any);
    show();
    await screen.findByText('Budget Hearing');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'upcoming' } });

    expect(screen.getByText('Budget Hearing')).toBeInTheDocument();
    expect(screen.queryByText('Disaster Management Review')).toBeNull();
  });

  it('turns the order round when asked', async () => {
    api.listEvents.mockResolvedValue([
      event(),
      event({
        id: 'e2', title: 'Budget Hearing',
        scheduled_start: '2026-10-05T09:00:00Z', scheduled_end: '2026-10-05T12:00:00Z',
      }),
    ] as any);
    show();
    await screen.findByText('Budget Hearing');

    const newest = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'oldest' } });
    const oldest = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

    expect(oldest).toEqual([...newest].reverse());
  });

  it('says so plainly when nothing matches', async () => {
    show();
    await screen.findByText('Disaster Management Review');

    fireEvent.change(screen.getByLabelText('Search events'), {
      target: { value: 'nothing like this' },
    });

    expect(screen.getByText('No events matched.')).toBeInTheDocument();
  });
});

/**
 * One event's attendance, on one screen.
 *
 * It used to be three tabs over a strip of totals - by session, by
 * event, by person - which is three ways of reading one register, and a
 * reader had to try each to find the one they wanted.
 */
describe('opening one event from the grid', () => {
  const open = async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'View attendance' }));
    return screen.findByRole('heading', { level: 1, name: 'Attendance' });
  };

  /** The name is the thing being read; the day and the room sit under it. */
  it('names the event on a line of its own, above when and where', async () => {
    await open();

    const name = screen.getAllByText('Disaster Management Review').at(-1)!;
    expect(name.className).toMatch(/font-semibold/);
    expect(name.textContent).toBe('Disaster Management Review');
    expect(
      screen.getByText(/City Hall, Room 201/)
    ).toBeInTheDocument();
  });

  /**
   * The register is the whole of the screen. The bars said what a column
   * of the table says, and the notes around it explained a table that
   * reads itself.
   */
  it('is the register and nothing around it', async () => {
    await open();
    // Wait for the register itself, or the absences below pass by simply
    // being asked before anything has rendered.
    await screen.findByText('Nobody attended this event.');

    expect(screen.queryByRole('heading', { name: 'Sessions' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Who came' })).toBeNull();
    expect(screen.queryByLabelText('Search a name')).toBeNull();
    expect(screen.queryByText(/Click a row/)).toBeNull();
    expect(screen.queryByText(/counts as having attended/)).toBeNull();
  });

  it('offers no tabs to read the same register three ways', async () => {
    await open();

    expect(screen.queryByRole('tab', { name: 'By session' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'By event' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'By person' })).toBeNull();
  });

  /** The figures are on the card that opened this; twice is once too many. */
  it('does not repeat the figures the card already gave', async () => {
    await open();

    expect(screen.queryByText('In the room now')).toBeNull();
    expect(screen.queryByText('Came')).toBeNull();
  });

  it('keeps the export where the heading is', async () => {
    await open();

    expect(
      screen.getByRole('button', { name: 'Export to Sheets' })
    ).toBeInTheDocument();
  });

  /** A card exports its own event, so the grid needs no export of its own. */
  it('leaves the grid without one of its own', async () => {
    show();
    await screen.findByText('Disaster Management Review');

    expect(screen.queryByRole('button', { name: 'Export to Sheets' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('leaves the grid behind, and a way back to it', async () => {
    await open();

    expect(screen.queryByLabelText('Search events')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Attendance/ }));

    expect(await screen.findByLabelText('Search events')).toBeInTheDocument();
  });

  /** One chooser, not two: the grid is where an event is picked. */
  it('offers no second dropdown of events', async () => {
    await open();

    expect(screen.queryByLabelText('Which event')).toBeNull();
  });
});

/**
 * The register fills as the day runs.
 *
 * A session's own register is written when that session ends, so during
 * an event there were no rows at all - and the table came out empty
 * while the card beside it said 40% had come. The report knows who is in
 * the room now; the session rows say which parts they sat through.
 */
describe('attendance while the event is still running', () => {
  const live = () => event({
    id: 'e1', status: 'active', started_at: new Date().toISOString(),
    sessions: [{
      id: 's1', title: 'Opening', starts_at: new Date().toISOString(),
      duration_minutes: 30, status: 'live',
    }],
  });

  const openLive = async () => {
    api.listEvents.mockResolvedValue([live()] as any);
    api.getAttendance.mockResolvedValue(report({
      attended: [
        { type: 'user', name: 'Sarah Sharma', email: 'sarah@example.com',
          phone: null, role: 'host', joined_at: '', left_at: null,
          is_active: true, was_invited: true },
        { type: 'guest', name: 'Rahul Ingnam', email: null, phone: null,
          role: 'guest', joined_at: '', left_at: null,
          is_active: true, was_invited: false },
      ],
    }) as any);
    // Nothing has closed, so no session has a register yet.
    api.getSessionAttendance.mockResolvedValue([] as any);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'View attendance' }));
    return screen.findByRole('heading', { level: 1, name: 'Attendance' });
  };

  it('names who is in the room, before any session has closed', async () => {
    await openLive();

    expect(await screen.findByText('Sarah Sharma')).toBeInTheDocument();
    expect(screen.getByText('Rahul Ingnam')).toBeInTheDocument();
  });

  it('counts a guest as a guest', async () => {
    await openLive();
    await screen.findByText('Rahul Ingnam');

    expect(screen.getAllByText('Guest').length).toBeGreaterThan(0);
  });

  /** Nothing has closed, so nobody has sat through anything yet. */
  it('says none of the sessions are sat through yet', async () => {
    await openLive();
    await screen.findByText('Sarah Sharma');

    expect(screen.getAllByText('0/1').length).toBe(2);
  });
});

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
  expected_from_invites: 10,
  expected_total: 10,
  absent_count: 2,
  walked_in_uninvited: 0,
  session_attendance_total: 8,
  sessions: [],
  attended_count: 8,
  active_count: 0,
  inactive_count: 8,
  invited_who_attended: 8,
  invited_who_did_not: 2,
  guests_admitted: 0,
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

  it('counts the invited, the ones who came, and the ones who did not', async () => {
    show();
    await screen.findByText('Disaster Management Review');

    // The figures land a tick after the card, once the report is back.
    await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());
    expect(screen.getByText('Invited')).toBeInTheDocument();
    expect(screen.getByText('Attended')).toBeInTheDocument();
    expect(screen.getByText('No-show')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    // Invited less attended: the figure and the bar agree by construction.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
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

  it('names the event, when it ran and where', async () => {
    await open();

    expect(
      screen.getByText(/Disaster Management Review · .*City Hall, Room 201/)
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

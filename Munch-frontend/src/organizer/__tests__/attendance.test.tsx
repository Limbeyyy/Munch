import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  /** The page's name belongs in the card the controls are in. */
  it('names the page inside the card that searches it', async () => {
    show();
    await screen.findByText('Disaster Management Review');

    const card = screen.getByLabelText('Search events').closest('div')!
      .parentElement!.parentElement as HTMLElement;
    expect(
      within(card).getByRole('heading', { name: 'Attendance' })
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/Who was at each session/)
    ).toBeInTheDocument();
  });

  /** And so do the events, which is what the controls are controlling. */
  it('holds the events in that same card', async () => {
    show();
    await screen.findByText('Disaster Management Review');

    // Anchored on the heading's own card rather than on some ancestor
    // of the search box: walking up far enough reaches a box that holds
    // both layouts, and then the test cannot tell them apart.
    const card = screen.getByRole('heading', { name: 'Attendance' })
      .parentElement!.parentElement as HTMLElement;
    expect(
      within(card).getByText('Disaster Management Review')
    ).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'View attendance' })
    ).toBeInTheDocument();
  });

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
 * One event's register, as 607-7613 draws it.
 *
 * The event on a grey ground with the two things done to its register -
 * search it, or take it away - and under that a line per person: who
 * they are, whether they came, and the hours they kept.
 */
describe('opening one event from the grid', () => {
  const someone = (over: any = {}) => ({
    type: 'user', name: 'Suman Karki', email: 'suman@example.com', phone: null,
    role: 'attendee',
    joined_at: '2026-09-05T08:01:00Z',
    left_at: '2026-09-05T10:05:00Z',
    is_active: false, was_invited: true,
    ...over,
  });

  const open = async (over: any = {}) => {
    api.getAttendance.mockResolvedValue(report({
      attended: [someone()],
      did_not_attend: [{ email: 'deepak@example.com', invited_at: '' }],
      ...over,
    }) as any);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'View attendance' }));
    return screen.findByText('suman@example.com');
  };

  /**
   * The way back belongs to the event, not to the page.
   *
   * It sat above the card, where it read as a control on the screen and
   * left the card with no head to it. It is now the first thing inside
   * the block that names the event, which is what it takes you back from.
   */
  it('puts the way back inside the card, over the event name', async () => {
    await open();

    const back = screen.getByRole('button', { name: 'Attendance' });
    const card = screen.getByRole('heading', {
      name: 'Disaster Management Review',
    }).parentElement as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Attendance' })).toBe(back);
  });

  it('names the event over its register', async () => {
    await open();

    expect(
      screen.getByRole('heading', { name: 'Disaster Management Review' })
    ).toBeInTheDocument();
    expect(screen.getByText(/City Hall, Room 201/)).toBeInTheDocument();
  });

  it('gives the register the columns the design asks for', async () => {
    await open();

    for (const head of [
      'Name', 'Email', 'Role', 'Status', 'Sessions', 'Joined', 'Left', 'Duration',
    ]) {
      expect(screen.getByRole('columnheader', { name: head })).toBeInTheDocument();
    }
  });

  it('marks who came, and who did not', async () => {
    await open();

    // Named on the chip and again in the status filter, hence the row.
    const came = screen.getByText('suman@example.com').closest('tr') as HTMLElement;
    expect(within(came).getByText('Attended')).toBeInTheDocument();
    const missed = screen.getByText('deepak@example.com').closest('tr') as HTMLElement;
    expect(within(missed).getByText('No-show')).toBeInTheDocument();
  });

  it('says what each person was here as', async () => {
    api.getAttendance.mockResolvedValue(report({
      attended: [
        someone({ role: 'host', name: 'Sarah Sharma', email: 'sarah@example.com' }),
        someone({ role: 'co_host', name: 'Bina Rai', email: 'bina@example.com' }),
        someone({ role: 'guest', name: 'Rahul Ingnam', email: null }),
      ],
      did_not_attend: [],
    }) as any);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'View attendance' }));
    await screen.findByText('Sarah Sharma');

    expect(
      within(screen.getByText('Sarah Sharma').closest('tr') as HTMLElement)
        .getByText('Host')
    ).toBeInTheDocument();
    expect(
      within(screen.getByText('Bina Rai').closest('tr') as HTMLElement)
        .getByText('Co-host')
    ).toBeInTheDocument();
    expect(
      within(screen.getByText('Rahul Ingnam').closest('tr') as HTMLElement)
        .getByText('Guest')
    ).toBeInTheDocument();
  });

  /** Out of the whole event, not out of what has run so far. */
  it('counts the sessions somebody sat through, out of the event', async () => {
    api.listEvents.mockResolvedValue([event({
      sessions: [
        { id: 's1', title: 'One', starts_at: '', duration_minutes: 30, status: 'done' },
        { id: 's2', title: 'Two', starts_at: '', duration_minutes: 30, status: 'done' },
      ],
    })] as any);
    api.getSessionAttendance.mockImplementation(async (id: string) =>
      (id === 's1'
        ? [{ id: 'a1', session: 's1', person_id: 'p1', name: 'Suman Karki',
             is_guest: false, marked_manually: false, recorded_at: '' }]
        : []) as any
    );
    await open();

    const row = screen.getByText('Suman Karki').closest('tr') as HTMLElement;
    expect(within(row).getByText('1/2')).toBeInTheDocument();
  });

  it('counts nothing against somebody who never came', async () => {
    await open();

    const row = screen.getByText('deepak@example.com').closest('tr') as HTMLElement;
    expect(within(row).queryByText(/\/\d/)).toBeNull();
  });

  it('says how long somebody stayed', async () => {
    await open();

    // Four minutes past two hours, between the two times above.
    expect(screen.getByText('2h 4m')).toBeInTheDocument();
  });

  /** Nobody arrived, so there are no hours to give. */
  it('leaves the hours blank for somebody who never came', async () => {
    await open();

    const row = screen.getByText('deepak@example.com').closest('tr') as HTMLElement;
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('narrows the register to what is searched for', async () => {
    await open();

    fireEvent.change(screen.getByLabelText('Search Attendees'), {
      target: { value: 'deepak' },
    });

    expect(screen.getByText('deepak@example.com')).toBeInTheDocument();
    expect(screen.queryByText('suman@example.com')).toBeNull();
  });

  it('narrows it to those who came, or those who did not', async () => {
    await open();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'no-show' } });

    expect(screen.getByText('deepak@example.com')).toBeInTheDocument();
    expect(screen.queryByText('suman@example.com')).toBeNull();
  });

  it('offers the register on a sheet', async () => {
    await open();

    expect(
      screen.getByRole('button', { name: /Export attendance/ })
    ).toBeInTheDocument();
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
 * while the card beside it said 40% had come.
 */
describe('attendance while the event is still running', () => {
  const openLive = async () => {
    api.listEvents.mockResolvedValue([event({
      status: 'active', started_at: new Date().toISOString(),
    })] as any);
    api.getAttendance.mockResolvedValue(report({
      attended: [
        { type: 'user', name: 'Sarah Sharma', email: 'sarah@example.com',
          phone: null, role: 'host', joined_at: new Date().toISOString(),
          left_at: null, is_active: true, was_invited: true },
        { type: 'guest', name: 'Rahul Ingnam', email: null, phone: null,
          role: 'guest', joined_at: new Date().toISOString(), left_at: null,
          is_active: true, was_invited: false },
      ],
      did_not_attend: [],
    }) as any);
    api.getSessionAttendance.mockResolvedValue([] as any);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'View attendance' }));
    return screen.findByText('Sarah Sharma');
  };

  it('names who is in the room, before any session has closed', async () => {
    await openLive();

    expect(screen.getByText('Rahul Ingnam')).toBeInTheDocument();
  });

  /** Still in the room, so there is no hour they left. */
  it('gives no leaving time for somebody still there', async () => {
    await openLive();

    const row = screen.getByText('Sarah Sharma').closest('tr') as HTMLElement;
    expect(within(row).getByText('Attended')).toBeInTheDocument();
    // The hour they left, and nothing else: the event has no sessions
    // in this fixture, so that column is a dash too.
    expect(within(row).getAllByText('—').length).toBe(2);
  });
});

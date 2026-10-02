import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { GroupedAgenda } from '../subEvents';
import { apiClient } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  apiClient: {
    getResources: jest.fn(),
    getSchedulingPrefs: jest.fn(),
    deleteSession: jest.fn(),
    rescheduleSessions: jest.fn(),
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

const session = (over: any = {}) => ({
  id: 's1', event: 'e1', title: 'Opening', description: '',
  speaker_name: '', speaker_visibility: 'private',
  starts_at: '2026-09-15T04:00:00Z', duration_minutes: 30,
  ends_at: '2026-09-15T04:30:00Z', position: 0, status: 'scheduled',
  started_at: null, ended_at: null, attendance_count: 0, sub_event: null,
  ...over,
}) as any;

const group = (over: any = {}) => ({
  id: 'g1', event: 'e1', title: 'Climate Change', description: '',
  position: 0, sessions: [], created_at: '2026-09-01T00:00:00Z',
  ...over,
}) as any;

const event = (sessions: any[]) => ({
  id: 'e1', code: 'ABC-123', title: 'Emergency Services', description: '',
  venue: '', event_date: '2026-09-15', status: 'scheduled',
  scheduled_start: '2026-09-15T04:00:00Z', scheduled_end: '2026-09-15T08:00:00Z',
  participant_count: 0, session_count: sessions.length, sessions,
}) as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getResources.mockResolvedValue([] as any);
  api.getSchedulingPrefs.mockResolvedValue({ session_gap_minutes: 0 } as any);
});

const show = (sessions: any[], groups: any[]) =>
  render(
    <OrganizerProvider>
      <GroupedAgenda
        event={event(sessions)}
        groups={groups}
        onChanged={jest.fn()}
        onEdit={jest.fn()}
      />
    </OrganizerProvider>
  );

/** A named part and the talks under it, read as one thing. */
const container = (title: string) =>
  screen.getByRole('heading', { name: title }).closest('section') as HTMLElement;

/**
 * The running order read under the event's own headings.
 *
 * A long day is a morning on one subject and an afternoon on another.
 * Reading it as twelve rows in a row loses that, so each named part
 * gets its own container with its own talks inside it.
 */
describe('the running order under its subcategories', () => {
  it('is the plain list where the day has no named parts', async () => {
    show([session()], []);

    await waitFor(() => expect(api.getResources).toHaveBeenCalled());
    expect(screen.getByText('Opening')).toBeInTheDocument();
    expect(screen.queryByText('Climate Change')).not.toBeInTheDocument();
  });

  it('wraps each part’s talks in that part’s own container', async () => {
    show(
      [
        session({ id: 's1', title: 'Opening', sub_event: 'g1' }),
        session({ id: 's2', title: 'Carbon trading', sub_event: 'g2',
          starts_at: '2026-09-15T05:00:00Z' }),
      ],
      [group(), group({ id: 'g2', title: 'Carbon emissions', position: 1 })]
    );

    await screen.findByText('Opening');
    expect(within(container('Climate Change')).getByText('Opening'))
      .toBeInTheDocument();
    expect(within(container('Climate Change')).queryByText('Carbon trading'))
      .not.toBeInTheDocument();
    expect(within(container('Carbon emissions')).getByText('Carbon trading'))
      .toBeInTheDocument();
  });

  it('says how many talks are under each', async () => {
    show(
      [
        session({ id: 's1', sub_event: 'g1' }),
        session({ id: 's2', title: 'Second', sub_event: 'g1',
          starts_at: '2026-09-15T05:00:00Z' }),
      ],
      [group()]
    );

    await screen.findByText('Opening');
    expect(within(container('Climate Change')).getByText('2 sessions'))
      .toBeInTheDocument();
  });

  /**
   * The host wrote it a moment ago on the step before and is about to
   * fill it. Dropping it would make what they just made appear not to
   * have been made.
   */
  it('shows a part nothing has been filed under yet', async () => {
    show([], [group()]);

    expect(await screen.findByRole('heading', { name: 'Climate Change' }))
      .toBeInTheDocument();
    expect(
      screen.getByText('Nothing has been filed under this subcategory yet.')
    ).toBeInTheDocument();
  });

  /**
   * A heading is a way of reading the day, not a box the day is kept
   * in. A talk under none of them is still on the programme, and
   * hiding it would lose it off the screen entirely.
   */
  it('keeps a talk that is under none of them, after the named parts', async () => {
    show(
      [
        session({ id: 's1', title: 'Opening', sub_event: 'g1' }),
        session({ id: 's2', title: 'Tea', sub_event: null,
          starts_at: '2026-09-15T05:00:00Z' }),
      ],
      [group()]
    );

    await screen.findByText('Tea');
    expect(within(container('Other agendas')).getByText('Tea')).toBeInTheDocument();

    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings.indexOf('Other agendas'))
      .toBeGreaterThan(headings.indexOf('Climate Change'));
  });

  /**
   * The day is narrowed before it is grouped, so a multi-day event's
   * headings show only what runs on the day being looked at.
   */
  it('groups only the day it was handed', async () => {
    render(
      <OrganizerProvider>
        <GroupedAgenda
          event={event([
            session({ id: 's1', title: 'Opening', sub_event: 'g1' }),
            session({ id: 's2', title: 'Day two talk', sub_event: 'g1',
              starts_at: '2026-09-16T04:00:00Z' }),
          ])}
          groups={[group()]}
          sessions={[session({ id: 's1', title: 'Opening', sub_event: 'g1' })]}
          onChanged={jest.fn()}
        />
      </OrganizerProvider>
    );

    await screen.findByText('Opening');
    expect(screen.queryByText('Day two talk')).not.toBeInTheDocument();
  });
});

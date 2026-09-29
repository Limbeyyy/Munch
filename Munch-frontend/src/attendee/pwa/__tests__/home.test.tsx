import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../../organizer/i18n';
import { AttendeeApp } from '../AttendeeApp';
import { apiClient } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  apiClient: {
    listEvents: jest.fn(),
    listSessions: jest.fn(),
    getSubEvents: jest.fn(),
    getResources: jest.fn(),
    getHub: jest.fn(),
    getSessionSummary: jest.fn(),
    getReminders: jest.fn(),
    markRemindersRead: jest.fn(),
    getEventSegments: jest.fn(),
    getPhotos: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

// jsdom has no scrollIntoView, and the room's transcript follows the
// speaker with it.
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
});

const event = (over: any = {}) => ({
  id: 'e1', code: 'ABC-123', title: 'Emergency Service Meeting',
  description: '', venue: 'Kathmandu', status: 'scheduled',
  event_date: '2026-10-15',
  scheduled_start: '2026-10-15T04:15:00Z',
  scheduled_end: '2026-10-15T06:15:00Z',
  started_at: null,
  participant_count: 0, sessions: [], session_count: 2,
  created_at: '', updated_at: '',
  ...over,
}) as any;

const session = (over: any = {}) => ({
  id: 's1', event: 'e1', title: 'Emergency Response Overview', description: '',
  speaker_name: 'Sarah Johnson', speaker_role: 'Director of Emergency Management',
  speaker_visibility: 'public', speaker_photo_url: null, sub_event: null,
  starts_at: '2026-10-15T04:15:00Z', duration_minutes: 60,
  ends_at: '2026-10-15T05:15:00Z', position: 0, status: 'scheduled',
  started_at: null, ended_at: null, attendance_count: 0,
  ...over,
}) as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.listEvents.mockResolvedValue([event()] as any);
  api.listSessions.mockResolvedValue([session()] as any);
  api.getSubEvents.mockResolvedValue([] as any);
  api.getResources.mockResolvedValue([] as any);
  api.getHub.mockResolvedValue({ questions: [], ideas: [], suggestions: [] } as any);
  api.getSessionSummary.mockRejectedValue(new Error('not published'));
  api.getReminders.mockResolvedValue({
    reminders: [], unread: 0,
    event_lead_minutes: 60, session_lead_minutes: 10,
  } as any);
  api.markRemindersRead.mockResolvedValue({} as any);
});

const show = () =>
  render(
    <OrganizerProvider>
      <AttendeeApp />
    </OrganizerProvider>
  );

const go = async (tab: string) => {
  show();
  await screen.findByRole('navigation', { name: 'Sections' });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(tab) }));
};

/**
 * Outside the room.
 *
 * The room is one screen of somebody's week; the rest of it is
 * looking forward to a thing, or back at one. That is this shell.
 */
describe('the way in', () => {
  it('opens on home, not on a room', async () => {
    show();
    expect(
      await screen.findByText('Emergency Service Meeting')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Transcript/ })).toBeNull();
  });

  it('offers the four things outside a room', async () => {
    show();
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    ['Home', 'Events', 'Notifications', 'Profile'].forEach((one) => {
      expect(within(nav).getByRole('button', { name: new RegExp(one) }))
        .toBeInTheDocument();
    });
  });
});

describe('the events list', () => {
  it('sorts them onto the deck they belong to', async () => {
    api.listEvents.mockResolvedValue([
      event({ id: 'e1', title: 'Coming Up' }),
      event({ id: 'e2', title: 'Running Now', status: 'active' }),
      event({ id: 'e3', title: 'All Over', status: 'ended' }),
    ] as any);

    await go('Events');

    expect(await screen.findByText('Coming Up')).toBeInTheDocument();
    expect(screen.queryByText('Running Now')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Live/ }));
    expect(await screen.findByText('Running Now')).toBeInTheDocument();
    expect(screen.queryByText('Coming Up')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
    expect(await screen.findByText('All Over')).toBeInTheDocument();
  });
});

describe('one event, opened', () => {
  const openIt = async (deck?: string) => {
    await go('Events');
    if (deck) fireEvent.click(await screen.findByRole('button', { name: deck }));
    fireEvent.click(await screen.findByRole('button', { name: /View event/ }));
    await screen.findByRole('tab', { name: 'Agendas' });
  };

  it('offers the five things there are to read', async () => {
    await openIt();
    ['Agendas', 'Speaker', 'Files', 'Questions', 'Suggestions'].forEach((one) => {
      expect(screen.getByRole('tab', { name: one })).toBeInTheDocument();
    });
  });

  /**
   * Every tab draws the same headings, so the shape of the day does
   * not change when the subject does.
   */
  it('groups every tab under the same parts of the day', async () => {
    api.getSubEvents.mockResolvedValue([
      { id: 'g1', event: 'e1', title: 'Emergency', description: '',
        position: 0, sessions: [], created_at: '', updated_at: '' },
      { id: 'g2', event: 'e1', title: 'SOS', description: '',
        position: 1, sessions: [], created_at: '', updated_at: '' },
    ] as any);
    api.listSessions.mockResolvedValue([
      session({ id: 's1', title: 'Response Overview', sub_event: 'g1' }),
      session({ id: 's2', title: 'Rescue Drill', sub_event: 'g2' }),
    ] as any);
    api.getResources.mockResolvedValue([
      { id: 'a1', session: 's1', display_name: 'Deck.pdf', file_size: 2048,
        web_view_link: 'https://example.test/deck' },
      { id: 'a2', session: 's2', display_name: 'Drill.pdf', file_size: 2048,
        web_view_link: 'https://example.test/drill' },
    ] as any);

    await openIt();
    const agendas = (await screen.findByText('Emergency')).closest('section')!;
    expect(within(agendas).getByText('Response Overview')).toBeInTheDocument();
    expect(within(agendas).queryByText('Rescue Drill')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    const part = (await screen.findByText('Emergency')).closest('section')!;
    expect(within(part).getByText('Deck.pdf')).toBeInTheDocument();
    expect(within(part).queryByText('Drill.pdf')).toBeNull();
  });

  it('opens a long summary out and folds it back', async () => {
    const body = `${'An exploration of how the response was coordinated. '
      .repeat(3)}and the drill that followed.`;
    api.getSessionSummary.mockResolvedValue({
      session: 's1', session_title: 'Emergency Response Overview',
      body, actions: [], status: 'published', is_published: true,
      saved: true, published_at: '2026-10-15T05:30:00Z',
    } as any);

    await openIt();

    const more = await screen.findByRole('button', { name: 'view more' });
    expect(screen.queryByText(/the drill that followed/)).toBeNull();
    fireEvent.click(more);
    expect(screen.getByText(/the drill that followed/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'view less' })
    ).toBeInTheDocument();
  });

  it('carries the speaker onto the speaker tab', async () => {
    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Speaker' }));

    expect(await screen.findByText('Sarah Johnson')).toBeInTheDocument();
    expect(
      screen.getByText('Director of Emergency Management')
    ).toBeInTheDocument();
  });

  it('keeps questions and suggestions apart', async () => {
    api.getHub.mockResolvedValue({
      questions: [{ id: 'h1', kind: 'question', body: 'Why the delay?',
        session_id: 's1', status: 'published' }],
      ideas: [],
      suggestions: [{ id: 'h2', kind: 'suggestion', body: 'More signage.',
        session_id: 's1', status: 'published' }],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));
    expect(await screen.findByText('Why the delay?')).toBeInTheDocument();
    expect(screen.queryByText('More signage.')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Suggestions' }));
    expect(await screen.findByText('More signage.')).toBeInTheDocument();
    expect(screen.queryByText('Why the delay?')).toBeNull();
  });

  /** A room is only worth offering while there is one. */
  it('offers the live room only for an event that is running', async () => {
    await openIt();
    expect(screen.queryByRole('button', { name: /Enter live room/ })).toBeNull();
  });

  it('steps into the room and back out again', async () => {
    api.listEvents.mockResolvedValue([
      event({ status: 'active', started_at: '2026-10-15T04:15:00Z' }),
    ] as any);

    await openIt(/^Live/ as any);
    fireEvent.click(screen.getByRole('button', { name: /Enter live room/ }));

    expect(
      await screen.findByRole('button', { name: /Transcript/ })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Leave room/ }));
    expect(
      await screen.findByRole('navigation', { name: 'Sections' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Transcript/ })).toBeNull();
  });
});

describe('the notifications', () => {
  it('shows what has been sent, and clears the badge', async () => {
    api.getReminders.mockResolvedValue({
      reminders: [{
        id: 'r1', kind: 'event', event_id: 'e1', code: 'ABC-123',
        event_title: 'Emergency Service Meeting',
        session_id: null, session_title: null, speaker_name: '',
        venue: 'Kathmandu',
        starts_at: '2026-10-15T04:15:00Z', ends_at: '2026-10-15T06:15:00Z',
        due_at: new Date(Date.now() - 600000).toISOString(),
      }],
      unread: 1, event_lead_minutes: 60, session_lead_minutes: 10,
    } as any);

    await go('Notifications');

    expect(await screen.findByText('Upcoming event')).toBeInTheDocument();
    await waitFor(() => expect(api.markRemindersRead).toHaveBeenCalled());
  });
});

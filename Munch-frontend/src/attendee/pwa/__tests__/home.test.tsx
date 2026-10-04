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
    getPhotos: jest.fn(),
    getResources: jest.fn(),
    getSpeakers: jest.fn(),
    getHub: jest.fn(),
    voteHubPost: jest.fn(),
    getSessionSummary: jest.fn(),
    getReminders: jest.fn(),
    markRemindersRead: jest.fn(),
    getEventSegments: jest.fn(),
    joinEvent: jest.fn(),
    leaveEvent: jest.fn(),
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

const question = (over: any = {}) => ({
  id: 'h1', kind: 'question', body: 'Why the delay?', category: '',
  status: 'published', anonymous: false, author: 'Suman',
  author_is_guest: false, mine: false, session_id: 's1', session_title: null,
  score: 31, my_vote: 0, answer: '', answered_by: '',
  downvote_count: 0,
  created_at: '2026-10-15T05:00:00Z',
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
  api.getPhotos.mockResolvedValue({ folders: [], photos: [] } as any);
  api.getResources.mockResolvedValue([] as any);
  api.getSpeakers.mockResolvedValue([] as any);
  api.getHub.mockResolvedValue({ questions: [], ideas: [], suggestions: [] } as any);
  api.getSessionSummary.mockRejectedValue(new Error('not published'));
  api.getReminders.mockResolvedValue({
    reminders: [], unread: 0,
    event_lead_minutes: 60, session_lead_minutes: 10,
  } as any);
  api.markRemindersRead.mockResolvedValue({} as any);
  api.getEventSegments.mockResolvedValue([] as any);
  api.joinEvent.mockResolvedValue({} as any);
  api.leaveEvent.mockResolvedValue(undefined as any);
  api.voteHubPost.mockImplementation(async (_code, id) => ({
    ...question({ id }), score: 32, my_vote: 1,
  }) as any);
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
  /**
   * A host opening this on their phone is looking at other people's
   * programmes. Their own belong in the host portal, and asking the
   * general question would hand them back.
   */
  it('asks only for the events this person was put in', async () => {
    show();
    await screen.findByRole('navigation', { name: 'Sections' });

    expect(api.listEvents).toHaveBeenCalledWith('attendee');
  });

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

describe('home', () => {
  /**
   * Live is its own section, not the top of Upcoming: the answer to
   * something happening now is "go in", not "read about it later".
   */
  it('keeps what is running apart from what is coming', async () => {
    api.listEvents.mockResolvedValue([
      event({ id: 'e1', title: 'Coming Up' }),
      event({ id: 'e2', title: 'Running Now', status: 'active' }),
      event({ id: 'e3', title: 'All Over', status: 'ended' }),
    ] as any);

    show();

    const now = (await screen.findByRole('heading', { name: 'Live' }))
      .closest('section')!;
    expect(within(now).getByText('Running Now')).toBeInTheDocument();
    expect(within(now).queryByText('Coming Up')).toBeNull();

    const soon = screen.getByRole('heading', { name: 'Upcoming' })
      .closest('section')!;
    expect(within(soon).getByText('Coming Up')).toBeInTheDocument();

    const past = screen.getByRole('heading', { name: 'Recently attended' })
      .closest('section')!;
    expect(within(past).getByText('All Over')).toBeInTheDocument();
  });

  it('says nothing about Live where nothing is running', async () => {
    show();
    await screen.findByRole('heading', { name: 'Upcoming' });
    expect(screen.queryByRole('heading', { name: 'Live' })).toBeNull();
  });

  it('shows the three newest upcoming events and links to their full list', async () => {
    api.listEvents.mockResolvedValue(Array.from({ length: 5 }, (_, index) =>
      event({
        id: `up-${index}`,
        title: `Upcoming ${index}`,
        created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      })
    ) as any);

    show();
    const section = (await screen.findByRole('heading', { name: 'Upcoming' }))
      .closest('section')!;
    expect(within(section).getByText('Upcoming 4')).toBeInTheDocument();
    expect(within(section).getByText('Upcoming 3')).toBeInTheDocument();
    expect(within(section).getByText('Upcoming 2')).toBeInTheDocument();
    expect(within(section).queryByText('Upcoming 1')).toBeNull();

    fireEvent.click(within(section).getByRole('button', { name: 'View all' }));
    expect(await screen.findByText('Upcoming 0')).toBeInTheDocument();
    expect(screen.getByText('Upcoming 4')).toBeInTheDocument();
  });

  it('paginates My Events newest-first in pages of 10', async () => {
    api.listEvents.mockResolvedValue(Array.from({ length: 12 }, (_, index) =>
      event({
        id: `up-${index}`,
        title: `My event ${index}`,
        created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      })
    ) as any);

    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Events/ }));
    expect(await screen.findByText('My event 11')).toBeInTheDocument();
    expect(screen.getByText('My event 2')).toBeInTheDocument();
    expect(screen.queryByText('My event 1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('My event 1')).toBeInTheDocument();
    expect(screen.getByText('My event 0')).toBeInTheDocument();
  });

  it('shows the question total on completed cards only on Home', async () => {
    api.listEvents.mockResolvedValue([
      event({ id: 'e3', code: 'OLD-123', title: 'All Over', status: 'ended' }),
    ] as any);
    api.getHub.mockResolvedValue({
      questions: [question({ id: 'h1' }), question({ id: 'h2' })],
      ideas: [], suggestions: [],
    } as any);

    show();
    const recentlyAttended = (await screen.findByRole('heading', {
      name: 'Recently attended',
    })).closest('section')!;
    expect(await within(recentlyAttended).findByText('2 questions'))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Events/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Completed/ }));
    expect(screen.queryByText('2 questions')).toBeNull();
  });

  /** A running event offers the room, not a page about the room. */
  it('offers the room straight from a running event', async () => {
    api.listEvents.mockResolvedValue([
      event({ id: 'e2', title: 'Running Now', status: 'active' }),
    ] as any);

    show();
    fireEvent.click(await screen.findByRole('button', { name: /Join Live/ }));

    expect(
      await screen.findByRole('button', { name: /Transcript/ })
    ).toBeInTheDocument();
  });

  it('offers no Join Live on something still to come', async () => {
    show();
    await screen.findByText('Emergency Service Meeting');
    expect(screen.queryByRole('button', { name: /Join Live/ })).toBeNull();
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
    expect(screen.queryByText('All Over')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
    expect(await screen.findByText('All Over')).toBeInTheDocument();
    expect(screen.queryByText('Coming Up')).toBeNull();
  });

  it('renders completed events with questions and summary availability', async () => {
    api.listEvents.mockResolvedValue([
      event({
        id: 'e3', code: 'OLD-123', title: 'Product Leadership Summit',
        status: 'ended', venue: 'Kathmandu', event_date: '2026-06-18',
        session_count: 3, sessions: [session({ id: 's3' })],
      }),
    ] as any);
    api.getHub.mockResolvedValue({
      questions: [question({ id: 'h1' }), question({ id: 'h2' })],
      ideas: [], suggestions: [],
    } as any);
    api.getSessionSummary.mockResolvedValue({
      is_published: true, body: 'Published summary',
    } as any);

    await go('Events');
    fireEvent.click(await screen.findByRole('button', { name: /^Completed/ }));

    expect(await screen.findByText('Product Leadership Summit'))
      .toBeInTheDocument();
    expect(screen.getByText('June 18, 2026')).toBeInTheDocument();
    expect(screen.getByText('Kathmandu')).toBeInTheDocument();
    expect(screen.getByText('3 sessions')).toBeInTheDocument();
    expect(await screen.findByText('2 questions')).toBeInTheDocument();
    expect(await screen.findByText('Summaries available')).toBeInTheDocument();
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

  it('says no files have been added in the normal event flow', async () => {
    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('No files added yet.')).toBeInTheDocument();
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

  /**
   * Picking a day is the running order's question. Everywhere else
   * the question is about the event, and the filter used to follow
   * those tabs around with nothing on screen saying why half the
   * speakers were missing.
   */
  it('shows every day\'s speakers, not only the day chosen', async () => {
    api.listEvents.mockResolvedValue([
      event({ scheduled_end: '2026-10-16T06:15:00Z' }),
    ] as any);
    api.listSessions.mockResolvedValue([
      session({ id: 's1', title: 'Opening', speaker_name: 'Ram Rimal',
        starts_at: '2026-10-15T04:00:00Z' }),
      session({ id: 's2', title: 'Closing', speaker_name: 'Sita Gurung',
        starts_at: '2026-10-16T04:00:00Z' }),
    ] as any);

    await openIt();

    // Day 1 only, on the running order.
    expect(await screen.findByText('Opening')).toBeInTheDocument();
    expect(screen.queryByText('Closing')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Speaker' }));

    expect(await screen.findByText('Ram Rimal')).toBeInTheDocument();
    expect(screen.getByText('Sita Gurung')).toBeInTheDocument();
  });

  it('and every day\'s files and questions', async () => {
    api.listEvents.mockResolvedValue([
      event({ scheduled_end: '2026-10-16T06:15:00Z' }),
    ] as any);
    api.listSessions.mockResolvedValue([
      session({ id: 's1', title: 'Opening',
        starts_at: '2026-10-15T04:00:00Z' }),
      session({ id: 's2', title: 'Closing',
        starts_at: '2026-10-16T04:00:00Z' }),
    ] as any);
    api.getResources.mockResolvedValue([
      { id: 'a2', session: 's2', display_name: 'SecondDay.pdf',
        file_size: 2048, web_view_link: 'https://example.test/x' },
    ] as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));

    expect(await screen.findByText('SecondDay.pdf')).toBeInTheDocument();
  });

  /** The pills are the running order's own. */
  it('offers the day pills only on the running order', async () => {
    api.listEvents.mockResolvedValue([
      event({ scheduled_end: '2026-10-16T06:15:00Z' }),
    ] as any);
    api.listSessions.mockResolvedValue([
      session({ id: 's1', starts_at: '2026-10-15T04:00:00Z' }),
      session({ id: 's2', starts_at: '2026-10-16T04:00:00Z' }),
    ] as any);

    await openIt();
    expect(await screen.findByRole('button', { name: 'Day 2' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Speaker' }));
    expect(screen.queryByRole('button', { name: 'Day 2' })).toBeNull();
  });

  it('carries the speaker onto the speaker tab', async () => {
    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Speaker' }));

    expect(await screen.findByText('Sarah Johnson')).toBeInTheDocument();
    expect(
      screen.getByText('Director of Emergency Management')
    ).toBeInTheDocument();
  });

  /**
   * A question asked with nothing on stage carries no session, and
   * the rest of the screen is grouped by session - so it used to be
   * drawn nowhere at all, and the tab came back empty.
   */
  it('shows a question that belongs to no talk', async () => {
    api.getHub.mockResolvedValue({
      questions: [question({ id: 'h1', body: 'What is Kataho?',
        session_id: null })],
      ideas: [],
      suggestions: [question({ id: 'h2', kind: 'suggestion',
        body: 'Do this proper', session_id: null })],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));
    expect(await screen.findByText('What is Kataho?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Suggestions' }));
    expect(await screen.findByText('Do this proper')).toBeInTheDocument();
  });

  /** One against a talk that is not on the day being shown is not lost. */
  it('shows one whose talk is not on the programme it can see', async () => {
    api.getHub.mockResolvedValue({
      questions: [question({ id: 'h1', body: 'From another day.',
        session_id: 'gone' })],
      ideas: [], suggestions: [],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));

    expect(await screen.findByText('From another day.')).toBeInTheDocument();
  });

  it('puts unassigned questions under the only agenda', async () => {
    api.getSubEvents.mockResolvedValue([
      { id: 'g1', event: 'e1', title: 'Prabhat', description: '',
        position: 0, sessions: [], created_at: '' },
    ] as any);
    api.listSessions.mockResolvedValue([
      session({ id: 's1', sub_event: 'g1' }),
    ] as any);
    api.getHub.mockResolvedValue({
      questions: [question({ id: 'h1', body: 'Where is Prabhat?' })],
      ideas: [], suggestions: [],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));

    const agenda = (await screen.findByRole('heading', { name: 'Prabhat' }))
      .closest('section')!;
    expect(within(agenda).getByText('Where is Prabhat?')).toBeInTheDocument();
    expect(screen.queryByText('For the whole event')).toBeNull();
  });

  it('files one that belongs to no talk where it can be seen', async () => {
    api.getResources.mockResolvedValue([
      { id: 'a1', session: null, display_name: 'Programme.pdf',
        file_size: 2048, web_view_link: 'https://example.test/p' },
    ] as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));

    const loose = (await screen.findByText('For the whole event'))
      .closest('section') as HTMLElement;
    expect(within(loose).getByText('Programme.pdf')).toBeInTheDocument();
  });

  it('keeps questions and suggestions apart', async () => {
    api.getHub.mockResolvedValue({
      questions: [question()],
      ideas: [],
      suggestions: [question({ id: 'h2', kind: 'suggestion',
        body: 'More signage.' })],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));
    expect(await screen.findByText('Why the delay?')).toBeInTheDocument();
    expect(screen.queryByText('More signage.')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Suggestions' }));
    expect(await screen.findByText('More signage.')).toBeInTheDocument();
    expect(screen.queryByText('Why the delay?')).toBeNull();
  });

  it('explains that questions and suggestions become available during the event', async () => {
    api.getSubEvents.mockResolvedValue([
      { id: 'g1', event: 'e1', title: 'Software Development Cycle',
        description: '', position: 0, sessions: [], created_at: '' },
      { id: 'g2', event: 'e1', title: 'Artificial Intelligence Development',
        description: '', position: 1, sessions: [], created_at: '' },
    ] as any);
    api.listSessions.mockResolvedValue([
      session({ id: 's1', sub_event: 'g1' }),
      session({ id: 's2', sub_event: 'g2' }),
    ] as any);
    api.getHub.mockResolvedValue({
      questions: [], ideas: [], suggestions: [],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));
    await screen.findByRole('heading', { name: 'Artificial Intelligence Development' });
    expect(await screen.findAllByText('Questions will be available during the event.'))
      .toHaveLength(2);
    expect(screen.queryByText('Nothing here yet.')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Suggestions' }));
    await screen.findByRole('heading', { name: 'Artificial Intelligence Development' });
    expect(await screen.findAllByText('Suggestions will be available during the event.'))
      .toHaveLength(2);
    expect(screen.queryByText('Nothing here yet.')).toBeNull();
  });

  /**
   * A popular talk collects thirty questions, and the point of
   * grouping them under their talk is lost if one talk fills the
   * screen.
   */
  it('folds a long thread down to two, and opens it', async () => {
    api.getHub.mockResolvedValue({
      questions: [
        question({ id: 'h1', body: 'First asked.' }),
        question({ id: 'h2', body: 'Second asked.' }),
        question({ id: 'h3', body: 'Third asked.' }),
      ],
      ideas: [], suggestions: [],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));

    expect(await screen.findByText('Second asked.')).toBeInTheDocument();
    expect(screen.queryByText('Third asked.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'view 1 more question' }));
    expect(screen.getByText('Third asked.')).toBeInTheDocument();
  });

  it('carries a vote on a question but none on a suggestion', async () => {
    api.getHub.mockResolvedValue({
      questions: [question()],
      ideas: [],
      suggestions: [question({ id: 'h2', kind: 'suggestion',
        body: 'More signage.' })],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));

    const up = await screen.findByRole('button', { name: 'Vote up' });
    expect(up).toHaveTextContent('31');
    expect(screen.getByRole('button', { name: 'Vote down' })).toHaveTextContent('0');
    fireEvent.click(up);
    await waitFor(() => expect(api.voteHubPost)
      .toHaveBeenCalledWith('ABC-123', 'h1', 1));
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Vote up' })
    ).toHaveTextContent('32'));

    fireEvent.click(screen.getByRole('tab', { name: 'Suggestions' }));
    expect(await screen.findByText('More signage.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vote up' })).toBeNull();
  });

  /**
   * The files tab holds two things: the handouts filed against each
   * talk, and the albums of the day.
   */
  it('switches between the handouts and the albums', async () => {
    api.getResources.mockResolvedValue([
      { id: 'a1', session: 's1', display_name: 'Deck.pdf', file_size: 2048,
        web_view_link: 'https://example.test/deck' },
    ] as any);
    api.getPhotos.mockResolvedValue({
      folders: [{ id: 'f1', name: 'Event Opening', photo_count: 24,
        is_default: false, created_by: '', is_mine: false, created_at: '' }],
      photos: [],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));

    expect(await screen.findByText('Deck.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Event Opening')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Photos' }));

    expect(await screen.findByText('Event Opening')).toBeInTheDocument();
    expect(screen.getByText('24 photos')).toBeInTheDocument();
    expect(screen.queryByText('Deck.pdf')).toBeNull();
  });

  /**
   * The blue is the ground between the white blocks. A tab with
   * nothing on it has no blocks, so showing the ground made an empty
   * tab look like a rendering fault instead of an empty tab.
   */
  it('leaves an empty tab white, with no ground showing', async () => {
    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
    await screen.findByText('No photographs yet.');

    expect(document.querySelector('[data-ground]')).toBeNull();
  });

  it('and shows it once there is something sitting on it', async () => {
    api.getPhotos.mockResolvedValue({
      folders: [{ id: 'f1', name: 'Event Opening', photo_count: 24,
        is_default: false, created_by: '', is_mine: false, created_at: '' }],
      photos: [],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
    await screen.findByText('Event Opening');

    expect(document.querySelector('[data-ground]')).not.toBeNull();
  });

  it('says so where there are no albums', async () => {
    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Photos' }));

    expect(await screen.findByText('No photographs yet.')).toBeInTheDocument();
  });

  /** Having chosen Photos, leaving the tab should leave the albums. */
  it('leaves the albums behind when another tab is chosen', async () => {
    api.getPhotos.mockResolvedValue({
      folders: [{ id: 'f1', name: 'Event Opening', photo_count: 24,
        is_default: false, created_by: '', is_mine: false, created_at: '' }],
      photos: [],
    } as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
    expect(await screen.findByText('Event Opening')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Agendas' }));
    expect(screen.queryByText('Event Opening')).toBeNull();
  });

  /** The switcher is the files tab's own; it has no business elsewhere. */
  it('offers the switcher only on the files tab', async () => {
    await openIt();
    expect(screen.queryByRole('button', { name: 'Photos' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(screen.getByRole('button', { name: 'Photos' })).toBeInTheDocument();
  });

  it('offers a file to take away, with what it is', async () => {
    api.getResources.mockResolvedValue([
      { id: 'a1', session: 's1', display_name: 'Deck.pdf', file_size: 4404019,
        web_view_link: 'https://example.test/deck' },
    ] as any);

    await openIt();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));

    expect(await screen.findByText('Deck.pdf')).toBeInTheDocument();
    expect(screen.getByText(/^PDF · /)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Download Deck.pdf' })
    ).toHaveAttribute('href', 'https://example.test/deck');
  });

  /** A room is only worth offering while there is one. */
  it('offers the live room only for an event that is running', async () => {
    await openIt();
    expect(screen.queryByRole('button', { name: /Enter live room/ })).toBeNull();
  });

  /**
   * Opening the room on a phone used to tell the server nothing, so
   * an attendee who sat through the whole event never appeared among
   * the participants and was counted absent afterwards.
   */
  it('says that somebody is in the room on the way in', async () => {
    api.listEvents.mockResolvedValue([
      event({ status: 'active', started_at: '2026-10-15T04:15:00Z' }),
    ] as any);

    // Home is the way to a running event; the events list has an
    // Upcoming deck and a Completed one, and a live event is on neither.
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Join Live/ }));

    await waitFor(() => expect(api.joinEvent).toHaveBeenCalledWith('ABC-123'));
  });

  it('and that they have gone on the way out', async () => {
    api.listEvents.mockResolvedValue([
      event({ status: 'active', started_at: '2026-10-15T04:15:00Z' }),
    ] as any);

    show();
    fireEvent.click(await screen.findByRole('button', { name: /Join Live/ }));
    await waitFor(() => expect(api.joinEvent).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: /^Leave/ }));

    await waitFor(() => expect(api.leaveEvent).toHaveBeenCalledWith('e1'));
  });

  it('steps into the room and back out again', async () => {
    api.listEvents.mockResolvedValue([
      event({ status: 'active', started_at: '2026-10-15T04:15:00Z' }),
    ] as any);

    // Home is the way to a running event: the events list has an
    // Upcoming deck and a Completed one, and a live event is on
    // neither.
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Join Live/ }));

    expect(
      await screen.findByRole('button', { name: /Transcript/ })
    ).toBeInTheDocument();

    // The transcript carries the way out in its own header now.
    fireEvent.click(screen.getByRole('button', { name: /^Leave/ }));
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
    expect(api.getReminders).toHaveBeenCalledWith('attendee');
    await waitFor(() => expect(api.markRemindersRead).toHaveBeenCalled());
    expect(api.markRemindersRead).toHaveBeenCalledWith(undefined, 'attendee');
  });
});

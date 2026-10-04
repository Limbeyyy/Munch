import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../../organizer/i18n';
import { LiveRoom } from '../LiveRoom';
import { NotificationsScreen } from '../NotificationsScreen';
import { apiClient } from '../../../services/api';
import { LIST_POLL_MS } from '../../../services/polling';

jest.mock('../../../services/api', () => ({
  apiClient: {
    listEvents: jest.fn(),
    getActiveEvents: jest.fn(),
    listSessions: jest.fn(),
    getEventSegments: jest.fn(),
    getSessionSummary: jest.fn(),
    getHub: jest.fn(),
    addHubPost: jest.fn(),
    voteHubPost: jest.fn(),
    getResources: jest.fn(),
    getSubEvents: jest.fn(),
    getPhotos: jest.fn(),
    getPhotoObjectUrl: jest.fn(),
    joinEvent: jest.fn(),
    leaveEvent: jest.fn(),
    getReminders: jest.fn(),
    markRemindersRead: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn(),
  }),
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

// jsdom has no scrollIntoView, and the transcript follows the speaker
// with it.
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
});

const event = {
  id: 'e1', code: 'ABC-123', title: 'Emergency Service Meeting',
  description: '', venue: 'Kathmandu', status: 'active',
  idle_timeout_minutes: 1,
  event_date: '2026-09-15',
  scheduled_start: '2026-09-15T04:15:00Z',
  scheduled_end: '2026-09-15T06:15:00Z',
  started_at: '2026-09-15T04:15:00Z',
  participant_count: 0, sessions: [], session_count: 1,
  created_at: '', updated_at: '',
} as any;

const session = (over: any = {}) => ({
  id: 's1', event: 'e1', title: 'Emergency Response Overview', description: '',
  speaker_name: 'Sarah Johnson', speaker_role: 'Director of Emergency Management',
  speaker_visibility: 'public', speaker_photo_url: null,
  starts_at: '2026-09-15T04:15:00Z', duration_minutes: 60,
  ends_at: '2026-09-15T05:15:00Z', position: 0, status: 'live',
  started_at: '2026-09-15T04:15:00Z', ended_at: null, attendance_count: 0,
  ...over,
}) as any;

const post = (over: any = {}) => ({
  id: 'h1', kind: 'question', body: 'How are the delays being addressed?',
  category: '', status: 'published', anonymous: false, author: 'Suman',
  author_is_guest: false, mine: false, session_id: null, session_title: null,
  score: 3, my_vote: 0, answer: '', answered_by: '',
  created_at: new Date(Date.now() - 480000).toISOString(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  (window as any).__attendeeSocket = null;
  const MockWebSocket = class {
    static OPEN = 1;
    onmessage: ((event: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    readyState = 1;
    send = jest.fn();
    constructor() { (window as any).__attendeeSocket = this; }
    close() {}
  };
  Object.defineProperty(window, 'WebSocket', {
    configurable: true, writable: true, value: MockWebSocket,
  });
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.listEvents.mockResolvedValue([event] as any);
  api.getActiveEvents.mockResolvedValue([event] as any);
  api.listSessions.mockResolvedValue([session()] as any);
  api.getEventSegments.mockResolvedValue([] as any);
  api.getHub.mockResolvedValue({ questions: [], ideas: [], suggestions: [] } as any);
  api.getResources.mockResolvedValue([] as any);
  api.getSubEvents.mockResolvedValue([] as any);
  api.getPhotos.mockResolvedValue({ folders: [], photos: [] } as any);
  api.joinEvent.mockResolvedValue({} as any);
  api.leaveEvent.mockResolvedValue(undefined as any);
  api.getReminders.mockResolvedValue({ reminders: [], unread: 0 } as any);
  api.markRemindersRead.mockResolvedValue({ marked: 0 } as any);
  api.getSessionSummary.mockResolvedValue({
    session: 's1', session_title: 'Emergency Response Overview',
    body: 'An exploration of how the response was coordinated.',
    actions: [], status: 'published', is_published: true, saved: true,
    published_at: '2026-09-15T05:30:00Z',
  } as any);
});

const show = (onLeave = () => {}) =>
  render(
    <OrganizerProvider>
      <LiveRoom onLeave={onLeave} />
    </OrganizerProvider>
  );

const go = async (tab: string) => {
  show();
  await screen.findByRole('navigation', { name: 'Sections' });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(tab) }));
};

/**
 * The attendee app, on a phone.
 *
 * It used to be the host's screens with the ones an attendee may not
 * touch taken out - a rail down the side, a page of cards, a drawer.
 * That is a desk layout, and somebody in a hall is holding a phone.
 */
describe('the five things along the bottom', () => {
  it('offers them all', async () => {
    show();

    const bar = await screen.findByRole('navigation', { name: 'Sections' });
    ['Transcript', 'Agenda', 'Q&A', 'Files', 'Profile'].forEach((name) => {
      expect(within(bar).getByRole('button', { name: new RegExp(name) }))
        .toBeInTheDocument();
    });
  });

  it('uses the attendee settings profile with the normal selected-tab style', async () => {
    show();
    const bar = await screen.findByRole('navigation', { name: 'Sections' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Profile' }));

    expect(await screen.findByText('Profile and Settings')).toBeInTheDocument();
    const profileTab = within(
      screen.getByRole('navigation', { name: 'Sections' })
    ).getByRole('button', { name: 'Profile' });
    expect(profileTab).toHaveClass('text-[#194D97]');
    expect(profileTab).not.toHaveClass('bg-[#194D97]');
    expect(profileTab.querySelector('svg')).toHaveAttribute('stroke', '#194D97');
  });

  it('opens on the transcript', async () => {
    show();

    expect(await screen.findByText('Live transcription')).toBeInTheDocument();
  });

  it('leaves the transcript room when the event status is ended', async () => {
    const onLeave = jest.fn();
    api.listEvents.mockResolvedValue([{ ...event, status: 'ended' }] as any);
    show(onLeave);
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  });

  it('leaves when a refresh finds that the event has ended', async () => {
    const onLeave = jest.fn();
    api.listEvents.mockResolvedValue([event] as any);
    const intervalSpy = jest.spyOn(window, 'setInterval');

    try {
      show(onLeave);
      await screen.findByText('Emergency Service Meeting');
      api.listEvents.mockResolvedValue([{ ...event, status: 'ended' }] as any);

      const refresh = intervalSpy.mock.calls.find(
        ([, delay]) => delay === LIST_POLL_MS
      )?.[0];
      expect(typeof refresh).toBe('function');
      if (typeof refresh !== 'function') {
        throw new Error('Attendee event refresh interval was not registered');
      }

      await act(async () => { await refresh(); });
      expect(onLeave).toHaveBeenCalledTimes(1);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it('leaves immediately when the event-ended room message arrives', async () => {
    const onLeave = jest.fn();
    window.localStorage.setItem('access_token', 'valid-access-token');
    show(onLeave);
    await screen.findByText('Emergency Service Meeting');
    expect(window.localStorage.getItem('access_token')).toBe('valid-access-token');
    await waitFor(() => expect(api.joinEvent).toHaveBeenCalledWith('ABC-123'));

    const socket = (window as any).__attendeeSocket;
    expect(socket).not.toBeNull();
    socket.onmessage({ data: JSON.stringify({ type: 'event_ended' }) });

    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('sends activity heartbeats and leaves when the server evicts an idle attendee', async () => {
    const onLeave = jest.fn();
    window.localStorage.setItem('access_token', 'valid-access-token');
    show(onLeave);
    await screen.findByText('Emergency Service Meeting');
    await waitFor(() => expect((window as any).__attendeeSocket).not.toBeNull());

    const socket = (window as any).__attendeeSocket;
    act(() => socket.onopen());
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'heartbeat' })
    );

    act(() => socket.onmessage({
      data: JSON.stringify({ type: 'idle_evicted', reason: 'idle' }),
    }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('leaves when the attendee membership check no longer finds the live event', async () => {
    const onLeave = jest.fn();
    const intervalSpy = jest.spyOn(window, 'setInterval');
    try {
      show(onLeave);
      await screen.findByText('Emergency Service Meeting');
      await waitFor(() => expect(api.joinEvent).toHaveBeenCalledWith('ABC-123'));
      api.getActiveEvents.mockResolvedValue([]);

      const check = intervalSpy.mock.calls.find(
        ([, delay]) => delay === 60000
      )?.[0];
      expect(typeof check).toBe('function');
      if (typeof check !== 'function') {
        throw new Error('One-minute attendee membership check was not registered');
      }

      await act(async () => { await check(); });
      expect(onLeave).toHaveBeenCalledTimes(1);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it('does not show a Leave room button on any live-room tab', async () => {
    show();
    const bar = await screen.findByRole('navigation', { name: 'Sections' });
    const tabs = ['Transcript', 'Agenda', 'Q&A', 'Files', 'Profile'];

    for (const tab of tabs) {
      fireEvent.click(within(bar).getByRole('button', { name: tab }));
      if (tab === 'Transcript') {
        expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole('button', { name: /Leave room|Leave/ })).toBeNull();
      }
    }
  });

  /** Somebody opening this in a hall is almost always in the live one. */
  it('lands on the event that is running', async () => {
    api.listEvents.mockResolvedValue([
      { ...event, id: 'e0', title: 'Last week', status: 'ended' },
      event,
    ] as any);
    show();

    expect(
      await screen.findByText('Emergency Service Meeting')
    ).toBeInTheDocument();
  });
});

describe('the transcript', () => {
  /** Where the room has got to, not only what it said. */
  it('marks the last line as what is being said now', async () => {
    api.getEventSegments.mockResolvedValue([
      { text: 'Said a while ago.', speaker_name: 'Sarah',
        created_at: '2026-09-15T04:20:00Z' },
      { text: 'Being said now.', speaker_name: 'David',
        created_at: '2026-09-15T04:21:00Z' },
    ] as any);

    await go('Transcript');

    const now = (await screen.findByText('Being said now.'))
      .closest('[data-transcript-line]') as HTMLElement;
    expect(within(now).getByText('Speaking')).toBeInTheDocument();

    const before = screen.getByText('Said a while ago.')
      .closest('[data-transcript-line]') as HTMLElement;
    expect(within(before).queryByText('Speaking')).toBeNull();
  });

  /** Nothing is being said in a room that is over. */
  it('marks nothing where the event has ended', async () => {
    api.listEvents.mockResolvedValue([{ ...event, status: 'ended' }] as any);
    api.getEventSegments.mockResolvedValue([
      { text: 'The last thing said.', speaker_name: 'Sarah',
        created_at: '2026-09-15T04:21:00Z' },
    ] as any);

    await go('Transcript');
    await screen.findByText('The last thing said.');

    expect(screen.queryByText('Speaking')).toBeNull();
  });

  it('names what is on stage', async () => {
    show();

    expect(
      await screen.findByText('Emergency Response Overview')
    ).toBeInTheDocument();
    expect(screen.getByText('Current agenda')).toBeInTheDocument();
  });

  it('shows what has been said', async () => {
    api.getEventSegments.mockResolvedValue([{
      speaker_name: 'Sarah', text: 'Good morning everyone.',
      start_time: 0, end_time: 3, is_final: true, confidence: 1,
      created_at: '2026-09-15T04:30:00Z',
    }] as any);
    show();

    expect(await screen.findByText('Good morning everyone.')).toBeInTheDocument();
    expect(screen.getByText('Sarah')).toBeInTheDocument();
  });

  it('says so plainly where nothing has been said', async () => {
    show();

    expect(
      await screen.findByText('Nothing has been said yet.')
    ).toBeInTheDocument();
  });
});

describe('the agenda', () => {
  it('lists the running order', async () => {
    await go('Agenda');

    expect(
      await screen.findByText('Emergency Response Overview')
    ).toBeInTheDocument();
    expect(screen.getByText(/Sarah Johnson/)).toBeInTheDocument();
  });

  /**
   * The point of the screen. A programme read straight through is a
   * list; read under the host's own headings it is a shape.
   */
  it('reads it under the parts the host grouped it into', async () => {
    api.getSubEvents.mockResolvedValue([
      { id: 'g1', event: 'e1', title: 'Emergency', description: '',
        position: 0, sessions: [], created_at: '', updated_at: '' },
      { id: 'g2', event: 'e1', title: 'SOS', description: '',
        position: 1, sessions: [], created_at: '', updated_at: '' },
    ] as any);
    api.listSessions.mockResolvedValue([
      session({ id: 's1', title: 'Response Overview', sub_event: 'g1' }),
      session({ id: 's2', title: 'Rescue Drill', sub_event: 'g2',
        status: 'scheduled' }),
    ] as any);

    await go('Agenda');

    const sos = (await screen.findByText('SOS')).closest('section')!;
    expect(within(sos).getByText('Rescue Drill')).toBeInTheDocument();
    expect(within(sos).queryByText('Response Overview')).toBeNull();
  });

  /** An ungrouped talk is still on the programme, not lost off it. */
  it('keeps an ungrouped talk where it can still be read', async () => {
    api.getSubEvents.mockResolvedValue([
      { id: 'g1', event: 'e1', title: 'Emergency', description: '',
        position: 0, sessions: [], created_at: '', updated_at: '' },
    ] as any);
    api.listSessions.mockResolvedValue([
      session({ id: 's1', title: 'Response Overview', sub_event: 'g1' }),
      session({ id: 's2', title: 'Loose Talk', sub_event: null,
        status: 'scheduled' }),
    ] as any);

    await go('Agenda');

    const loose = (await screen.findByText('Everything else')).closest('section')!;
    expect(within(loose).getByText('Loose Talk')).toBeInTheDocument();
  });

  it('says how far along each talk is', async () => {
    api.listSessions.mockResolvedValue([
      session({ id: 's1', title: 'Response Overview', status: 'done' }),
      session({ id: 's2', title: 'Rescue Drill', status: 'scheduled' }),
    ] as any);

    await go('Agenda');

    const done = (await screen.findByText('Response Overview'))
      .closest('button')!;
    expect(within(done).getByText('Completed')).toBeInTheDocument();
    const next = screen.getByText('Rescue Drill').closest('button')!;
    expect(within(next).getByText('Upcoming')).toBeInTheDocument();
  });

  it('counts what has been asked and filed against each talk', async () => {
    api.getHub.mockResolvedValue({
      questions: [post({ id: 'h1', session_id: 's1' })],
      ideas: [], suggestions: [],
    } as any);
    api.getResources.mockResolvedValue([
      { id: 'a1', session: 's1', display_name: 'Deck.pdf', file_size: 10,
        web_view_link: '' },
      { id: 'a2', session: 's1', display_name: 'Notes.pdf', file_size: 10,
        web_view_link: '' },
    ] as any);

    await go('Agenda');

    expect(
      await screen.findByText('1 question · 2 files')
    ).toBeInTheDocument();
  });

  it('opens one on its summary', async () => {
    await go('Agenda');
    fireEvent.click(await screen.findByText('Emergency Response Overview'));

    expect(screen.queryByRole('heading', { name: 'Agenda' })).toBeNull();
    const back = screen.getAllByRole('button', { name: 'Agenda' })
      .find((button) => button.closest('header'))!;
    expect(back).toBeInTheDocument();
    expect(back.closest('header')).toHaveClass(
      'attendee-live-room-agenda-detail-header'
    );
    expect(
      await screen.findByText(/how the response was coordinated/)
    ).toBeInTheDocument();
  });

  it('and offers the speaker beside it', async () => {
    await go('Agenda');
    fireEvent.click(await screen.findByText('Emergency Response Overview'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Speaker' }));

    expect(screen.getByText('Sarah Johnson')).toBeInTheDocument();
    expect(
      screen.getByText('Director of Emergency Management')
    ).toBeInTheDocument();
  });

  /** Only a published summary reaches an attendee. */
  it('says nothing has been published where nothing has', async () => {
    api.getSessionSummary.mockRejectedValue(new Error('not published'));
    await go('Agenda');
    fireEvent.click(await screen.findByText('Emergency Response Overview'));

    expect(
      await screen.findByText(/No summary has been published/)
    ).toBeInTheDocument();
  });
});

describe('the board', () => {
  it('shows what has been asked', async () => {
    api.getHub.mockResolvedValue({
      questions: [post()], ideas: [], suggestions: [],
    } as any);
    await go('Q&A');

    expect(
      await screen.findByText(/How are the delays being addressed/)
    ).toBeInTheDocument();
  });

  it('groups questions and suggestions under their linked agendas', async () => {
    api.listSessions.mockResolvedValue([
      session({ id: 's1', title: 'Opening agenda' }),
      session({ id: 's2', title: 'Closing agenda' }),
    ] as any);
    api.getHub.mockResolvedValue({
      questions: [
        post({ id: 'q1', body: 'Opening question', session_id: 's1' }),
        post({ id: 'q2', body: 'Closing question', session_id: 's2' }),
      ],
      ideas: [],
      suggestions: [
        post({
          id: 'suggestion-1', kind: 'suggestion', body: 'Closing suggestion',
          session_id: 's2',
        }),
      ],
    } as any);
    await go('Q&A');

    const opening = (await screen.findByRole('heading', { name: 'Opening agenda' }))
      .closest('section') as HTMLElement;
    const closing = screen.getByRole('heading', { name: 'Closing agenda' })
      .closest('section') as HTMLElement;
    expect(within(opening).getByText('Opening question')).toBeInTheDocument();
    expect(within(opening).queryByText('Closing question')).toBeNull();
    expect(within(closing).getByText('Closing question')).toBeInTheDocument();
    expect(within(closing).queryByText('Opening question')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Suggestions' }));
    const suggestionAgenda = screen.getByRole('heading', { name: 'Closing agenda' })
      .closest('section') as HTMLElement;
    expect(within(suggestionAgenda).getByText('Closing suggestion'))
      .toBeInTheDocument();
  });

  it('shows the Figma pending approval card and omits rejected posts', async () => {
    api.getHub.mockResolvedValue({
      questions: [
        post({ status: 'pending', mine: true, body: 'Waiting for approval' }),
        post({ id: 'rejected', status: 'declined', body: 'Rejected question' }),
      ],
      ideas: [],
      suggestions: [],
    } as any);
    await go('Q&A');

    expect(await screen.findByText('Pending approval')).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('Rejected question')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vote up' })).toBeNull();
  });

  it('asks one from the sheet', async () => {
    api.addHubPost.mockResolvedValue(post() as any);
    await go('Q&A');

    fireEvent.click(await screen.findByRole('button', { name: /Ask a question/ }));
    fireEvent.change(screen.getByLabelText('Your question'), {
      target: { value: 'When does the next session start?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit question' }));

    await waitFor(() => expect(api.addHubPost).toHaveBeenCalledWith(
      'ABC-123',
      { kind: 'question', body: 'When does the next session start?' }
    ));
  });

  it('will not send an empty one', async () => {
    await go('Q&A');
    fireEvent.click(await screen.findByRole('button', { name: /Ask a question/ }));

    expect(screen.getByRole('button', { name: 'Submit question' })).toBeDisabled();
  });

  /**
   * A vote sorts a queue: it says which question most wants answering.
   * Nobody reads suggestions in order, so a tally against one measures
   * nothing.
   */
  it('carries a vote on a question', async () => {
    api.getHub.mockResolvedValue({
      questions: [post()], ideas: [], suggestions: [],
    } as any);
    await go('Q&A');

    expect(
      await screen.findByRole('button', { name: 'Vote up' })
    ).toBeInTheDocument();
  });

  it('carries none on a suggestion', async () => {
    api.getHub.mockResolvedValue({
      questions: [],
      ideas: [],
      suggestions: [post({ id: 'h2', kind: 'suggestion', body: 'Print larger maps.' })],
    } as any);
    await go('Q&A');
    fireEvent.click(await screen.findByRole('button', { name: 'Suggestions' }));

    expect(await screen.findByText('Print larger maps.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vote up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vote down' })).toBeNull();
  });
});

describe('the files', () => {
  const pdf = {
    id: 'a1', event_id: 'e1', artifact_type: 'resource',
    display_name: 'Response Plan.pdf', file_size: 4404019,
    sync_status: 'synced', session: 's1',
    web_view_link: 'https://drive.example/a1',
    created_at: '2026-09-15T04:00:00Z',
  } as any;

  /**
   * Under the talk, not merely present.
   *
   * Asserted by putting a file against no talk at all beside one that
   * has a talk: a test that only looks for the heading and the name
   * passes whether the grouping works or not.
   */
  it('groups them under the talk they belong to', async () => {
    api.getResources.mockResolvedValue([
      pdf,
      { ...pdf, id: 'a2', display_name: 'Venue Map.pdf', session: null },
    ] as any);
    await go('Files');

    await screen.findByText('Response Plan.pdf');
    const talk = screen.getByRole('heading', {
      name: 'Emergency Response Overview',
    }).closest('section') as HTMLElement;

    expect(within(talk).getByText('Response Plan.pdf')).toBeInTheDocument();
    expect(within(talk).queryByText('Venue Map.pdf')).toBeNull();

    const loose = screen.getByRole('heading', { name: 'For the event' })
      .closest('section') as HTMLElement;
    expect(within(loose).getByText('Venue Map.pdf')).toBeInTheDocument();
  });

  it('offers a way to take one away', async () => {
    api.getResources.mockResolvedValue([pdf] as any);
    await go('Files');

    expect(
      await screen.findByRole('link', { name: 'Open Response Plan.pdf' })
    ).toHaveAttribute('href', 'https://drive.example/a1');
  });

  /** An attendee takes a copy away and adds nothing. */
  it('offers no way to add one', async () => {
    api.getResources.mockResolvedValue([pdf] as any);
    await go('Files');
    await screen.findByText('Response Plan.pdf');

    expect(screen.queryByRole('button', { name: /Add|Upload/ })).toBeNull();
  });

  it('shows the no-files message in the live room', async () => {
    await go('Files');
    expect(await screen.findByText('No files added yet.')).toBeInTheDocument();
  });

  it('opens a folder of photographs', async () => {
    api.getPhotos.mockResolvedValue({
      folders: [{
        id: 'f1', name: 'Event Opening', is_default: false, created_by: 'x',
        is_mine: false, photo_count: 2, created_at: '',
      }],
      photos: [],
    } as any);
    await go('Files');

    fireEvent.click(await screen.findByRole('button', { name: 'Photos' }));
    fireEvent.click(await screen.findByText('Event Opening'));

    expect(
      await screen.findByRole('heading', { name: 'Event Opening' })
    ).toBeInTheDocument();
  });

  describe('attendee notifications', () => {
    it('shows the 10 newest notifications first and paginates older ones', async () => {
      api.getReminders.mockResolvedValue({
        reminders: Array.from({ length: 12 }, (_, index) => ({
          id: `r${index}`,
          kind: index % 2 === 0 ? 'event' : 'session',
          event_title: `Notification ${index}`,
          session_title: `Agenda ${index}`,
          due_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        })),
        unread: 0,
      } as any);
      render(
        <OrganizerProvider>
          <NotificationsScreen onRead={jest.fn()} />
        </OrganizerProvider>
      );

      const rows = await screen.findAllByRole('listitem');
      expect(rows).toHaveLength(10);
      expect(rows[0]).toHaveTextContent('Notification 11');
      expect(rows[9]).toHaveTextContent('Notification 2');
      expect(screen.queryByText(/Notification 1 is about to begin/)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      const older = screen.getAllByRole('listitem');
      expect(older).toHaveLength(2);
      expect(older[0]).toHaveTextContent('Notification 1');
      expect(older[1]).toHaveTextContent('Notification 0');
    });
  });
});

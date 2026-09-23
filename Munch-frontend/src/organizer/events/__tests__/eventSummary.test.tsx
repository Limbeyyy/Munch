import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { EventSummary } from '../EventSummary';
import { apiClient } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  apiClient: {
    getAttendanceReport: jest.fn(),
    listSessions: jest.fn(),
    getSessionSummary: jest.fn(),
    getModerationQueue: jest.fn(),
    getResources: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const event = {
  id: 'm1', code: 'EMG-1', title: 'Emergency Service Meeting',
  status: 'ended', venue: 'Kathmandu Convention Center',
  scheduled_start: '2026-09-15T04:15:00Z',
  scheduled_end: '2026-09-15T06:15:00Z',
  session_count: 3, participant_count: 8,
} as any;

const session = (over: any = {}) => ({
  id: 's1', event: 'm1', title: 'Post-disaster Assessment',
  speaker_name: 'Anita Rai', starts_at: '2026-09-15T08:15:00Z',
  duration_minutes: 30, status: 'done',
  ...over,
}) as any;

const message = (over: any = {}) => ({
  id: 'q1', body: 'How are the communication delays being addressed?',
  sender_name: 'Suman Karki', sender_is_guest: false, sender_id: 'u1',
  sender_email: null, recipient_id: null, recipient_name: null,
  recipient_is_guest: false, is_direct: true, topic: 'faq',
  session: 's1', session_title: 'Post-disaster Assessment',
  created_at: '2026-09-15T08:27:00Z',
  ...over,
}) as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getAttendanceReport.mockResolvedValue({
    expected_total: 10, attended_count: 8, absent_count: 2,
    attended: [
      {
        type: 'user', name: 'Suman Karki', email: null, phone: null,
        role: 'attendee', joined_at: '2026-09-15T08:16:00Z',
        left_at: '2026-09-15T10:01:00Z', is_active: false, was_invited: true,
      },
    ],
    did_not_attend: [],
  } as any);
  api.listSessions.mockResolvedValue([session()] as any);
  api.getSessionSummary.mockResolvedValue({
    session: 's1', session_title: 'Post-disaster Assessment',
    body: 'The post-disaster assessment covered response time metrics.',
    actions: [{ task: 'Finalize shelter resource clearance', owner: 'Anita', due: '' }],
    status: 'published', is_published: true, saved: true,
    published_at: '2026-09-15T09:00:00Z',
  } as any);
  api.getModerationQueue.mockResolvedValue({
    pending: [],
    approved: [message()],
    rejected: [message({
      id: 'q2', body: 'Is there a backup protocol?', sender_name: 'Meena Basnet',
    })],
    sessions: [],
  } as any);
  api.getResources.mockResolvedValue([{
    id: 'a1', event_id: 'm1', artifact_type: 'resource',
    display_name: 'Assessment Report Q3.pdf', file_size: 1200,
    sync_status: 'synced', uploaded_by_name: 'Anita',
    web_view_link: 'https://drive.example/a1',
    created_at: '2026-09-15T08:00:00Z',
  }] as any);
});

const show = () =>
  render(
    <OrganizerProvider>
      <EventSummary event={event} onBack={jest.fn()} />
    </OrganizerProvider>
  );

const openTab = async (name: string) => {
  show();
  await screen.findByRole('tab', { name: 'Overview' });
  fireEvent.click(screen.getByRole('tab', { name }));
};

/**
 * A finished event, read back.
 *
 * Nothing here can be changed - the event has run and the decisions were
 * made while it was running - so every tab is a reading rather than a
 * screen with controls on it.
 */
describe('reading a finished event back', () => {
  it('heads it with the event, its hours and its room', async () => {
    show();

    expect(await screen.findByRole('heading', {
      name: 'Emergency Service Meeting',
    })).toBeInTheDocument();
    expect(screen.getByText(/Kathmandu Convention Center/)).toBeInTheDocument();
  });

  it('offers the six readings of it', async () => {
    show();
    await screen.findByRole('tab', { name: 'Overview' });

    ['Overview', 'Attendance', 'Agenda', 'Questions', 'Suggestions', 'Resources']
      .forEach((name) => {
        expect(screen.getByRole('tab', { name })).toBeInTheDocument();
      });
  });
});

describe('the overview', () => {
  it('counts what the event came to', async () => {
    show();

    const figure = await screen.findByText('8/10');
    // The rate is said twice on this tab - under the figure and again in
    // the attendance block - so it is read out of the figure it belongs to.
    expect(figure.parentElement).toHaveTextContent('80%');
  });

  /** Questions and suggestions are counted apart, as two boards. */
  it('counts the two boards separately', async () => {
    api.getModerationQueue.mockResolvedValue({
      pending: [],
      approved: [message(), message({ id: 'q3', topic: 'suggestion' })],
      rejected: [],
      sessions: [],
    } as any);
    show();

    const questions = await screen.findByText('Questions', { selector: 'span' });
    expect(questions.parentElement).toHaveTextContent('1');
  });

  it('sets each agenda beside what was written about it', async () => {
    show();

    expect(await screen.findByText('Post-disaster Assessment')).toBeInTheDocument();
    expect(
      screen.getByText(/The post-disaster assessment covered/)
    ).toBeInTheDocument();
  });

  /** An agenda nobody wrote up still appears; it says so instead. */
  it('says where nothing was written', async () => {
    api.getSessionSummary.mockResolvedValue({
      session: 's1', session_title: 'Post-disaster Assessment', body: '',
      actions: [], status: 'needs_approval', is_published: false, saved: false,
      published_at: null,
    } as any);
    show();

    expect(
      await screen.findByText('No summary was written for this agenda.')
    ).toBeInTheDocument();
  });
});

describe('the attendance', () => {
  it('counts who was asked, who came and who did not', async () => {
    await openTab('Attendance');

    const invited = await screen.findByText('Invited');
    expect(invited.parentElement).toHaveTextContent('10');
    const noshow = screen.getByText('No-show');
    expect(noshow.parentElement).toHaveTextContent('2');
  });

  it('names each person, and how long they stayed', async () => {
    await openTab('Attendance');

    const row = (await screen.findByText('Suman Karki')).closest('tr')!;
    expect(within(row).getByText('Attended')).toBeInTheDocument();
    expect(within(row).getByText('1h 45m')).toBeInTheDocument();
  });
});

describe('the agenda', () => {
  it('opens one to read what it settled', async () => {
    await openTab('Agenda');

    fireEvent.click(await screen.findByRole('button', { expanded: false }));

    // 'Overview' is also the first tab, so the label is looked for as a
    // section heading rather than anywhere on the page.
    expect(screen.getByText('Overview', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Action items')).toBeInTheDocument();
    expect(
      screen.getByText(/Finalize shelter resource clearance/)
    ).toBeInTheDocument();
  });

  /** One at a time: opening the next closes the one before it. */
  it('keeps one open at a time', async () => {
    api.listSessions.mockResolvedValue([
      session(), session({ id: 's2', title: 'Resource Allocation Review' }),
    ] as any);
    await openTab('Agenda');

    const headers = await screen.findAllByRole('button', { expanded: false });
    fireEvent.click(headers[0]);
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1);
  });

  /** And pressing the open one shuts it, rather than leaving it open. */
  it('closes the one that is open', async () => {
    await openTab('Agenda');

    fireEvent.click(await screen.findByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { expanded: true }));

    expect(screen.queryByRole('button', { expanded: true })).toBeNull();
    expect(screen.queryByText('Action items')).toBeNull();
  });
});

describe('the boards', () => {
  it('shows what was asked, with what became of it', async () => {
    await openTab('Questions');

    expect(
      await screen.findByText(/How are the communication delays/)
    ).toBeInTheDocument();
    expect(screen.getByText('Suman K.')).toBeInTheDocument();
    // Both words are also pills over the list, so each is read off the
    // entry it is the verdict on.
    const asked = screen.getByText(/How are the communication delays/)
      .parentElement as HTMLElement;
    expect(within(asked).getByText('Approved')).toBeInTheDocument();
    const other = screen.getByText(/Is there a backup protocol/)
      .parentElement as HTMLElement;
    expect(within(other).getByText('Rejected')).toBeInTheDocument();
  });

  it('narrows to one pile', async () => {
    await openTab('Questions');
    await screen.findByText(/How are the communication delays/);

    fireEvent.click(screen.getByRole('button', { name: /Rejected/ }));

    expect(screen.queryByText(/How are the communication delays/)).toBeNull();
    expect(screen.getByText(/Is there a backup protocol/)).toBeInTheDocument();
  });

  /** The decisions were made while it ran; this is only the record. */
  it('offers no way to change a decision', async () => {
    await openTab('Questions');
    await screen.findByText(/How are the communication delays/);

    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('keeps a suggestion off the questions board', async () => {
    api.getModerationQueue.mockResolvedValue({
      pending: [],
      approved: [message({ id: 'q4', topic: 'suggestion', body: 'Print larger maps.' })],
      rejected: [],
      sessions: [],
    } as any);
    await openTab('Questions');

    expect(await screen.findByText('Nothing here.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Suggestions' }));

    expect(screen.getByText(/Print larger maps/)).toBeInTheDocument();
  });
});

describe('the resources', () => {
  it('lists what was shared, and who shared it', async () => {
    await openTab('Resources');

    expect(await screen.findByText('Assessment Report Q3.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Uploaded by Anita/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href', 'https://drive.example/a1'
    );
  });
});

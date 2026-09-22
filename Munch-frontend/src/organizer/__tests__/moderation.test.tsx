import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { ModerationView } from '../views/ModerationView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getModerationQueue: jest.fn(),
    moderateMessage: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const event = (over: any = {}) => ({
  id: 'm1', title: 'Emergency Service Meeting', code: 'IRL-NH7',
  status: 'active',
  venue: 'Kathmandu Convention Center',
  session_count: 3,
  scheduled_start: '2026-09-08T03:30:00Z',
  scheduled_end: '2026-09-08T09:00:00Z',
  ...over,
}) as any;

const message = (over: any = {}) => ({
  id: 'q1',
  body: 'How do you see the communication delays being resolved?',
  sender_name: 'John Dahal',
  sender_is_guest: true,
  sender_id: 'g1',
  sender_email: null,
  recipient_id: 'h1',
  recipient_name: 'Sarah Sharma',
  recipient_is_guest: false,
  is_direct: true,
  topic: 'faq',
  moderation_status: 'pending',
  session: 's1',
  session_title: 'Field Response Coordination',
  moderated_by_name: null,
  moderated_at: null,
  created_at: new Date(Date.now() - 120000).toISOString(),
  ...over,
});

const queue = (over: any = {}) => ({
  pending: [], approved: [], rejected: [],
  sessions: [
    { id: 's1', title: 'Field Response Coordination', speaker: 'David Thapa' },
    { id: 's2', title: 'Resource Allocation', speaker: 'Mina Rai' },
  ],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getModerationQueue.mockResolvedValue(queue({ pending: [message()] }) as any);
});

const show = (events = [event()]) =>
  render(
    <OrganizerProvider>
      <ModerationView events={events} />
    </OrganizerProvider>
  );

/** Getting from the list of events to one event's queue. */
const moderate = async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Moderate' }));
};

/**
 * The first screen: which events there is anything to moderate on.
 *
 * A queue fills while people are in the room. An event that has not
 * opened has nothing in it, and one that has ended has nothing arriving,
 * so neither is offered here.
 */
describe('the list of events to moderate', () => {
  it('names a running event and offers to moderate it', async () => {
    show();

    expect(await screen.findByText('Emergency Service Meeting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Moderate' })).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('leaves out an event that is not running', async () => {
    show([
      event(),
      event({ id: 'm2', title: 'Budget Hearing', status: 'ended', started_at: '2026-09-08T03:30:00Z' }),
    ]);
    await screen.findByText('Emergency Service Meeting');

    expect(screen.queryByText('Budget Hearing')).toBeNull();
  });

  it('says so plainly where nothing is running', async () => {
    show([event({ status: 'scheduled' })]);

    expect(
      await screen.findByText('Nothing is running just now.')
    ).toBeInTheDocument();
  });

  it('counts what is waiting on each event', async () => {
    api.getModerationQueue.mockResolvedValue(queue({
      pending: [message(), message({ id: 'q2', topic: 'suggestion' })],
    }) as any);
    show();

    expect(await screen.findByText('1 questions')).toBeInTheDocument();
    expect(screen.getByText('1 suggestions')).toBeInTheDocument();
  });

  it('narrows the list by what is typed', async () => {
    show([event(), event({ id: 'm2', title: 'Budget Hearing' })]);
    await screen.findByText('Budget Hearing');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'budget' } });

    expect(screen.queryByText('Emergency Service Meeting')).toBeNull();
    expect(screen.getByText('Budget Hearing')).toBeInTheDocument();
  });
});

/** The second screen: one event's queue. */
describe('one event under moderation', () => {
  it('heads the screen with the event, its hours and its room', async () => {
    await moderate();

    expect(await screen.findByRole('heading', {
      name: 'Emergency Service Meeting',
    })).toBeInTheDocument();
    expect(
      screen.getByText(/Kathmandu Convention Center/)
    ).toBeInTheDocument();
  });

  it('offers the two boards and the three piles', async () => {
    await moderate();
    await screen.findByRole('tab', { name: 'Q&A' });

    expect(screen.getByRole('tab', { name: 'Suggestions' })).toBeInTheDocument();
    ['Pending', 'Rejected', 'Approved'].forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
  });

  it('groups what is waiting under the talk it was asked during', async () => {
    await moderate();

    const header = await screen.findByRole('button', { expanded: true });
    expect(header).toHaveTextContent('Field Response Coordination');
    expect(header).toHaveTextContent('David Thapa');
    expect(header).toHaveTextContent('1 pending');
  });

  /** An agenda nothing was asked under is not a row to read past. */
  it('leaves out an agenda with nothing in it', async () => {
    await moderate();
    await screen.findByRole('button', { expanded: true });

    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1);
  });

  it('shortens who asked, and says how long ago', async () => {
    await moderate();

    expect(await screen.findByText('John D.')).toBeInTheDocument();
    expect(screen.getByText('2 min ago')).toBeInTheDocument();
  });

  it('puts one up', async () => {
    api.moderateMessage.mockResolvedValue({} as any);
    await moderate();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(api.moderateMessage).toHaveBeenCalledWith('m1', 'q1', 'approve')
    );
  });

  it('turns one down', async () => {
    api.moderateMessage.mockResolvedValue({} as any);
    await moderate();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(api.moderateMessage).toHaveBeenCalledWith('m1', 'q1', 'decline')
    );
  });

  /** The decision has been made; there is nothing left to press. */
  it('offers no decision on something already put up', async () => {
    api.getModerationQueue.mockResolvedValue(queue({
      approved: [message({
        moderation_status: 'approved',
        moderated_by_name: 'Sarah Sharma',
        moderated_at: new Date(Date.now() - 360000).toISOString(),
      })],
    }) as any);
    await moderate();
    fireEvent.click(await screen.findByRole('button', { name: 'Approved' }));

    expect(await screen.findByText(/Approved by Sarah Sharma/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  /** Choosing one agenda is choosing the heading, so it is not repeated. */
  it('drops the grouping once a single agenda is chosen', async () => {
    await moderate();
    await screen.findByText('David Thapa');

    fireEvent.change(screen.getByLabelText('Agendas'), { target: { value: 's1' } });

    expect(screen.queryByText('David Thapa')).toBeNull();
    expect(screen.getByText(/communication delays/)).toBeInTheDocument();
  });

  it('keeps a suggestion off the questions board', async () => {
    api.getModerationQueue.mockResolvedValue(queue({
      pending: [message({ id: 'q2', topic: 'suggestion', body: 'Print the maps larger' })],
    }) as any);
    await moderate();

    expect(
      await screen.findByText('No pending q&a')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Suggestions' }));

    expect(screen.getByText(/Print the maps larger/)).toBeInTheDocument();
  });

  it('says what an empty pile is empty of', async () => {
    api.getModerationQueue.mockResolvedValue(queue() as any);
    await moderate();
    fireEvent.click(await screen.findByRole('button', { name: 'Approved' }));

    expect(screen.getByText('No approved q&a')).toBeInTheDocument();
    expect(
      screen.getByText('New attendee questions will appear here for review.')
    ).toBeInTheDocument();
  });

  it('goes back to the list of events', async () => {
    await moderate();
    fireEvent.click(await screen.findByRole('button', { name: '‹ All events' }));

    expect(screen.getByRole('button', { name: 'Moderate' })).toBeInTheDocument();
  });
});

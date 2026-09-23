import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RoomQuestions } from '../RoomQuestions';
import { OrganizerProvider } from '../i18n';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getEventBoard: jest.fn(),
    getGuestBoard: jest.fn(),
    getPendingMessages: jest.fn(),
    getReviewedMessages: jest.fn(),
    sortMessage: jest.fn(),
    moderateMessage: jest.fn(),
    voteOnBoard: jest.fn(),
    guestVoteOnBoard: jest.fn(),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn(),
  }),
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const entry = (over: any = {}) => ({
  id: 'q1',
  body: 'What is the purpose of spending all those budget on this agenda alone?',
  asked_by: 'Rahul Ingnam',
  asker_is_guest: false,
  was_direct: true,
  sent_to: 'The host',
  score: 12,
  my_vote: 0,
  answer: '',
  answered_by: '',
  answered_at: null,
  ...over,
});

const held = (over: any = {}) => ({
  id: 'm1',
  body: 'Please slow down the transcript speed',
  created_at: new Date().toISOString(),
  is_direct: true,
  moderation_status: 'pending',
  sender_id: 'g1',
  sender_name: 'Rahul Ingnam',
  sender_email: null,
  sender_is_guest: true,
  recipient_id: 'u1',
  recipient_name: 'Dr Darpan Pandey',
  recipient_is_guest: false,
  ...over,
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getEventBoard.mockResolvedValue({ faq: [entry()], suggestions: [] } as any);
  api.getPendingMessages.mockResolvedValue([held()] as any);
  api.getReviewedMessages.mockResolvedValue({ from_users: [], from_guests: [] } as any);
});

const show = (props: any = {}) =>
  render(
    <OrganizerProvider>
      <RoomQuestions eventId="m1" {...props} />
    </OrganizerProvider>
  );

/**
 * The board as the room sees it.
 *
 * A question, what the room thinks of it, and a vote either way. Not the
 * asker's name, and not who they wrote to - that is between them and the
 * host.
 */
describe('the questions panel', () => {
  it('shows a question with its score and a vote each way', async () => {
    show();

    expect(await screen.findByText(/purpose of spending/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vote up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vote down' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('says nothing about who asked, or who they asked', async () => {
    show();
    await screen.findByText(/purpose of spending/);

    expect(screen.queryByText(/Rahul Ingnam/)).toBeNull();
    expect(screen.queryByText(/The host/)).toBeNull();
  });

  it('sends a vote and takes the board back', async () => {
    api.voteOnBoard.mockResolvedValue({ faq: [entry({ score: 13, my_vote: 1 })], suggestions: [] } as any);
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Vote up' }));

    await waitFor(() => expect(api.voteOnBoard).toHaveBeenCalledWith('m1', 'q1', 1));
    expect(await screen.findByText('13')).toBeInTheDocument();
  });

  it('marks the arrow the reader has already used', async () => {
    api.getEventBoard.mockResolvedValue(
      { faq: [entry({ my_vote: 1 })], suggestions: [] } as any
    );
    show();

    expect(await screen.findByRole('button', { name: 'Vote up' }))
      .toHaveAttribute('aria-pressed', 'true');
  });
});


describe('a guest reading the same board', () => {
  it('reads it with the token they hold, and sorts nothing', async () => {
    api.getGuestBoard.mockResolvedValue({ faq: [entry()], suggestions: [] } as any);

    render(
      <OrganizerProvider>
        <RoomQuestions guestToken="tok" />
      </OrganizerProvider>
    );

    await waitFor(() => expect(api.getGuestBoard).toHaveBeenCalledWith('tok'));
    // Questions and Suggestions, and no queue to sort.
    expect(await screen.findAllByRole('tab')).toHaveLength(2);
    expect(screen.queryByRole('tab', { name: /Requests/ })).toBeNull();
  });
});

/**
 * The queue that used to live here has a container of its own.
 *
 * Every message in the room is written to the host, and somebody has to
 * decide whether it goes up. That decision is made on the Message
 * Request card in live control - a place dedicated to it - and having a
 * second copy of the same queue inside the questions panel meant two
 * lists of the same thing, each able to go stale while the other was
 * acted on.
 */
describe('what is waiting for the host', () => {
  it('is not a tab in here', async () => {
    show({ canSort: true });
    await screen.findByText(/purpose of spending/);

    expect(screen.queryByRole('tab', { name: /Requests/ })).toBeNull();
  });

  it('leaves the two boards, and the composer under them', async () => {
    show({ canSort: true, onAsk: jest.fn() });
    await screen.findByText(/purpose of spending/);

    expect(screen.getByRole('tab', { name: /Questions/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Suggestions/ })).toBeInTheDocument();
  });
});

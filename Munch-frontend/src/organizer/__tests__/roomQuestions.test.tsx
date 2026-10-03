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

  it('does not let the host cast a vote', async () => {
    show({ canSort: true, canVote: false });

    expect(await screen.findByText(/purpose of spending/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vote up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vote down' })).toBeNull();
    expect(api.voteOnBoard).not.toHaveBeenCalled();
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

describe('requests inside the live room boards', () => {
  it('shows question requests under Questions and increments its tab count', async () => {
    api.getPendingMessages.mockResolvedValue([
      held({ topic: 'faq', body: 'What time is it today?' }),
    ] as any);
    show({ canSort: true });

    expect(await screen.findByRole('tab', { name: 'Questions (2)' }))
      .toBeInTheDocument();
    expect(screen.getByText('REQUESTS')).toBeInTheDocument();
    expect(screen.getByText('What time is it today?')).toBeInTheDocument();
    expect(screen.queryByText('Please slow down the transcript speed')).toBeNull();
  });

  it('keeps suggestion requests in Suggestions, with no vote controls', async () => {
    api.getPendingMessages.mockResolvedValue([
      held({ topic: 'suggestion', body: 'Please add a map.' }),
    ] as any);
    show({ canSort: true });
    fireEvent.click(screen.getByRole('tab', { name: /Suggestions/ }));

    expect(await screen.findByRole('tab', { name: 'Suggestions (1)' }))
      .toBeInTheDocument();
    expect(screen.getByText('Please add a map.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vote up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vote down' })).toBeNull();
  });

  it('accepts a request onto its selected board and removes it immediately', async () => {
    api.getPendingMessages.mockResolvedValue([
      held({ id: 'm9', topic: 'faq', body: 'What time is it today?' }),
    ] as any);
    api.moderateMessage.mockResolvedValue({} as any);
    show({ canSort: true });

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(api.moderateMessage).toHaveBeenCalledWith(
      'm1', 'm9', 'approve', 'faq'
    ));
    await waitFor(() => expect(screen.queryByText('What time is it today?')).toBeNull());
  });

  it('rejects a request and removes it immediately', async () => {
    api.getPendingMessages.mockResolvedValue([
      held({ topic: 'faq', body: 'What time is it today?' }),
    ] as any);
    api.moderateMessage.mockResolvedValue({} as any);
    show({ canSort: true });

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(api.moderateMessage).toHaveBeenCalledWith(
      'm1', 'm1', 'decline', undefined
    ));
    await waitFor(() => expect(screen.queryByText('What time is it today?')).toBeNull());
  });

  it('leaves the boards and the composer available', async () => {
    show({ canSort: true, onAsk: jest.fn() });
    await screen.findByText(/purpose of spending/);

    expect(screen.getByRole('tab', { name: /Questions/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Suggestions/ })).toBeInTheDocument();
  });
});

/**
 * A vote sorts a queue, and a suggestion is not queued.
 *
 * Voting says which question the room most wants answered, and the host
 * works down from the top. Nobody works down a list of suggestions in
 * order, so a tally against one measures nothing - and the down arrow
 * hands the room a way to bury an idea before the host has read it.
 */
describe('voting, and what it is for', () => {
  const withBoth = () => {
    api.getEventBoard.mockResolvedValue({
      faq: [entry()],
      suggestions: [entry({ id: 'sg1', body: 'Print the maps larger' })],
    } as any);
    show();
  };

  it('is offered on a question', async () => {
    withBoth();
    await screen.findByText(/purpose of spending/);

    expect(screen.getByRole('button', { name: 'Vote up' })).toBeInTheDocument();
  });

  it('is not offered on a suggestion', async () => {
    withBoth();
    await screen.findByText(/purpose of spending/);

    fireEvent.click(screen.getByRole('tab', { name: /Suggestions/ }));

    expect(await screen.findByText(/Print the maps larger/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vote up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vote down' })).toBeNull();
  });
});

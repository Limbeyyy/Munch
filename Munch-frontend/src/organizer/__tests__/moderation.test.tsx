import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { ModerationView } from '../views/ModerationView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getEventBoard: jest.fn(),
    voteOnBoard: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const event = (over: any = {}) => ({
  id: 'm1', title: 'Wedding Preparation', code: 'IRL-NH7',
  status: 'active',
  scheduled_start: '2026-09-08T03:30:00Z',
  scheduled_end: '2026-09-08T09:00:00Z',
  ...over,
}) as any;

const entry = (over: any = {}) => ({
  id: 'q1',
  body: 'when is the reception?',
  asked_by: 'Suman Dhungana',
  asker_is_guest: true,
  was_direct: false,
  sent_to: null,
  score: 12,
  my_vote: 0,
  answer: '',
  answered_by: '',
  created_at: '2026-09-08T04:00:00Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getEventBoard.mockResolvedValue({ faq: [entry()], suggestions: [] } as any);
});

const show = (events = [event()]) =>
  render(
    <OrganizerProvider>
      <ModerationView events={events} />
    </OrganizerProvider>
  );

/**
 * The screen is the board.
 *
 * It used to be three: a queue of messages waiting to be let through, a
 * queue of guests waiting at the door, and the board. The first two
 * belonged to a chat, and there is no chat - what somebody writes is put
 * to the host inside the room, and the host either puts it up there or
 * does not.
 */
describe('the moderation screen', () => {
  it('shows what the host has put up', async () => {
    show();

    expect(await screen.findByText('when is the reception?')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Questions/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Suggestions/ })).toBeInTheDocument();
  });

  it('offers no queue of messages and no queue of guests', async () => {
    show();
    await screen.findByText('when is the reception?');

    expect(screen.queryByRole('tab', { name: /Messages/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Guests/ })).toBeNull();
  });

  /** The halves were the queue's; the queue is gone. */
  it('has no permissions and transfers either', async () => {
    show();
    await screen.findByText('when is the reception?');

    expect(screen.queryByText(/Permissions/)).toBeNull();
    expect(screen.queryByText(/Transfers/)).toBeNull();
  });

  it('says so plainly where there is no event to moderate', () => {
    show([]);

    expect(screen.getByText('No events.')).toBeInTheDocument();
  });

  it('picks which event to read, where there is more than one', async () => {
    show([event(), event({ id: 'm2', title: 'Budget Hearing' })]);

    expect(await screen.findByLabelText('Which event')).toBeInTheDocument();
  });

  it('asks for one board rather than all of them at once', async () => {
    show([event(), event({ id: 'm2', title: 'Budget Hearing' })]);
    await screen.findByText('when is the reception?');

    expect(api.getEventBoard).toHaveBeenCalledWith('m1');
    expect(api.getEventBoard).not.toHaveBeenCalledWith('m2');
  });
});

/**
 * The card, as 479-664 draws it: the mark, the question, and the arrows
 * under it - the same card the room reads, so the host is looking at
 * what everybody else is.
 */
describe('a question on the board', () => {
  it('carries the room\'s vote on it', async () => {
    show();
    await screen.findByText('when is the reception?');

    expect(screen.getByRole('button', { name: 'Upvote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Downvote' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('offers the host a way to answer it', async () => {
    show();
    await screen.findByText('when is the reception?');

    expect(screen.getByRole('button', { name: 'Answer' })).toBeInTheDocument();
  });

  /** There are no direct messages, so nothing came from one. */
  it('does not say a question arrived privately', async () => {
    api.getEventBoard.mockResolvedValue({
      faq: [entry({ was_direct: true, sent_to: 'host@example.com' })],
      suggestions: [],
    } as any);
    show();
    await screen.findByText('when is the reception?');

    expect(screen.queryByText(/direct/i)).toBeNull();
  });

  it('still names who asked, and when', async () => {
    show();
    await screen.findByText('when is the reception?');

    expect(screen.getByText('Suman Dhungana')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
  });

  it('sends a vote and takes the board back', async () => {
    api.voteOnBoard.mockResolvedValue(
      { faq: [entry({ score: 13, my_vote: 1 })], suggestions: [] } as any
    );
    show();
    await screen.findByText('when is the reception?');

    fireEvent.click(screen.getByRole('button', { name: 'Upvote' }));

    expect(await screen.findByText('13')).toBeInTheDocument();
  });
});

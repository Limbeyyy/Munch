import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RoomQuestions } from '../RoomQuestions';
import { OrganizerProvider } from '../i18n';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getMeetingBoard: jest.fn(),
    getGuestBoard: jest.fn(),
    getPendingMessages: jest.fn(),
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
  api.getMeetingBoard.mockResolvedValue({ faq: [entry()], suggestions: [] } as any);
  api.getPendingMessages.mockResolvedValue([held()] as any);
});

const show = (props: any = {}) =>
  render(
    <OrganizerProvider>
      <RoomQuestions meetingId="m1" {...props} />
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
    api.getMeetingBoard.mockResolvedValue(
      { faq: [entry({ my_vote: 1 })], suggestions: [] } as any
    );
    show();

    expect(await screen.findByRole('button', { name: 'Vote up' }))
      .toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * The tab that is the reason this exists.
 *
 * Every message in the room is written to the host or to the speaker, and
 * somebody has to say which are questions the room should see and which
 * are suggestions. That could only be done from the moderation screen -
 * which means leaving the meeting the queue belongs to.
 */
describe('sorting what people write, from inside the room', () => {
  it("is the host's tab, and nobody else's", async () => {
    show({ canSort: false });
    await screen.findByText(/purpose of spending/);

    expect(screen.queryByRole('tab', { name: /Requests/ })).toBeNull();
    expect(api.getPendingMessages).not.toHaveBeenCalled();
  });

  it('shows the host what is waiting, and who it was written to', async () => {
    show({ canSort: true });

    fireEvent.click(await screen.findByRole('tab', { name: /Requests \(1\)/ }));

    expect(await screen.findByText(/slow down the transcript/)).toBeInTheDocument();
    expect(screen.getByText(/Dr Darpan Pandey/)).toBeInTheDocument();
  });

  it('puts one up as a question, in one press', async () => {
    api.moderateMessage.mockResolvedValue({} as any);
    show({ canSort: true });
    fireEvent.click(await screen.findByRole('tab', { name: /Requests/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Question' }));

    await waitFor(() => expect(api.moderateMessage).toHaveBeenCalledWith(
      'm1', 'm1', 'approve', 'faq'
    ));
  });

  it('or as a suggestion, which is the other half of the choice', async () => {
    api.moderateMessage.mockResolvedValue({} as any);
    show({ canSort: true });
    fireEvent.click(await screen.findByRole('tab', { name: /Requests/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Suggestion' }));

    await waitFor(() => expect(api.moderateMessage).toHaveBeenCalledWith(
      'm1', 'm1', 'approve', 'suggestion'
    ));
  });

  it('or keeps it between the two of them', async () => {
    api.moderateMessage.mockResolvedValue({} as any);
    show({ canSort: true });
    fireEvent.click(await screen.findByRole('tab', { name: /Requests/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(api.moderateMessage).toHaveBeenCalledWith(
      'm1', 'm1', 'decline', undefined
    ));
  });

  it('takes it out of the queue once it has been dealt with', async () => {
    api.moderateMessage.mockResolvedValue({} as any);
    api.getPendingMessages.mockResolvedValueOnce([held()] as any)
      .mockResolvedValue([] as any);
    show({ canSort: true });
    fireEvent.click(await screen.findByRole('tab', { name: /Requests/ }));
    await screen.findByText(/slow down the transcript/);

    fireEvent.click(screen.getByRole('button', { name: 'Question' }));

    await waitFor(() =>
      expect(screen.queryByText(/slow down the transcript/)).toBeNull()
    );
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

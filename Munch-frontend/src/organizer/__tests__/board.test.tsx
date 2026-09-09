import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { MessageBoard } from '../MessageBoard';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getMeetingBoard: jest.fn(),
    voteOnBoard: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const entry = (over: any = {}) => ({
  id: 'q1',
  body: 'when is the reception?',
  asked_by: 'Suman Dhungana',
  asker_is_guest: true,
  was_direct: true,
  sent_to: 'tithighadi@gmail.com',
  score: 2,
  my_vote: 0,
  answer: '',
  answered_by: '',
  answered_at: null,
  created_at: '2026-09-08T04:04:00Z',
  topic: 'faq',
  ...over,
});

const board = (over: any = {}) => ({ faq: [entry()], suggestions: [], ...over });

const show = () =>
  render(
    <OrganizerProvider>
      <MessageBoard meetingId="m1" />
    </OrganizerProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getMeetingBoard.mockResolvedValue(board() as any);
});

describe('voting on a question', () => {
  it('shows the tally between two arrows a reader can name', async () => {
    show();

    expect(await screen.findByRole('button', { name: 'Upvote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Downvote' })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('says which way this reader voted', async () => {
    api.getMeetingBoard.mockResolvedValue(board({ faq: [entry({ my_vote: 1 })] }) as any);

    show();

    expect(await screen.findByRole('button', { name: 'Upvote' })).toHaveAttribute(
      'aria-pressed', 'true'
    );
    expect(screen.getByRole('button', { name: 'Downvote' })).toHaveAttribute(
      'aria-pressed', 'false'
    );
  });

  it('marks the chosen arrow rather than only tinting its outline', async () => {
    // At this size a change of text colour is easy to miss, so the arrow
    // is filled.
    api.getMeetingBoard.mockResolvedValue(board({ faq: [entry({ my_vote: 1 })] }) as any);

    show();

    const up = await screen.findByRole('button', { name: 'Upvote' });
    expect(up.className).toContain('bg-amber');
    expect(screen.getByRole('button', { name: 'Downvote' }).className)
      .not.toContain('bg-navy-700');
  });

  it('keeps a downvote off the colour that means live or lost', async () => {
    api.getMeetingBoard.mockResolvedValue(board({ faq: [entry({ my_vote: -1 })] }) as any);

    show();

    const down = await screen.findByRole('button', { name: 'Downvote' });
    expect(down.className).toContain('bg-navy-700');
    expect(down.className).not.toContain('live');
  });

  it('hugs its contents rather than stretching down the entry', async () => {
    // The row is a flex row, so without this the pill grows to the height
    // of the question and its answer and trails a column of empty tint.
    api.getMeetingBoard.mockResolvedValue(board({
      faq: [entry({ answer: 'Reception is at 5 PM sharp.', answered_by: 'Rahul' })],
    }) as any);

    show();

    const pill = (await screen.findByRole('button', { name: 'Upvote' }))
      .parentElement as HTMLElement;
    expect(pill.className).toContain('self-start');
    expect(pill.className).not.toContain('h-full');
  });

  it('sends the vote and takes the answer back', async () => {
    api.voteOnBoard.mockResolvedValue(
      board({ faq: [entry({ score: 3, my_vote: 1 })] }) as any
    );

    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Upvote' }));

    await waitFor(() => expect(api.voteOnBoard).toHaveBeenCalledWith('m1', 'q1', 1));
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it("reads the tally in the reader's own digits", async () => {
    window.localStorage.setItem(
      'manch.organizer.prefs', JSON.stringify({ lang: 'ne', a11y: {} })
    );

    show();

    // Nepali is the source language, and two is २ in it.
    expect(await screen.findByText('२')).toBeInTheDocument();
  });
});

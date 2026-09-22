import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { MessageBoard } from '../MessageBoard';
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
      <MessageBoard eventId="m1" />
    </OrganizerProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getEventBoard.mockResolvedValue(board() as any);
});

/**
 * The vote, as 479-664 draws it.
 *
 * An arrow each way with the word between them, laid along the line
 * under the question rather than stacked into a pill beside it. The same
 * control the room reads, so the host is looking at what everybody else
 * is - it used to be a second drawing of the same thing, which is how
 * one of them ended up stretched across the card.
 */
describe('voting on a question', () => {
  it('shows the tally between two arrows a reader can name', async () => {
    show();

    expect(await screen.findByRole('button', { name: 'Vote up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vote down' })).toBeInTheDocument();
    expect(screen.getByText('Vote')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('says which way this reader voted', async () => {
    api.getEventBoard.mockResolvedValue(board({ faq: [entry({ my_vote: 1 })] }) as any);

    show();

    expect(await screen.findByRole('button', { name: 'Vote up' })).toHaveAttribute(
      'aria-pressed', 'true'
    );
    expect(screen.getByRole('button', { name: 'Vote down' })).toHaveAttribute(
      'aria-pressed', 'false'
    );
  });

  /**
   * Along the line, not down it.
   *
   * The control the host had was a pill built to stand in a flex row
   * beside the question. Put under the question instead it had nothing
   * to hug, and stretched the width of the card with the arrows stacked
   * inside it.
   */
  it('lays the arrows along one line under the question', async () => {
    show();

    const row = (await screen.findByRole('button', { name: 'Vote up' }))
      .parentElement as HTMLElement;
    expect(row.className).toContain('flex');
    expect(row.className).not.toContain('flex-col');
    // The word and the other arrow are its neighbours on that line.
    expect(within(row).getByText('Vote')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Vote down' }))
      .toBeInTheDocument();
  });

  /** The tally belongs to whichever arrow earned it. */
  it('puts a negative tally against the down arrow', async () => {
    api.getEventBoard.mockResolvedValue(
      board({ faq: [entry({ score: -4, my_vote: -1 })] }) as any
    );

    show();

    const down = await screen.findByRole('button', { name: 'Vote down' });
    expect(within(down).getByText('4')).toBeInTheDocument();
  });

  /** Nought is not a number anybody wrote, so it is not shown. */
  it('shows no tally at all on a question nobody has voted on', async () => {
    api.getEventBoard.mockResolvedValue(board({ faq: [entry({ score: 0 })] }) as any);

    show();
    await screen.findByRole('button', { name: 'Vote up' });

    expect(screen.queryByText('0')).toBeNull();
  });

  it('sends the vote and takes the answer back', async () => {
    api.voteOnBoard.mockResolvedValue(
      board({ faq: [entry({ score: 3, my_vote: 1 })] }) as any
    );

    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Vote up' }));

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

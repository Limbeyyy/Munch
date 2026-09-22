import React from 'react';
import { BoardEntry } from '../types';
import { FigmaIcon } from '../assets/icons';
import { useOrganizer } from './i18n';

/**
 * What the room thinks of one entry, as 479-664 draws it.
 *
 * An arrow each way with the word between them, laid along the line
 * rather than stacked into a pill beside it. The tally sits against
 * whichever arrow it belongs to and is left off when it is nought, so a
 * question nobody has voted on reads as two arrows and an invitation
 * rather than a nought nobody wrote.
 *
 * One copy, used by the board in the room and the board on the
 * moderation screen. Two copies is how the host ends up looking at
 * something other than what the room is looking at.
 */
export const BoardVote: React.FC<{
  entry: BoardEntry;
  busy?: boolean;
  onVote: (value: 1 | -1) => void;
}> = ({ entry, busy, onVote }) => {
  const { t, num } = useOrganizer();

  return (
    <div className="flex gap-[19px] items-center">
      <button
        type="button"
        onClick={() => onVote(1)}
        disabled={busy}
        aria-label={t({ ne: 'माथि भोट', en: 'Vote up' })}
        aria-pressed={entry.my_vote === 1}
        className="flex gap-1 items-center disabled:opacity-50"
      >
        <FigmaIcon name={entry.my_vote === 1 ? 'voteUpCast' : 'voteUp'} size={24} />
        {entry.score > 0 && (
          <span className={`text-[14px] font-medium leading-5 tabular-nums ${
            entry.my_vote === 1 ? 'text-[#1a478b]' : 'text-[#656565]'
          }`}>
            {num(entry.score)}
          </span>
        )}
      </button>

      <span className="text-[14px] text-[#383838] leading-5">
        {t({ ne: 'भोट', en: 'Vote' })}
      </span>

      <button
        type="button"
        onClick={() => onVote(-1)}
        disabled={busy}
        aria-label={t({ ne: 'तल भोट', en: 'Vote down' })}
        aria-pressed={entry.my_vote === -1}
        className="flex gap-1 items-center disabled:opacity-50"
      >
        <FigmaIcon name="voteDown" size={24} />
        {entry.score < 0 && (
          <span className="text-[14px] font-medium leading-5 tabular-nums text-[#656565]">
            {num(Math.abs(entry.score))}
          </span>
        )}
      </button>
    </div>
  );
};

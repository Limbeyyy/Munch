import React from 'react';

import appSavedObjects from './app-saved-objects.svg';
import arrowRight from './arrow-right.svg';
import caretRight from './caret-right.svg';
import chatLeftDots from './chat-left-dots.svg';
import checkFill from './check-fill.svg';
import chevronDown from './chevron-down.svg';
import exitStroke from './exit-stroke.svg';
import fileCopy from './file-copy.svg';
import fileUpload from './file-upload.svg';
import folderOpenOutline from './folder-open-outline.svg';
import layoutGrid from './layout-grid.svg';
import peoplesTwo from './peoples-two.svg';
import questionCircle from './question-circle.svg';
import questionCircleOutline from './question-circle-outline.svg';
import shareBoxOutline from './share-box-outline.svg';
import shareNodes from './share-nodes.svg';
import voteDown from './vote-down.svg';
import voteUp from './vote-up.svg';
import voteUpCast from './vote-up-cast.svg';

/**
 * The icons the design was drawn with, exported from it.
 *
 * They are the file's own bytes rather than lookalikes redrawn here, and
 * they carry the colours they were given: white where they sit on the
 * navy bar, red for leaving, blue for a folder. That is why they are
 * images rather than inline paths tinted with currentColor - recolouring
 * them would mean editing artwork somebody else owns.
 */
export const FIGMA_ICON = {
  chat: chatLeftDots,
  questions: questionCircle,
  resources: appSavedObjects,
  share: shareBoxOutline,
  leave: exitStroke,
  folder: folderOpenOutline,
  participants: peoplesTwo,
  chevronDown,
  arrowRight,
  copy: fileCopy,
  /** The page-with-an-arrow over an empty upload box. */
  fileUpload,
  shareNodes,
  layoutGrid,
  /** The mark against a question on the board. */
  asked: questionCircleOutline,
  /** The vote control: an arrow each way, and the one that has been used. */
  voteUp,
  voteUpCast,
  voteDown,
  /** The tick inside the filter the moderation screen is showing. */
  checkFill,
  /** The arrow on an agenda's header, turned down when it is open. */
  caretRight,
} as const;

export type FigmaIconName = keyof typeof FIGMA_ICON;

/**
 * One of those icons, at the size the design gives it.
 *
 * The box and the artwork are sized together and stated outright: a
 * 24-pixel glyph in a 24-pixel box is what the design specifies, and
 * leaving either to be inferred is how icons end up stretched.
 */
export const FigmaIcon: React.FC<{
  name: FigmaIconName;
  /** Both edges of the box, in pixels. The artwork fills it. */
  size?: number;
  className?: string;
  title?: string;
}> = ({ name, size = 24, className = '', title }) => (
  <img
    src={FIGMA_ICON[name]}
    alt={title ?? ''}
    aria-hidden={title ? undefined : true}
    width={size}
    height={size}
    style={{ width: size, height: size }}
    className={`block shrink-0 ${className}`}
  />
);

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { AgendaBoard } from '../AgendaBoard';
import { apiClient } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  apiClient: {
    rescheduleSessions: jest.fn(),
    deleteSession: jest.fn(),
    getSchedulingPrefs: jest.fn(),
    getResources: jest.fn(),
    hasSession: () => false,
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn(),
  }),
}));

const api = apiClient as jest.Mocked<typeof apiClient>;
const toast = require('react-hot-toast').default;

const day = '2026-09-18';
const at = (hh: string) => `${day}T${hh}:00`;

const session = (over: any = {}) => ({
  id: 's1', title: 'Kataho', description: '', speaker_name: 'Prabhat',
  speaker_visibility: 'private',
  starts_at: at('10:30'), duration_minutes: 30, ends_at: at('11:00'),
  position: 0, status: 'scheduled', started_at: null, ended_at: null,
  attendance_count: 0, created_at: '', updated_at: '',
  ...over,
});

const event = (sessions: any[]) => ({
  id: 'e1', code: 'Y1C-351', title: 'Emergency Services', description: '',
  status: 'scheduled', venue: '', event_date: day,
  scheduled_start: at('10:30'), scheduled_end: at('12:30'),
  participant_count: 0, sessions, session_count: sessions.length,
  created_at: '', updated_at: '',
}) as any;

const two = () => event([
  session({ id: 's1', title: 'Kataho', starts_at: at('10:30') }),
  session({ id: 's2', title: 'Addressgraph', starts_at: at('12:00'),
            speaker_name: 'Sumin' }),
]);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.rescheduleSessions.mockResolvedValue([] as any);
  // Re-applied here rather than at the mock, since clearAllMocks above
  // strips implementations set when the module was defined.
  api.getSchedulingPrefs.mockResolvedValue({ session_gap_minutes: 15 } as any);
  api.deleteSession.mockResolvedValue(undefined as any);
  api.getResources.mockResolvedValue([] as any);
});

const show = (ev = two(), onChanged = jest.fn()) => {
  render(
    <OrganizerProvider>
      <AgendaBoard event={ev} onChanged={onChanged} />
    </OrganizerProvider>
  );
  return onChanged;
};

const rowOf = (title: string) =>
  screen.getByText(title).closest('li') as HTMLElement;

/** Drag one row onto another, the way a mouse would. */
const dragOnto = (fromTitle: string, toTitle: string) => {
  const data: Record<string, string> = {};
  const dataTransfer = {
    setData: (k: string, v: string) => { data[k] = v; },
    getData: (k: string) => data[k] ?? '',
    effectAllowed: '',
  };
  fireEvent.dragStart(rowOf(fromTitle), { dataTransfer });
  fireEvent.drop(rowOf(toTitle), { dataTransfer });
};

/**
 * Arranging the running order in place.
 *
 * The rules are the agenda screen's, reached through the same engine:
 * the gap between talks is kept, the first talk stays with the hour the
 * event opens, and anything already run keeps the time it had.
 */
describe('rearranging the running order', () => {
  it('lists the talks in the order they run', () => {
    show();

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Kataho')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Addressgraph')).toBeInTheDocument();
  });

  it('swaps two when one is dragged onto the other', () => {
    show();

    dragOnto('Addressgraph', 'Kataho');

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Addressgraph')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Kataho')).toBeInTheDocument();
  });

  it('keeps the first talk on the hour the event opens', () => {
    show();

    dragOnto('Addressgraph', 'Kataho');

    // Whichever talk is first, it starts when the event does.
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getAllByText(/10:30/).length).toBeGreaterThan(0);
  });

  it('will not move a talk that has already run, and says why', () => {
    show(event([
      session({ id: 's1', title: 'Kataho', status: 'done' }),
      session({ id: 's2', title: 'Addressgraph', starts_at: at('12:00') }),
    ]));

    dragOnto('Addressgraph', 'Kataho');

    expect(toast.error).toHaveBeenCalled();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Kataho')).toBeInTheDocument();
  });

  it('does not offer a finished talk to the mouse at all', () => {
    show(event([session({ id: 's1', title: 'Kataho', status: 'done' })]));

    expect(rowOf('Kataho')).toHaveAttribute('draggable', 'false');
  });

  it('moves a row with the keyboard, for anybody not using a mouse', () => {
    show();

    fireEvent.keyDown(rowOf('Addressgraph'), { key: 'ArrowUp', altKey: true });

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Addressgraph')).toBeInTheDocument();
  });
});

describe('changing a time or a length', () => {
  it('pushes what follows out of the way', () => {
    show();

    const mins = within(rowOf('Kataho')).getByLabelText('Minutes');
    fireEvent.change(mins, { target: { value: '120' } });

    // Kataho now runs to 12:30, so Addressgraph cannot stay at 12:00.
    expect(within(rowOf('Addressgraph')).getAllByText(/12:45|13:/).length)
      .toBeGreaterThan(0);
  });

  it('marks what it moved, so the change can be seen before it is saved', () => {
    show();

    fireEvent.change(
      within(rowOf('Kataho')).getByLabelText('Minutes'), { target: { value: '120' } }
    );

    expect(within(rowOf('Addressgraph')).getByText('Moved')).toBeInTheDocument();
  });
});

/**
 * Nothing is written until it is asked for, so a rearrangement can be
 * thought about and abandoned.
 */
describe('saving a rearrangement', () => {
  it('offers nothing to save until something moves', () => {
    show();

    expect(screen.queryByRole('button', { name: /Save the order/ })).toBeNull();
  });

  it('writes every row the reflow touched, in one go', async () => {
    const onChanged = show();
    dragOnto('Addressgraph', 'Kataho');

    fireEvent.click(screen.getByRole('button', { name: /Save the order/ }));

    await waitFor(() => expect(api.rescheduleSessions).toHaveBeenCalled());
    const sent = api.rescheduleSessions.mock.calls[0][0];
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toHaveProperty('starts_at');
    expect(sent[0]).toHaveProperty('duration_minutes');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('puts the day back as it was when the change is abandoned', () => {
    show();
    dragOnto('Addressgraph', 'Kataho');

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Kataho')).toBeInTheDocument();
    expect(api.rescheduleSessions).not.toHaveBeenCalled();
  });
});

/**
 * Nothing is started from here.
 *
 * Putting a talk on stage belongs to the room and to live control, where
 * whoever does it is watching the room at the time. The board arranges
 * the day; it does not run it.
 */
describe('what the board will not do', () => {
  it('offers no way to put a talk on stage', () => {
    show();

    expect(screen.queryByRole('button', { name: 'On stage' })).toBeNull();
  });

  it('offers no way to end the one that is running either', () => {
    show(event([session({ id: 's1', title: 'Kataho', status: 'live' })]));

    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });
});

/**
 * Taking a talk off the running order.
 *
 * This came across from the Sessions page, which was the only place it
 * lived; deleting that page without it would have left no way off the
 * running order at all.
 */
describe('what came across from the Sessions page', () => {
  it('takes a talk off the running order, once it has asked', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const onChanged = show();

    fireEvent.click(
      within(rowOf('Kataho')).getByRole('button', { name: 'Remove session' })
    );

    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    confirm.mockRestore();
  });

  it('removes nothing when the asking is declined', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    show();

    fireEvent.click(
      within(rowOf('Kataho')).getByRole('button', { name: 'Remove session' })
    );

    expect(api.deleteSession).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('will not take away the talk that is on stage', () => {
    show(event([session({ id: 's1', title: 'Kataho', status: 'live' })]));

    expect(
      within(rowOf('Kataho')).getByRole('button', { name: 'Remove session' })
    ).toBeDisabled();
  });
});

/**
 * The hour a talk keeps is read off its card, not typed into it.
 *
 * A field for it beside the times already printed at the top of the card
 * was two places saying the same thing, one of them editable. The hour
 * belongs to the talk, and the talk is changed on the form Edit opens.
 */
describe('the hour on a card', () => {
  it('shows when it runs, in words rather than a field', () => {
    show();

    const card = rowOf('Kataho');
    expect(within(card).getAllByText(/10:30/).length).toBeGreaterThan(0);
    // Stated, not typed: there is no field to change it in.
    expect(within(card).queryByLabelText('Starts')).toBeNull();
    expect(card.querySelector('input[type="datetime-local"]')).toBeNull();
  });

  it('states the day along with the hour, so neither is guessed at', () => {
    show();

    // 18 September 2026, however this machine writes a date.
    expect(within(rowOf('Kataho')).getByText(/2026.*10:30|10:30.*2026/))
      .toBeInTheDocument();
  });

  it('still moves when the talk before it grows', () => {
    show();

    fireEvent.change(
      within(rowOf('Kataho')).getByLabelText('Minutes'), { target: { value: '120' } }
    );

    expect(within(rowOf('Addressgraph')).getAllByText(/12:45|13:/).length)
      .toBeGreaterThan(0);
  });
});

/**
 * Where a talk is held is the event's business, not each talk's.
 *
 * Every agenda item of an event runs at the venue the event names, so a
 * hall per talk was a field that could only ever disagree with it.
 */
describe('where a talk is held', () => {
  it('is not asked for on the card', () => {
    show();

    expect(within(rowOf('Kataho')).queryByLabelText('Hall')).toBeNull();
  });

  it('is not sent with a rearrangement either', async () => {
    show();
    dragOnto('Addressgraph', 'Kataho');

    fireEvent.click(screen.getByRole('button', { name: /Save the order/ }));

    await waitFor(() => expect(api.rescheduleSessions).toHaveBeenCalled());
    const sent = api.rescheduleSessions.mock.calls[0][0];
    expect(sent[0]).not.toHaveProperty('hall');
  });
});

/** The number on its own read as a count of something unnamed. */
describe('how long a talk runs', () => {
  it('says what the number is counting', () => {
    show();

    const card = rowOf('Kataho');
    expect(within(card).getByLabelText('Minutes')).toHaveValue(30);
    expect(within(card).getByText('min')).toBeInTheDocument();
  });
});

describe('what a card says about its talk', () => {
  it('numbers it by where it comes in the order', () => {
    show();

    expect(within(rowOf('Kataho')).getByText('01')).toBeInTheDocument();
    expect(within(rowOf('Addressgraph')).getByText('02')).toBeInTheDocument();
  });

  it('renumbers when the order changes', () => {
    show();

    dragOnto('Addressgraph', 'Kataho');

    expect(within(rowOf('Addressgraph')).getByText('01')).toBeInTheDocument();
    expect(within(rowOf('Kataho')).getByText('02')).toBeInTheDocument();
  });

  it('names the speaker, and what they do', () => {
    show(event([session({ id: 's1', title: 'Kataho', speaker_name: 'Prabhat' })]));

    const card = rowOf('Kataho');
    expect(within(card).getByText('Speaker')).toBeInTheDocument();
    expect(within(card).getByText('Prabhat')).toBeInTheDocument();
  });

  it('says so plainly when nobody is giving it', () => {
    show(event([session({ id: 's1', title: 'Kataho', speaker_name: '' })]));

    expect(within(rowOf('Kataho')).getByText('No speaker assigned')).toBeInTheDocument();
  });

  /**
   * The speaker is written on the same form the talk is, so the link is a
   * way into that form rather than a second place to keep a name.
   */
  it('offers to change the speaker, through the form the talk was written on', () => {
    const onEdit = jest.fn();
    render(
      <OrganizerProvider>
        <AgendaBoard event={two()} onChanged={jest.fn()} onEdit={onEdit} />
      </OrganizerProvider>
    );

    fireEvent.click(
      within(rowOf('Kataho')).getByRole('button', { name: 'Change speaker' })
    );

    expect(onEdit).toHaveBeenCalledWith('s1');
  });

  it('offers to add one where there is none', () => {
    render(
      <OrganizerProvider>
        <AgendaBoard
          event={event([session({ id: 's1', title: 'Kataho', speaker_name: '' })])}
          onChanged={jest.fn()}
          onEdit={jest.fn()}
        />
      </OrganizerProvider>
    );

    expect(
      within(rowOf('Kataho')).getByRole('button', { name: 'Add speaker' })
    ).toBeInTheDocument();
  });
});

/**
 * What was shared against a talk, down the side of its card.
 *
 * Documents are decoration here: an event being typed for the first time
 * has none, and the board is still a board when they cannot be reached.
 */
describe('the documents on a card', () => {
  const files = [
    { id: 'a1', session: 's1', display_name: 'research.ppt' },
    { id: 'a2', session: 's1', display_name: 'documents.doc' },
    { id: 'a3', session: null, display_name: 'programme.pdf' },
  ];

  it('lists the ones shared against that talk', async () => {
    api.getResources.mockResolvedValue(files as any);
    show();

    const card = rowOf('Kataho');
    expect(await within(card).findByText('research.ppt')).toBeInTheDocument();
    expect(within(card).getByText('documents.doc')).toBeInTheDocument();
    expect(within(card).getByText('Documents')).toBeInTheDocument();
  });

  it('keeps one belonging to no talk off every card', async () => {
    api.getResources.mockResolvedValue(files as any);
    show();

    await screen.findByText('research.ppt');
    expect(screen.queryByText('programme.pdf')).toBeNull();
  });

  it('leaves the column off a talk with nothing shared', async () => {
    api.getResources.mockResolvedValue(files as any);
    show();

    await screen.findByText('research.ppt');
    expect(within(rowOf('Addressgraph')).queryByText('Documents')).toBeNull();
  });

  it('draws the board anyway when they cannot be fetched', async () => {
    api.getResources.mockRejectedValue(new Error('no'));
    show();

    await waitFor(() => expect(api.getResources).toHaveBeenCalled());
    expect(rowOf('Kataho')).toBeInTheDocument();
  });
});

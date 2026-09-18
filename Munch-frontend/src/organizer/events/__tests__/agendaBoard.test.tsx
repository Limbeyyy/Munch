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
  hall: '', speaker_visibility: 'private',
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
    expect(within(rows[0]).getByText(/10:30/)).toBeInTheDocument();
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
    expect(within(rowOf('Addressgraph')).getByText(/12:45|13:/)).toBeInTheDocument();
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

describe('running the day from here', () => {
  it('offers the stage only where the caller asks for it', () => {
    show();

    expect(screen.queryByRole('button', { name: 'On stage' })).toBeNull();
  });

  it('puts a talk on stage when it does', () => {
    const onRun = jest.fn();
    render(
      <OrganizerProvider>
        <AgendaBoard event={two()} onChanged={jest.fn()} onRun={onRun} />
      </OrganizerProvider>
    );

    fireEvent.click(
      within(rowOf('Kataho')).getByRole('button', { name: 'On stage' })
    );

    expect(onRun).toHaveBeenCalledWith('s1', 'start');
  });

  it('offers to end the one that is running, not to start it', () => {
    const onRun = jest.fn();
    render(
      <OrganizerProvider>
        <AgendaBoard
          event={event([session({ id: 's1', title: 'Kataho', status: 'live' })])}
          onChanged={jest.fn()}
          onRun={onRun}
        />
      </OrganizerProvider>
    );

    const row = rowOf('Kataho');
    expect(within(row).queryByRole('button', { name: 'On stage' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'End' }));
    expect(onRun).toHaveBeenCalledWith('s1', 'end');
  });
});

/**
 * The two things that used to live only on the Sessions page.
 *
 * Deleting that page without these would have left no way to say which
 * hall a talk is in, or to take one off the running order at all.
 */
describe('what came across from the Sessions page', () => {
  it('says which hall a talk is in', () => {
    show();

    const hall = within(rowOf('Kataho')).getByLabelText('Hall');
    fireEvent.change(hall, { target: { value: 'Hall A' } });

    expect(hall).toHaveValue('Hall A');
    // A hall is a change like any other, so it waits to be saved.
    expect(screen.getByRole('button', { name: /Save the order/ })).toBeInTheDocument();
  });

  it('sends the hall with the rest of the rearrangement', async () => {
    show();
    fireEvent.change(
      within(rowOf('Kataho')).getByLabelText('Hall'), { target: { value: 'Hall A' } }
    );

    fireEvent.click(screen.getByRole('button', { name: /Save the order/ }));

    await waitFor(() => expect(api.rescheduleSessions).toHaveBeenCalled());
    const sent = api.rescheduleSessions.mock.calls[0][0];
    expect(sent.find((s: any) => s.id === 's1')?.hall).toBe('Hall A');
  });

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

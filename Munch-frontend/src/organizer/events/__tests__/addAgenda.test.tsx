import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { AddAgendaDialog } from '../AddAgendaDialog';
import { apiClient } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  apiClient: {
    createSession: jest.fn(),
    updateSession: jest.fn(),
    getResources: jest.fn(),
    uploadResource: jest.fn(),
    deleteResource: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.createSession.mockResolvedValue({ id: 's1', title: 'Opening' } as any);
  api.updateSession.mockResolvedValue({ id: 's9', title: 'Session Kataho' } as any);
  api.getResources.mockResolvedValue([] as any);
  api.uploadResource.mockResolvedValue({ id: 'a1' } as any);
  api.deleteResource.mockResolvedValue(undefined as any);
});

const show = (added = jest.fn(), closed = jest.fn()) => {
  render(
    <OrganizerProvider>
      <AddAgendaDialog
        eventId="e1"
        day="2026-09-15"
        suggestedStart="11:30"
        onClose={closed}
        onAdded={added}
      />
    </OrganizerProvider>
  );
  return { added, closed };
};

const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

const fillIn = () => {
  type('Emergency Response Overview', 'Opening');
};

/**
 * One session, written on its own.
 *
 * The running order used to be typed as a grid of rows, which asked the
 * organizer to hold a whole morning in their head at once. This asks for
 * one talk at a time.
 */
describe('adding one agenda item', () => {
  it('opens on the hour the running order has reached', () => {
    show();

    expect(screen.getByDisplayValue('11:30')).toBeInTheDocument();
  });

  it('offers the lengths rather than asking for a number', () => {
    show();

    const lengths = screen.getByRole('combobox');
    expect(lengths).toHaveValue('30');
    expect(within(lengths).getByText('90 min')).toBeInTheDocument();
  });

  it('writes the session against the event, on the event\'s own day', async () => {
    const { added } = show();
    fillIn();

    fireEvent.click(screen.getByRole('button', { name: 'Add agenda' }));

    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    const sent = api.createSession.mock.calls[0][0];
    expect(sent.event).toBe('e1');
    expect(sent.title).toBe('Opening');
    expect(sent.duration_minutes).toBe(30);
    // The time typed is on the event's day, not on today.
    expect(new Date(sent.starts_at).toDateString())
      .toBe(new Date('2026-09-15T11:30').toDateString());
    await waitFor(() => expect(added).toHaveBeenCalled());
  });

  it('will not write one with no name', async () => {
    show();

    fireEvent.click(screen.getByRole('button', { name: 'Add agenda' }));

    expect(api.createSession).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  /**
   * Who is speaking is not asked here any more.
   *
   * A speaker is a profile now, written on its own step and put on the
   * talks they give - so this form writes the slot and leaves the person
   * to that step. Asking twice meant two places to correct a name.
   */
  it('asks nothing about the speaker', () => {
    show();

    expect(screen.queryByPlaceholderText('Name *')).toBeNull();
    expect(screen.queryByPlaceholderText('Email')).toBeNull();
    expect(screen.queryByPlaceholderText('Phone')).toBeNull();
    expect(screen.queryByPlaceholderText('Position')).toBeNull();
  });

  it('closes without writing anything', () => {
    const { closed } = show();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(closed).toHaveBeenCalled();
    expect(api.createSession).not.toHaveBeenCalled();
  });
});

/**
 * Changing a talk that is already on the running order.
 *
 * Edit used to bounce out to the first step of the setup form, which is
 * where an event's name and hours live rather than a talk's. It is the
 * same dialog now, opened on what is already there.
 */
describe('editing an agenda item', () => {
  const existing = {
    id: 's9',
    title: 'Session Kataho',
    description: 'Notes so far',
    speaker_name: 'Prabhat Karmacharya',
    speaker_role: 'Director',
    speaker_contact: { email: 'prabhat@example.com', phone: '9811111111' },
    starts_at: '2026-09-15T09:30:00',
    duration_minutes: 30,
  } as any;

  const showEdit = (added = jest.fn()) => {
    render(
      <OrganizerProvider>
        <AddAgendaDialog
          eventId="e1"
          day="2026-09-15"
          session={existing}
          onClose={jest.fn()}
          onAdded={added}
        />
      </OrganizerProvider>
    );
    return added;
  };

  it('opens on what is already written down', () => {
    showEdit();

    expect(screen.getByDisplayValue('Session Kataho')).toBeInTheDocument();
    expect(screen.getByDisplayValue('09:30')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Notes so far')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('30');
  });

  /**
   * Not even on an edit.
   *
   * The speaker already written on this talk is not shown here to be
   * corrected: the profile is the one place they are edited, and a
   * second one would be a second thing to keep in step.
   */
  it('does not offer the speaker back for editing', () => {
    showEdit();

    expect(screen.queryByDisplayValue('Prabhat Karmacharya')).toBeNull();
    expect(screen.queryByDisplayValue('prabhat@example.com')).toBeNull();
    expect(screen.queryByDisplayValue('9811111111')).toBeNull();
  });

  it('says it is an edit, not another session', () => {
    showEdit();

    expect(screen.getByText('Edit agenda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('updates that session rather than writing a second one', async () => {
    const added = showEdit();
    type('Emergency Response Overview', 'Session Kataho, revised');

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.updateSession).toHaveBeenCalled());
    expect(api.createSession).not.toHaveBeenCalled();
    const [id, patch] = api.updateSession.mock.calls[0];
    expect(id).toBe('s9');
    expect(patch.title).toBe('Session Kataho, revised');
    await waitFor(() => expect(added).toHaveBeenCalled());
  });

  /**
   * The server only demands a reachable speaker when a session is first
   * written, so an edit is not held up by details nobody ever collected.
   */
  it('lets an edit through even where the speaker was never filled in', async () => {
    render(
      <OrganizerProvider>
        <AddAgendaDialog
          eventId="e1"
          day="2026-09-15"
          session={{ ...existing, speaker_name: '', speaker_contact: null }}
          onClose={jest.fn()}
          onAdded={jest.fn()}
        />
      </OrganizerProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.updateSession).toHaveBeenCalled());
  });
});

/**
 * What the speaker is handing out.
 *
 * A document belongs to the talk it was written for, not to the event at
 * large - which is what lets the running order show, beside each item,
 * the slides and lists that go with it.
 */
describe('the documents on an agenda item', () => {
  const pick = (name: string) => {
    const input = screen.getByLabelText('Choose documents');
    fireEvent.change(input, {
      target: { files: [new File(['x'], name, { type: 'application/pdf' })] },
    });
  };

  it('says there are none yet, and offers to upload', () => {
    show();

    expect(screen.getByText('No files yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Upload' })).toBeInTheDocument();
  });

  /**
   * A talk being written for the first time has no id to file anything
   * against, so what is picked waits for the one it is about to get.
   */
  it('holds a file picked before the agenda item exists', () => {
    show();

    pick('Emergency Response Plan.pdf');

    expect(screen.getByText('Emergency Response Plan.pdf')).toBeInTheDocument();
    expect(api.uploadResource).not.toHaveBeenCalled();
  });

  it('sends it once there is an agenda item to send it against', async () => {
    show();
    fillIn();
    pick('Emergency Response Plan.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Add agenda' }));

    await waitFor(() => expect(api.uploadResource).toHaveBeenCalled());
    const [eventId, file, , sessionId] = api.uploadResource.mock.calls[0];
    expect(eventId).toBe('e1');
    expect((file as File).name).toBe('Emergency Response Plan.pdf');
    // The session the server just wrote, not the event at large.
    expect(sessionId).toBe('s1');
  });

  it('lets one be taken back off before it has gone anywhere', () => {
    show();
    pick('Emergency Response Plan.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.queryByText('Emergency Response Plan.pdf')).toBeNull();
    expect(api.deleteResource).not.toHaveBeenCalled();
  });

  /** The agenda item still exists even where its files would not go up. */
  it('keeps the agenda item when a file will not upload', async () => {
    api.uploadResource.mockRejectedValue(new Error('drive is down'));
    const { added } = show();
    fillIn();
    pick('Emergency Response Plan.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Add agenda' }));

    await waitFor(() => expect(added).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('the documents on an agenda item that exists', () => {
  const existing = {
    id: 's9',
    title: 'Session Kataho',
    description: '',
    speaker_name: 'Prabhat Karmacharya',
    speaker_contact: { email: 'p@example.com', phone: '9811111111' },
    starts_at: '2026-09-15T09:30:00',
    duration_minutes: 30,
  } as any;

  const showEdit = () =>
    render(
      <OrganizerProvider>
        <AddAgendaDialog
          eventId="e1"
          day="2026-09-15"
          session={existing}
          onClose={jest.fn()}
          onAdded={jest.fn()}
        />
      </OrganizerProvider>
    );

  beforeEach(() => {
    api.getResources.mockResolvedValue([
      {
        id: 'a1', session: 's9', display_name: 'Emergency Response Plan.pdf',
        web_view_link: 'https://drive.example/a1',
      },
      { id: 'a2', session: 's9', display_name: 'Contact List.xlsx' },
      { id: 'a3', session: 's1', display_name: 'Somebody else.pdf' },
    ] as any);
  });

  it('reads back what is already filed against this talk', async () => {
    showEdit();

    expect(await screen.findByText('Emergency Response Plan.pdf')).toBeInTheDocument();
    expect(screen.getByText('Contact List.xlsx')).toBeInTheDocument();
  });

  it('leaves another talk’s documents alone', async () => {
    showEdit();

    await screen.findByText('Contact List.xlsx');
    expect(screen.queryByText('Somebody else.pdf')).toBeNull();
  });

  it('opens one where the host can reach it', async () => {
    showEdit();
    await screen.findByText('Emergency Response Plan.pdf');

    const row = screen.getByText('Emergency Response Plan.pdf')
      .closest('div') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Open' }))
      .toHaveAttribute('href', 'https://drive.example/a1');
  });

  it('sends a newly picked one straight away, against this talk', async () => {
    showEdit();
    await screen.findByText('Contact List.xlsx');

    fireEvent.change(screen.getByLabelText('Choose documents'), {
      target: { files: [new File(['x'], 'Slides.pptx')] },
    });

    await waitFor(() => expect(api.uploadResource).toHaveBeenCalled());
    expect(api.uploadResource.mock.calls[0][3]).toBe('s9');
  });

  it('takes one away for good when asked', async () => {
    showEdit();
    await screen.findByText('Contact List.xlsx');

    const row = screen.getByText('Contact List.xlsx').closest('div') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.deleteResource).toHaveBeenCalledWith('e1', 'a2'));
    await waitFor(() => expect(screen.queryByText('Contact List.xlsx')).toBeNull());
  });
});

/**
 * Which day of the event a slot sits on.
 *
 * An event running over more than one day has a running order per day
 * rather than one long list: a talk at nine belongs to the morning of a
 * particular day, and a time alone cannot say which. One day and there
 * is nothing to choose between, so the field does not appear.
 */
describe('choosing the day', () => {
  const showOn = (days?: string[]) =>
    render(
      <OrganizerProvider>
        <AddAgendaDialog
          eventId="e1"
          day="2026-09-15"
          days={days}
          suggestedStart="11:30"
          onClose={jest.fn()}
          onAdded={jest.fn()}
        />
      </OrganizerProvider>
    );

  it('is not asked where the event runs one day', () => {
    showOn(['2026-09-15']);

    expect(screen.queryByLabelText(/Select Day/)).toBeNull();
  });

  it('is asked where it runs over several', () => {
    showOn(['2026-09-15', '2026-09-16', '2026-09-17']);

    const picker = screen.getByLabelText(/Select Day/);
    expect(picker).toBeInTheDocument();
    expect(within(picker).getByText('Day 3')).toBeInTheDocument();
  });

  it('opens on the day the form was opened from', () => {
    showOn(['2026-09-14', '2026-09-15', '2026-09-16']);

    expect(screen.getByLabelText(/Select Day/)).toHaveValue('2026-09-15');
  });

  it('writes the slot onto the day that was chosen', async () => {
    showOn(['2026-09-15', '2026-09-16']);
    type('Emergency Response Overview', 'Second morning');
    fireEvent.change(screen.getByLabelText(/Select Day/), {
      target: { value: '2026-09-16' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add agenda' }));

    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    const sent = api.createSession.mock.calls[0][0];
    expect(new Date(sent.starts_at).toDateString())
      .toBe(new Date('2026-09-16T11:30').toDateString());
  });
});

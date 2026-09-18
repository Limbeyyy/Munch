import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { EventWizard } from '../EventWizard';
import { apiClient } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  apiClient: {
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    getEvent: jest.fn(),
    getProgrammeRoles: jest.fn(),
    getEventInvites: jest.fn(),
    getResources: jest.fn(),
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

const made = {
  id: 'e1', title: 'Emergency Services', description: '', venue: '',
  event_date: '2026-09-18', status: 'scheduled', code: 'ABC-123',
  scheduled_start: '2026-09-18T09:30:00', scheduled_end: '2026-09-18T10:30:00',
  participant_count: 0, sessions: [], session_count: 0,
  created_at: '', updated_at: '',
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.createEvent.mockResolvedValue(made);
  // Echo the patch back, the way the server does, so the form's idea of
  // the event keeps up with what it has just written.
  api.updateEvent.mockImplementation(
    async (_id: string, patch: any) => ({ ...made, ...patch })
  );
  api.getProgrammeRoles.mockResolvedValue({ granted: [], speakers: [] } as any);
  api.getEventInvites.mockResolvedValue({
    added: 0, invited: [], total_invited: 0, total_joined: 0,
  } as any);
  api.getResources.mockResolvedValue([] as any);
  api.getSchedulingPrefs.mockResolvedValue({ session_gap_minutes: 15 } as any);
});

const open = (event?: any) =>
  render(
    <OrganizerProvider>
      <EventWizard event={event} onClose={jest.fn()} onSaved={jest.fn()} />
    </OrganizerProvider>
  );

/**
 * What each step ends on.
 *
 * The buttons used to be named after the step they went to - "Next:
 * Sessions", "Next: Peoples" - which named the screen rather than the
 * thing being done, and put a Back beside it that the stepper above
 * already did. Each step now ends on the same pair the design draws: a
 * way out, and the step's own action.
 */
describe('the actions at the foot of each step', () => {
  it('offers to create the event, rather than to go to the next screen', () => {
    open();

    expect(screen.getByRole('button', { name: 'Create event' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next:/ })).toBeNull();
  });

  it('offers to save one that already exists, rather than create it again', () => {
    open(made);

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('still writes the event from that button', async () => {
    open();
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: 'Emergency Services' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() => expect(api.createEvent).toHaveBeenCalled());
  });

  it('carries on from the agenda step', async () => {
    open(made);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const carryOn = await screen.findByRole('button', { name: 'Continue' });
    fireEvent.click(carryOn);

    expect(
      await screen.findByRole('heading', { name: 'Peoples' })
    ).toBeInTheDocument();
  });

  it('ends on Done, with no Back beside it', async () => {
    open(made);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('gives every step the same way out', async () => {
    open(made);

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('button', { name: 'Continue' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

/**
 * Leaving the last step without finishing it.
 *
 * By the time step three is reached the event exists - it was written at
 * step one, so the running order and the people had something to hang
 * off. What it does not have is a host who has said they are done with
 * it, so there is nothing here to cancel: the choice is between
 * finishing it and leaving it a draft.
 */
describe('leaving the people step', () => {
  /** Walk the form to the last step, on an event that already exists. */
  const atPeoples = async () => {
    const onClose = jest.fn();
    render(
      <OrganizerProvider>
        <EventWizard event={made} onClose={onClose} onSaved={jest.fn()} />
      </OrganizerProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByRole('button', { name: 'Done' });
    return onClose;
  };

  const draftedIt = () =>
    api.updateEvent.mock.calls.some(
      ([, patch]) => (patch as any).status === 'draft'
    );

  it('offers to save a draft where it used to offer to cancel', async () => {
    await atPeoples();

    expect(
      screen.getByRole('button', { name: 'Save as draft' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('files the event under drafts when that is pressed', async () => {
    const onClose = await atPeoples();

    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(draftedIt()).toBe(true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does the same on the way back to the events', async () => {
    const onClose = await atPeoples();

    fireEvent.click(screen.getByRole('button', { name: 'Event' }));

    await waitFor(() => expect(draftedIt()).toBe(true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does the same on the way back to an earlier step', async () => {
    await atPeoples();

    fireEvent.click(screen.getByRole('button', { name: /Sessions/ }));

    await waitFor(() => expect(draftedIt()).toBe(true));
  });

  /** Walking off to another page unmounts the form rather than closing it. */
  it('does the same when the page is left altogether', async () => {
    const onClose = jest.fn();
    const { unmount } = render(
      <OrganizerProvider>
        <EventWizard event={made} onClose={onClose} onSaved={jest.fn()} />
      </OrganizerProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByRole('button', { name: 'Done' });

    unmount();

    await waitFor(() => expect(draftedIt()).toBe(true));
  });

  it('leaves a finished event alone', async () => {
    const onClose = await atPeoples();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(draftedIt()).toBe(false);
  });

  /**
   * An event set aside as a draft and then finished is scheduled again -
   * otherwise Done would leave it filed under drafts, which is where it
   * was put for not being done.
   */
  it('takes one back out of the drafts when it is finished', async () => {
    await atPeoples();
    fireEvent.click(screen.getByRole('button', { name: /Sessions/ }));
    await waitFor(() => expect(draftedIt()).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    await waitFor(() =>
      expect(
        api.updateEvent.mock.calls.some(
          ([, patch]) => (patch as any).status === 'scheduled'
        )
      ).toBe(true)
    );
  });

  /** An event under way is not a draft, whatever the form does. */
  it('will not file a running event under drafts', async () => {
    const onClose = jest.fn();
    api.updateEvent.mockImplementation(
      async (_id: string, patch: any) => ({ ...made, status: 'active', ...patch })
    );
    render(
      <OrganizerProvider>
        <EventWizard
          event={{ ...made, status: 'active' } as any}
          onClose={onClose}
          onSaved={jest.fn()}
        />
      </OrganizerProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(draftedIt()).toBe(false);
  });
});

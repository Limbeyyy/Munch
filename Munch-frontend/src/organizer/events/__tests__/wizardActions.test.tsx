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
  api.updateEvent.mockResolvedValue(made);
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

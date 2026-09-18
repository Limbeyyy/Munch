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

const made = {
  id: 'e1', title: 'Emergency Services', description: '', venue: 'Bhrikuti Mandap',
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
});

const newEvent = () =>
  render(
    <OrganizerProvider>
      <EventWizard onClose={jest.fn()} onSaved={jest.fn()} />
    </OrganizerProvider>
  );

const set = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/**
 * When an event runs.
 *
 * The form used to ask only for a date, so the server fell back to the
 * moment the form was saved: an event typed at 09:11 was recorded as
 * 09:11 to 10:11, hours nobody had chosen. The hours are asked for now.
 */
describe('the hours an event keeps', () => {
  it('asks for them, rather than taking the moment you pressed save', () => {
    newEvent();

    expect(screen.getByLabelText(/Starts/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ends/)).toBeInTheDocument();
  });

  it('sends the start it was given, and the length between the two', async () => {
    newEvent();
    set(/Event name/, 'Emergency Services');
    set(/Starts/, '2026-09-18T09:30');
    set(/Ends/, '2026-09-18T10:30');

    fireEvent.click(screen.getByRole('button', { name: /Create event/ }));

    await waitFor(() => expect(api.createEvent).toHaveBeenCalled());
    const sent = api.createEvent.mock.calls[0][0];
    expect(new Date(sent.scheduled_start!).getHours()).toBe(9);
    expect(new Date(sent.scheduled_start!).getMinutes()).toBe(30);
    expect(sent.duration_minutes).toBe(60);
    // The day is the day it starts on, so the two cannot disagree.
    expect(sent.event_date).toBe('2026-09-18');
  });

  it('keeps a long event long', async () => {
    newEvent();
    set(/Event name/, 'All day');
    set(/Starts/, '2026-09-18T09:00');
    set(/Ends/, '2026-09-18T17:00');

    fireEvent.click(screen.getByRole('button', { name: /Create event/ }));

    await waitFor(() => expect(api.createEvent).toHaveBeenCalled());
    expect(api.createEvent.mock.calls[0][0].duration_minutes).toBe(480);
  });

  it('refuses an end that comes before the start', async () => {
    newEvent();
    set(/Event name/, 'Backwards');
    set(/Starts/, '2026-09-18T10:00');
    // Typed straight into the end, so the start does not drag it along.
    set(/Ends/, '2026-09-18T09:00');

    fireEvent.click(screen.getByRole('button', { name: /Create event/ }));

    expect(api.createEvent).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('carries the end along when the start is moved past it', () => {
    newEvent();
    set(/Starts/, '2026-09-18T09:00');
    set(/Ends/, '2026-09-18T09:30');
    set(/Starts/, '2026-09-18T11:00');

    // An hour after the new start, rather than left behind in the morning.
    expect(screen.getByLabelText(/Ends/)).toHaveValue('2026-09-18T12:00');
  });

  /**
   * The end is a formality. Nothing closes an event on its clock - the
   * host does - so the length here only sets what the programme says.
   */
  it('says so on the form, so the hour is not read as a deadline', () => {
    newEvent();

    expect(
      screen.getByText(/the event runs until the host ends it/i)
    ).toBeInTheDocument();
  });
});

describe('where the first agenda item starts', () => {
  it('is offered the hour the event opens', async () => {
    newEvent();
    set(/Event name/, 'Emergency Services');
    set(/Starts/, '2026-09-18T09:30');
    set(/Ends/, '2026-09-18T10:30');
    fireEvent.click(screen.getByRole('button', { name: /Create event/ }));
    // Wait for step two itself; the call going out is a tick earlier
    // than the step it advances to.
    const create = await screen.findByRole('button', { name: /Create New Sessions/ });

    fireEvent.click(create);

    // The dialog opens on the event's own start, not on a fixed 10:00.
    expect(await screen.findByDisplayValue('09:30')).toBeInTheDocument();
  });
});

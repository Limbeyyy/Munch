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
    getSubEvents: jest.fn(),
    createSubEvent: jest.fn(),
    deleteSubEvent: jest.fn(),
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
  // No named parts unless a test says so: the plain list is the
  // ordinary case and every one of these predates them.
  api.getSubEvents.mockResolvedValue([] as any);
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
    const create = await screen.findByRole('button', { name: /Create New Agendas/ });

    fireEvent.click(create);

    // The dialog opens on the event's own start, not on a fixed 10:00.
    expect(await screen.findByDisplayValue('09:30')).toBeInTheDocument();
  });
});

/**
 * The parts a day divides into, named on the step that describes it.
 *
 * Which is also the step that creates the event, so on a new one there
 * is nothing yet to hang a heading off. They wait and are written the
 * moment there is - the same way the agenda form holds a file picked
 * before its talk exists.
 */
describe('naming the parts of an event', () => {
  const add = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: '+ New Subcategories' }));
    fireEvent.change(screen.getByLabelText('Subcategory name'), {
      target: { value: name },
    });
    fireEvent.keyDown(screen.getByLabelText('Subcategory name'), { key: 'Enter' });
  };

  it('says plainly that it is optional', () => {
    newEvent();

    expect(screen.getByText('Event Subcategories')).toBeInTheDocument();
    expect(
      screen.getByText('Select one or more sessions. This is optional.')
    ).toBeInTheDocument();
  });

  it('lists what has been named, numbered the way the design numbers it', () => {
    newEvent();

    add('Climate Change');
    add('Carbon emissions');

    expect(screen.getByText('Climate Change')).toBeInTheDocument();
    expect(screen.getByText('Carbon emissions')).toBeInTheDocument();
    expect(screen.getByText('01.')).toBeInTheDocument();
    expect(screen.getByText('02.')).toBeInTheDocument();
  });

  /**
   * Nothing is written while the event does not exist: there is no
   * event for a heading to belong to, and inventing one would create
   * an event the host had not finished describing.
   */
  it('writes nothing until the event itself exists', () => {
    newEvent();

    add('Climate Change');

    expect(api.createSubEvent).not.toHaveBeenCalled();
  });

  it('writes them the moment the event does exist', async () => {
    newEvent();
    set(/Event name/, 'Emergency Services');
    add('Climate Change');
    add('Carbon emissions');

    fireEvent.click(screen.getByRole('button', { name: /Create event/ }));

    await waitFor(() => expect(api.createSubEvent).toHaveBeenCalledTimes(2));
    expect(api.createSubEvent.mock.calls.map((c: any[]) => [c[0], c[1].title]))
      .toEqual([['e1', 'Climate Change'], ['e1', 'Carbon emissions']]);
  });

  /** A heading that will not write does not undo the event. */
  it('keeps the event when a heading cannot be written', async () => {
    api.createSubEvent.mockRejectedValue(new Error('nope'));
    newEvent();
    set(/Event name/, 'Emergency Services');
    add('Climate Change');

    fireEvent.click(screen.getByRole('button', { name: /Create event/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.createEvent).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Agendas' }))
      .toBeInTheDocument();
  });

  it('lets one be taken back off before anything is written', () => {
    newEvent();

    add('Climate Change');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Climate Change' }));

    expect(screen.queryByText('Climate Change')).not.toBeInTheDocument();
  });

  /** An empty name is not a heading, so pressing add and walking away
      leaves the list as it was. */
  it('does not name a part nothing was typed into', () => {
    newEvent();

    fireEvent.click(screen.getByRole('button', { name: '+ New Subcategories' }));
    fireEvent.blur(screen.getByLabelText('Subcategory name'));

    expect(screen.getByRole('button', { name: '+ New Subcategories' }))
      .toBeInTheDocument();
    expect(screen.queryByText('01.')).not.toBeInTheDocument();
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { AddAgendaDialog } from '../AddAgendaDialog';
import { apiClient } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  apiClient: { createSession: jest.fn() },
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
  type('Name *', 'Sarah Sharma');
  type('Email', 'sarah@example.com');
  type('Phone', '9800000001');
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
    type('Position', 'Director, Emergency Services');

    fireEvent.click(screen.getByRole('button', { name: 'Add session' }));

    await waitFor(() => expect(api.createSession).toHaveBeenCalled());
    const sent = api.createSession.mock.calls[0][0];
    expect(sent.event).toBe('e1');
    expect(sent.title).toBe('Opening');
    expect(sent.speaker_role).toBe('Director, Emergency Services');
    expect(sent.duration_minutes).toBe(30);
    // The time typed is on the event's day, not on today.
    expect(new Date(sent.starts_at).toDateString())
      .toBe(new Date('2026-09-15T11:30').toDateString());
    await waitFor(() => expect(added).toHaveBeenCalled());
  });

  it('will not write one with no name', async () => {
    show();
    type('Name *', 'Sarah Sharma');
    type('Email', 'sarah@example.com');
    type('Phone', '9800000001');

    fireEvent.click(screen.getByRole('button', { name: 'Add session' }));

    expect(api.createSession).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  /**
   * The server will not take a speaker it cannot reach afterwards, and
   * says so field by field. Catching it here spares a round trip - and a
   * form that looked as though it had saved.
   */
  it('will not write one the server would refuse for want of a phone', async () => {
    show();
    type('Emergency Response Overview', 'Opening');
    type('Name *', 'Sarah Sharma');
    type('Email', 'sarah@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Add session' }));

    expect(api.createSession).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('closes without writing anything', () => {
    const { closed } = show();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(closed).toHaveBeenCalled();
    expect(api.createSession).not.toHaveBeenCalled();
  });
});

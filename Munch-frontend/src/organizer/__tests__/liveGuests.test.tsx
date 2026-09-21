import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { LiveView } from '../views/LiveView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getPendingMessages: jest.fn(),
    getGuests: jest.fn(),
    listSessions: jest.fn(),
    admitGuest: jest.fn(),
    getResources: jest.fn(),
    getConclusions: jest.fn(),
    getEventBoard: jest.fn(),
    getTranscript: jest.fn(),
    getEventSegments: jest.fn(),
    getPhotos: jest.fn(),
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

const event = {
  id: 'm1', code: 'ABC123', title: 'Opening day', status: 'active',
  scheduled_start: new Date(Date.now() - 600000).toISOString(),
  scheduled_end: new Date(Date.now() + 3600000).toISOString(),
  started_at: new Date(Date.now() - 600000).toISOString(),
  participant_count: 1, sessions: [], session_count: 0,
  created_at: '', updated_at: '',
} as any;

const knocking = {
  id: 'g9', full_name: 'Rahul Ingnam', phone: null,
  status: 'pending', created_at: new Date().toISOString(), decided_at: null,
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getPendingMessages.mockResolvedValue([] as any);
  api.getGuests.mockResolvedValue([knocking] as any);
  api.listSessions.mockResolvedValue([] as any);
  api.admitGuest.mockResolvedValue({} as any);
  api.getResources.mockResolvedValue([] as any);
  api.getConclusions.mockResolvedValue({ conclusions: [] } as any);
  api.getEventBoard.mockResolvedValue({ faq: [], suggestions: [] } as any);
  api.getTranscript.mockResolvedValue({ segments: [] } as any);
  api.getEventSegments.mockResolvedValue([] as any);
  api.getPhotos.mockResolvedValue({ folders: [], photos: [] } as any);
  api.getSchedulingPrefs.mockResolvedValue({ session_gap_minutes: 15 } as any);
});

const show = () =>
  render(
    <MemoryRouter>
      <OrganizerProvider>
        <LiveView events={[event]} onChanged={jest.fn()} onNavigate={jest.fn()} />
      </OrganizerProvider>
    </MemoryRouter>
  );

/**
 * A guest at the door, from live control.
 *
 * Moderation used to carry a queue of them; it does not any more. This
 * card and the popup inside the room are the whole of how somebody is
 * let in, and both call the same endpoint.
 */
describe('the join request queue', () => {
  it('names who is waiting', async () => {
    show();

    expect(await screen.findByText('Rahul Ingnam')).toBeInTheDocument();
    expect(screen.getByText('Join Request')).toBeInTheDocument();
  });

  it('lets them in', async () => {
    show();
    await screen.findByText('Rahul Ingnam');

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() =>
      expect(api.admitGuest).toHaveBeenCalledWith('m1', 'g9', 'admit')
    );
  });

  it('turns them away', async () => {
    show();
    await screen.findByText('Rahul Ingnam');

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    await waitFor(() =>
      expect(api.admitGuest).toHaveBeenCalledWith('m1', 'g9', 'deny')
    );
  });

  /** Somebody already in the room is not still knocking. */
  it('leaves out a guest who has already been let in', async () => {
    api.getGuests.mockResolvedValue([
      { ...knocking, id: 'g8', full_name: 'Sumin Maharjan', status: 'admitted' },
      knocking,
    ] as any);
    show();
    await screen.findByText('Rahul Ingnam');

    expect(screen.queryByText('Sumin Maharjan')).toBeNull();
  });
});

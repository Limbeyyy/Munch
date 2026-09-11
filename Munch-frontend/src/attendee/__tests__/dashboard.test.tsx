import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../../organizer/i18n';
import { DashboardView } from '../views/DashboardView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getMeetingSegments: jest.fn(),
    getResources: jest.fn(),
    getConclusions: jest.fn(),
    getMeetingBoard: jest.fn(),
    getPhotos: jest.fn(),
    getPhotoObjectUrl: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const meeting = {
  id: 'm1', title: 'Opening day', meeting_code: 'ABC123', status: 'active',
  scheduled_start: new Date(Date.now() - 600000).toISOString(),
  scheduled_end: new Date(Date.now() + 3600000).toISOString(),
} as any;

const session = (over: any = {}) => ({
  id: 's1',
  title: 'Health service delivery',
  speaker_name: 'Dr Sarita Poudel',
  hall: 'Hall A',
  starts_at: new Date(Date.now() - 600000).toISOString(),
  ends_at: new Date(Date.now() + 1800000).toISOString(),
  duration_minutes: 40,
  status: 'live',
  ...over,
});

const item = (over: any = {}) => ({ meeting, session: session(over) });

const show = (props: any = {}) =>
  render(
    <OrganizerProvider>
      <DashboardView
        event={null}
        items={[item()]}
        live={item()}
        attendedIds={new Set()}
        onOpen={jest.fn()}
        onNavigate={jest.fn()}
        onJoinRoom={jest.fn()}
        elapsed={120}
        {...props}
      />
    </OrganizerProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getMeetingSegments.mockResolvedValue([]);
  api.getResources.mockResolvedValue([]);
  api.getConclusions.mockResolvedValue({ conclusions: [], mine: [] } as any);
  api.getMeetingBoard.mockResolvedValue({ faq: [], suggestions: [] } as any);
});

describe('the live dashboard', () => {
  it('names itself and the session on stage', async () => {
    show();

    expect(
      await screen.findByRole('heading', { name: 'Live Dashboard' })
    ).toBeInTheDocument();
    // The title appears on the stage card and again in the agenda below.
    expect(screen.getAllByText('Health service delivery').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dr Sarita Poudel').length).toBeGreaterThan(0);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('offers the way back into the room', async () => {
    const onJoinRoom = jest.fn();
    show({ onJoinRoom });

    fireEvent.click(await screen.findByRole('button', { name: /Back to Live Room/ }));

    expect(onJoinRoom).toHaveBeenCalledWith(meeting);
  });

  it('will not send somebody in before the door opens', async () => {
    // The same quarter of an hour every other screen keeps.
    show({
      live: null,
      items: [item({
        id: 's9', status: 'scheduled',
        starts_at: new Date(Date.now() + 3 * 3600000).toISOString(),
        ends_at: new Date(Date.now() + 4 * 3600000).toISOString(),
      })],
    });

    expect(
      await screen.findByRole('button', { name: /Back to Live Room/ })
    ).toBeDisabled();
  });

  it('reads the transcript as it arrives', async () => {
    api.getMeetingSegments.mockResolvedValue([
      { speaker_name: 'Sarita', text: 'The grant is released.', start_time: 12,
        end_time: 18, is_final: true, confidence: 1 },
    ] as any);

    show();

    expect(await screen.findByText(/The grant is released/)).toBeInTheDocument();
    expect(api.getMeetingSegments).toHaveBeenCalledWith('ABC123');
  });

  it('has the three panels the design gives it', async () => {
    show();

    for (const label of ['Slides', 'Questions', 'Photos']) {
      expect(await screen.findByRole('tab', { name: label })).toBeInTheDocument();
    }
  });

  it('shows the day underneath, with what a session came to', async () => {
    api.getConclusions.mockResolvedValue({
      conclusions: [{
        session_id: 's1', session_title: 'Health service delivery',
        session_starts_at: session().starts_at, speaker_name: 'Dr Sarita Poudel',
        hall: 'Hall A', meeting_id: 'm1', meeting_title: 'Opening day',
        event_id: 'e1', event_title: 'Conference',
        findings: ['Conditional grant released'], actions: [],
        published_at: new Date().toISOString(),
      }],
      mine: [],
    } as any);

    show();

    expect(
      await screen.findByRole('heading', { name: 'Agenda Summary' })
    ).toBeInTheDocument();
    expect(await screen.findByText('Conditional grant released')).toBeInTheDocument();
  });

  it('says so plainly when a session has published nothing', async () => {
    show();

    await screen.findByRole('heading', { name: 'Agenda Summary' });
    expect(
      screen.getByText(/Nothing has been published for this session yet/)
    ).toBeInTheDocument();
  });

  it('opens whichever session in the day is picked', async () => {
    api.getConclusions.mockResolvedValue({ conclusions: [], mine: [] } as any);
    show({
      items: [item(), item({ id: 's2', title: 'Digital records', status: 'scheduled' })],
    });

    fireEvent.click(await screen.findByText('Digital records'));

    await waitFor(() =>
      expect(screen.getByText('Digital records').closest('button'))
        .toHaveAttribute('aria-current', 'true')
    );
  });
});

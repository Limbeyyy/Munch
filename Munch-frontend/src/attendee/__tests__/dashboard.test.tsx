import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    // The same quarter of an hour every other screen keeps - counted from
    // the meeting, because the room is the meeting's.
    const later = {
      ...meeting,
      status: 'scheduled',
      scheduled_start: new Date(Date.now() + 3 * 3600000).toISOString(),
      scheduled_end: new Date(Date.now() + 5 * 3600000).toISOString(),
    };
    show({
      live: null,
      items: [{
        meeting: later,
        session: session({
          id: 's9', status: 'scheduled',
          starts_at: new Date(Date.now() + 3 * 3600000).toISOString(),
        }),
      }],
    });

    expect(
      await screen.findByRole('button', { name: /Back to Live Room/ })
    ).toBeDisabled();
  });

  it('still lets somebody in between two talks', async () => {
    // Nothing on stage and the next talk three hours off, but the meeting
    // is running: the room holds the whole running order, gaps and all.
    show({
      live: null,
      items: [item({
        id: 's9', status: 'scheduled',
        starts_at: new Date(Date.now() + 3 * 3600000).toISOString(),
      })],
    });

    expect(
      await screen.findByRole('button', { name: /Back to Live Room/ })
    ).toBeEnabled();
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

/**
 * The same screen, put to the host's use.
 *
 * Live control is this dashboard - what is on stage, what is being said,
 * what the day has come to - with the things only a host does added to
 * it. Passing them in beats a second copy of the layout that would drift
 * from this one, so what matters is that the slots are there and that
 * nobody else is given them.
 */
describe('the host slots on the dashboard', () => {
  it("puts their heading at the top instead of the reader's", async () => {
    show({
      heading: {
        title: { ne: 'लाइभ नियन्त्रण', en: 'Live control' },
        lede: { ne: '', en: 'Start and end sessions.' },
      },
    });

    expect(await screen.findByRole('heading', { name: 'Live control' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Live Dashboard' })).toBeNull();
  });

  it('puts their controls on the card with the talk they act on', async () => {
    const ended = jest.fn();
    show({ stageActions: <button onClick={ended}>End session</button> });

    fireEvent.click(await screen.findByRole('button', { name: 'End session' }));

    expect(ended).toHaveBeenCalled();
  });

  it('puts their panels on the screen at all', async () => {
    show({ extras: <p>Asking to come in</p> });

    expect(await screen.findByText('Asking to come in')).toBeInTheDocument();
  });

  it('and gives an attendee none of it', async () => {
    show();

    expect(await screen.findByRole('heading', { name: 'Live Dashboard' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    expect(screen.queryByText('Asking to come in')).toBeNull();
  });
});

/**
 * Where each thing sits, and what colour it is.
 *
 * The day and whatever the host has to act on share the bottom half and
 * half, rather than the host's panels being stacked down beside the
 * transcript where the eye has already moved on. And the summary wears
 * the room's navy rather than a teal of its own.
 */
describe('the foot of the screen', () => {
  it('gives the day the full width when there is nothing to act on', async () => {
    show();

    const heading = await screen.findByRole('heading', { name: 'Agenda Summary' });
    const row = heading.closest('div')!.parentElement!.parentElement!;
    expect(row.className).not.toContain('xl:grid-cols-2');
  });

  it('and shares it when there is', async () => {
    show({ extras: <p>Asking to come in</p> });

    const heading = await screen.findByRole('heading', { name: 'Agenda Summary' });
    const row = heading.closest('div')!.parentElement!.parentElement!;
    expect(row.className).toContain('xl:grid-cols-2');
    expect(within(row).getByText('Asking to come in')).toBeInTheDocument();
  });

  it("draws the summary in the room's navy", async () => {
    show();

    const summary = (await screen.findByText('Summary')).closest('div')!.parentElement!
      .parentElement!;
    expect(summary.className).toContain('bg-navy-800');
    expect(summary.className).not.toContain('007092');
  });
});

/**
 * Which tab is being read, and how the screen says so.
 *
 * The amber rule under the chosen tab is the mark the rest of the app
 * uses; the panel tabs here were underlining in black, which reads as a
 * heavier thing than choosing a tab.
 */
describe('the chosen tab', () => {
  it('carries the amber rule under it', async () => {
    show();

    const chosen = await screen.findByRole('tab', { name: 'Questions' });
    expect(chosen).toHaveAttribute('aria-selected', 'true');
    expect(chosen.className).toContain('border-amber');
  });

  it('and the others carry none', async () => {
    show();

    const other = await screen.findByRole('tab', { name: 'Photos' });
    expect(other).toHaveAttribute('aria-selected', 'false');
    expect(other.className).toContain('border-transparent');
  });

  it('moves with the reader', async () => {
    show();

    fireEvent.click(await screen.findByRole('tab', { name: 'Slides' }));

    expect(screen.getByRole('tab', { name: 'Slides' }).className)
      .toContain('border-amber');
    expect(screen.getByRole('tab', { name: 'Questions' }).className)
      .toContain('border-transparent');
  });
});

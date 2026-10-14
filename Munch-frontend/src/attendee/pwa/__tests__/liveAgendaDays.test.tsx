import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../../organizer/i18n';
import { LiveRoom } from '../LiveRoom';
import { apiClient } from '../../../services/api';

/**
 * The day filter in the room, and the bar under it.
 *
 * The agenda outside the room had this row right and the one inside it
 * did not: the chips were allowed to shrink and their label to wrap, so
 * "Day 1" came apart onto two lines and each chip drew as a circle, and
 * the row had nowhere to scroll so a seventh day pushed the page wider
 * than the screen instead of going under the thumb.
 *
 * A page wider than the screen is also what took the bottom bar out of
 * sight on this tab and no other, so both are pinned here together.
 */
jest.mock('../../../services/api', () => ({
  apiClient: {
    listEvents: jest.fn(),
    getActiveEvents: jest.fn(),
    listSessions: jest.fn(),
    getEventSegments: jest.fn(),
    getSessionSummary: jest.fn(),
    getSpeakers: jest.fn(),
    getHub: jest.fn(),
    getResources: jest.fn(),
    getSubEvents: jest.fn(),
    getPhotos: jest.fn(),
    getPhotoObjectUrl: jest.fn(),
    joinEvent: jest.fn(),
    leaveEvent: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn(),
  }),
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

beforeAll(() => { (Element.prototype as any).scrollIntoView = jest.fn(); });

/** Nine days, which is what put the row past the edge of the screen. */
const DAYS = 9;

const event = {
  id: 'e1', code: 'ABC-123', title: 'Example event', description: '',
  venue: 'Kathmandu', status: 'active', idle_timeout_minutes: 0,
  event_date: '2026-09-15',
  scheduled_start: '2026-09-15T04:00:00Z',
  scheduled_end: '2026-09-23T10:00:00Z',
  started_at: '2026-09-15T04:00:00Z',
  participant_count: 0, sessions: [], session_count: DAYS,
  created_at: '', updated_at: '',
} as any;

const sessions = Array.from({ length: DAYS }, (_, i) => ({
  id: `s${i + 1}`, event: 'e1', title: `Talk ${i + 1}`, description: '',
  starts_at: `2026-09-${15 + i}T04:00:00Z`,
  ends_at: `2026-09-${15 + i}T05:00:00Z`,
  duration_minutes: 60,
  status: 'scheduled', speaker_name: '', speaker_email: '', speaker_phone: '',
  sub_event: null, created_at: '', updated_at: '',
})) as any[];

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getActiveEvents.mockResolvedValue([event]);
  api.listEvents.mockResolvedValue([event]);
  api.listSessions.mockResolvedValue(sessions);
  api.getSubEvents.mockResolvedValue([]);
  api.getResources.mockResolvedValue([]);
  api.getHub.mockResolvedValue({ questions: [], suggestions: [] } as any);
  api.getEventSegments.mockResolvedValue([]);
  api.getSessionSummary.mockResolvedValue(null as any);
  (api as any).getSpeakers?.mockResolvedValue?.([]);
  api.getPhotos.mockResolvedValue({ folders: [], photos: [] } as any);
  api.joinEvent.mockResolvedValue({} as any);
  api.leaveEvent.mockResolvedValue({} as any);
});

const openAgenda = async () => {
  render(
    <OrganizerProvider>
      <LiveRoom onLeave={jest.fn()} />
    </OrganizerProvider>
  );
  const bar = await screen.findByRole('navigation', { name: 'Sections' });
  within(bar).getByText('Agenda').click();
  return bar;
};

/** The row the chips sit in. */
const chipRow = () =>
  screen.getByRole('button', { name: 'Day 1' }).parentElement as HTMLElement;

describe('the day filter inside the live room', () => {
  it('shows one chip per day', async () => {
    await openAgenda();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: `Day ${DAYS}` }))
        .toBeInTheDocument());
  });

  /*
   * A chip that may shrink is a chip whose label wraps, and a wrapped
   * "Day 1" is the circle in the bug report.
   */
  it('keeps every chip its own width, with the label on one line', async () => {
    await openAgenda();
    await screen.findByRole('button', { name: 'Day 1' });

    for (let i = 1; i <= DAYS; i += 1) {
      const chip = screen.getByRole('button', { name: `Day ${i}` });
      expect(chip.className).toContain('flex-none');
      expect(chip.className).toContain('whitespace-nowrap');
      expect(chip.className).toContain('rounded-full');
    }
  });

  /* Reachable under a thumb, rather than pushing the page sideways. */
  it('scrolls sideways rather than widening the page', async () => {
    await openAgenda();
    await screen.findByRole('button', { name: 'Day 1' });

    expect(chipRow().className).toContain('overflow-x-auto');
  });

  /** Which is the same row the agenda outside the room already drew. */
  it('is drawn the same way as the agenda outside the room', async () => {
    await openAgenda();
    await screen.findByRole('button', { name: 'Day 1' });

    expect(chipRow().className).toContain('gap-2');
  });
});

describe('the bar along the bottom of the room', () => {
  it('is there on the agenda tab, as on every other', async () => {
    const bar = await openAgenda();
    await screen.findByRole('button', { name: 'Day 1' });

    expect(bar).toBeInTheDocument();
    ['Transcript', 'Agenda', 'Q&A', 'Files', 'Profile'].forEach((one) => {
      expect(within(bar).getByText(one)).toBeInTheDocument();
    });
  });

  it('stays pinned to the bottom of the screen', async () => {
    const bar = await openAgenda();
    await screen.findByRole('button', { name: 'Day 1' });

    expect(bar.className).toContain('fixed');
    expect(bar.className).toContain('bottom-0');
  });

  /*
   * One agenda item, opened, is the exception.
   *
   * That screen carries its own way back out, so the bar underneath
   * answers a question already answered - and on a phone it costs a
   * strip of the screen to repeat it.
   */
  it('goes away on one opened agenda item, which has its own way back',
    async () => {
      await openAgenda();

      fireEvent.click(await screen.findByText('Talk 1'));

      await waitFor(() =>
        expect(screen.queryByRole('navigation', { name: 'Sections' }))
          .toBeNull());
      // And the way back is still there, or there would be no way out.
      expect(screen.getByText('Agenda')).toBeInTheDocument();
    });

  it('comes back when that item is closed', async () => {
    await openAgenda();
    fireEvent.click(await screen.findByText('Talk 1'));
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull());

    fireEvent.click(screen.getByText('Agenda'));

    expect(await screen.findByRole('navigation', { name: 'Sections' }))
      .toBeInTheDocument();
  });

  /** Only that one screen: the photographs keep theirs. */
  it('stays on the files tab, folder open or not', async () => {
    const bar = await openAgenda();
    within(bar).getByText('Files').click();

    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Sections' }))
        .toBeInTheDocument());
  });
});

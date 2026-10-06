import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../../../organizer/i18n';
import { TranscriptScreen } from '../TranscriptScreen';
import { apiClient } from '../../../services/api';

/**
 * Which way the transcript runs on a phone in the hall.
 *
 * The line being said now is the one somebody holding a phone is
 * there for. At the foot of a list taller than the screen it is the
 * one line they cannot see, so it goes on top - and everything that
 * followed the speaker downwards has to follow them upwards instead,
 * or the page scrolls itself to the oldest line every few seconds.
 */
jest.mock('../../../services/api', () => ({
  apiClient: {
    getEventSegments: jest.fn(),
    getGuestSegments: jest.fn(),
    hasSession: () => false,
  },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const event = {
  id: 'e1', code: 'ABC123', title: 'Opening day', status: 'active',
  scheduled_start: new Date().toISOString(),
} as any;

const live = {
  id: 's1', title: 'Haldi',
  starts_at: new Date(Date.now() - 600000).toISOString(),
  started_at: new Date(Date.now() - 600000).toISOString(),
} as any;

/** As the server sends them: oldest first. */
const said = (text: string, minutesAgo: number) => ({
  id: text, event: 'e1', speaker_name: 'Room', text,
  language: 'en', start_time: 0, end_time: 0, confidence: 0, is_final: true,
  created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  // jsdom has no layout, so no scrollIntoView either.
  (Element.prototype as any).scrollIntoView = jest.fn();
  api.getEventSegments.mockResolvedValue([
    said('first thing said', 3),
    said('second thing said', 2),
    said('third thing said', 1),
  ] as any);
});

const show = () =>
  render(
    <OrganizerProvider>
      <TranscriptScreen event={event} live={live} />
    </OrganizerProvider>
  );

const onScreen = () =>
  Array.from(document.querySelectorAll('[data-transcript-line]'))
    .map((el) => (el.textContent || ''));

describe('the transcript on a phone in the hall', () => {
  it('puts the newest line at the top', async () => {
    show();

    await waitFor(() => expect(onScreen().length).toBe(3));
    const texts = onScreen();
    expect(texts[0]).toContain('third thing said');
    expect(texts[1]).toContain('second thing said');
    expect(texts[2]).toContain('first thing said');
  });

  it('marks the newest one as the one being said', async () => {
    show();

    await screen.findByText('Speaking');
    // The badge belongs to the line at the top, not to whatever
    // happens to be last in the array the server sent.
    expect(onScreen()[0]).toContain('Speaking');
  });

  it('follows the speaker upwards rather than down', async () => {
    const into = jest.fn();
    (Element.prototype as any).scrollIntoView = into;

    show();

    await waitFor(() => expect(onScreen().length).toBe(3));
    expect(into).toHaveBeenCalled();
    // Downwards would be `block: 'end'`, which is where the oldest
    // line now sits.
    expect(into.mock.calls.some(([opts]: any[]) => opts?.block === 'start'))
      .toBe(true);
    expect(into.mock.calls.some(([opts]: any[]) => opts?.block === 'end'))
      .toBe(false);
  });

  it('says nothing has been said when nothing has', async () => {
    api.getEventSegments.mockResolvedValue([] as any);

    show();

    expect(await screen.findByText('Nothing has been said yet.'))
      .toBeInTheDocument();
  });
});

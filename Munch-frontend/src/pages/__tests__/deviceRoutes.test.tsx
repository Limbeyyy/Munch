import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onDesktop, onMobile } from '../../services/device';
// The guards the application itself mounts, not copies of them.
import { DeviceRoute, GuestRoute } from '../../App';

/**
 * Which device each portal belongs to.
 *
 * The home redirect already chose a portal from the device, but it only
 * ran when somebody landed on "/". Typing /app on a laptop, or
 * /organizer on a phone, walked straight past it into a screen drawn
 * for the other thing - and guest entry, which is meant for phones
 * only, had a page saying so that nothing ever routed to.
 *
 * The decision belongs on the routes, where every way in passes through
 * it. These render the same guards the app does, over stand-ins for the
 * pages, so what is pinned is the routing and not the screens.
 */
const usingA = (kind: 'mouse' | 'finger') => {
  (window as any).matchMedia = (query: string) => ({
    matches: kind === 'mouse'
      ? /pointer: fine|hover: hover/.test(query)
      : /pointer: coarse|hover: none/.test(query),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  });
};

const app = (at: string) =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route
          path="/organizer"
          element={<DeviceRoute want="desktop"><p>organizer portal</p></DeviceRoute>}
        />
        <Route
          path="/app"
          element={<DeviceRoute want="mobile"><p>attendee app</p></DeviceRoute>}
        />
        <Route
          path="/guest/event"
          element={<GuestRoute><p>guest room</p></GuestRoute>}
        />
        <Route path="/guest/mobile-only" element={<p>guest mode is for mobile</p>} />
      </Routes>
    </MemoryRouter>
  );

describe('what the device decides', () => {
  it('reads a mouse that can hover as a desk', () => {
    usingA('mouse');
    expect(onDesktop()).toBe(true);
    expect(onMobile()).toBe(false);
  });

  it('reads a finger as a hand', () => {
    usingA('finger');
    expect(onDesktop()).toBe(false);
    expect(onMobile()).toBe(true);
  });
});

describe('typing the other portal in by hand', () => {
  it('sends a laptop asking for /app to the organizer', async () => {
    usingA('mouse');
    app('/app');

    expect(await screen.findByText('organizer portal')).toBeInTheDocument();
    expect(screen.queryByText('attendee app')).toBeNull();
  });

  it('sends a phone asking for /organizer to the app', async () => {
    usingA('finger');
    app('/organizer');

    expect(await screen.findByText('attendee app')).toBeInTheDocument();
    expect(screen.queryByText('organizer portal')).toBeNull();
  });
});

describe('asking for the portal that fits the device', () => {
  it('lets a laptop into the organizer', async () => {
    usingA('mouse');
    app('/organizer');

    expect(await screen.findByText('organizer portal')).toBeInTheDocument();
  });

  it('lets a phone into the app', async () => {
    usingA('finger');
    app('/app');

    expect(await screen.findByText('attendee app')).toBeInTheDocument();
  });
});

describe('guest entry', () => {
  /** A guest has no account to be sent to, so they are told why. */
  it('turns a laptop away and says so', async () => {
    usingA('mouse');
    app('/guest/event');

    expect(await screen.findByText('guest mode is for mobile'))
      .toBeInTheDocument();
    expect(screen.queryByText('guest room')).toBeNull();
  });

  it('lets a phone in', async () => {
    usingA('finger');
    app('/guest/event');

    expect(await screen.findByText('guest room')).toBeInTheDocument();
  });

  /** The page that says so must itself be reachable from a laptop. */
  it('does not bounce the explanation itself', async () => {
    usingA('mouse');
    app('/guest/mobile-only');

    await waitFor(() =>
      expect(screen.getByText('guest mode is for mobile')).toBeInTheDocument());
  });
});

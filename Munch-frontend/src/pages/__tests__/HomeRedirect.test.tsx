import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HomeRedirect, markFreshSignIn, rememberPortal, forgetPortal,
} from '../HomeRedirect';
import { apiClient } from '../../services/api';
import { UserRoles } from '../../types';

jest.mock('../../services/api', () => ({
  apiClient: { getMyRoles: jest.fn(), startHosting: jest.fn() },
}));

const roles = (over: Partial<UserRoles> = {}): UserRoles => ({
  is_host: true,
  is_attendee: false,
  can_start_hosting: false,
  portals: ['host'],
  plan: { id: 'free', name: 'Free', paid: false, limits: {
    events: 2, sessions_per_event: 2, attendees: 100,
  } },
  usage: { events: 0, sessions: 0, attendees: 0 },
  subscription: null,
  ...over,
});

/**
 * What the browser says about the thing it is running on.
 *
 * A mouse that can hover is a desk; a coarse pointer that cannot is a
 * hand. jsdom answers neither by default, so each test says which.
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

/**
 * Rendered the way the real application renders it.
 *
 * StrictMode is what index.tsx wraps the app in, and it runs every effect
 * twice. Leaving it out of the test is how a screen that mounted and was
 * immediately replaced managed to look like it worked.
 */
const show = () =>
  render(
    <React.StrictMode>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/organizer" element={<p>organizer portal</p>} />
          <Route path="/app" element={<p>attendee portal</p>} />
        </Routes>
      </MemoryRouter>
    </React.StrictMode>
  );

beforeEach(() => {
  jest.clearAllMocks();
  forgetPortal();
  window.sessionStorage.clear();
  (apiClient.startHosting as jest.Mock).mockResolvedValue({});
  usingA('mouse');
});

/**
 * There used to be a card asking which portal. It was a question
 * almost nobody needed: the device already says it.
 */
describe('signing in', () => {
  it('asks nothing at all', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_attendee: true, portals: ['host', 'attendee'] })
    );
    markFreshSignIn();

    show();

    expect(await screen.findByText('organizer portal')).toBeInTheDocument();
    expect(screen.queryByText(/Sign in as/)).not.toBeInTheDocument();
  });

  it('takes a desk to the host portal', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_attendee: true, portals: ['host', 'attendee'] })
    );
    markFreshSignIn();

    show();

    expect(await screen.findByText('organizer portal')).toBeInTheDocument();
  });

  it('takes a phone to the attendee app', async () => {
    usingA('finger');
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_attendee: true, portals: ['host', 'attendee'] })
    );
    markFreshSignIn();

    show();

    expect(await screen.findByText('attendee portal')).toBeInTheDocument();
  });

  /**
   * The device is a guess about what somebody came to do. It cannot
   * hand them a role they do not hold.
   */
  it('does not send a host-only account to the attendee app on a phone', async () => {
    usingA('finger');
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(roles());
    markFreshSignIn();

    show();

    expect(await screen.findByText('organizer portal')).toBeInTheDocument();
  });

  it('does not send an attendee-only account to the host portal at a desk', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_host: false, is_attendee: true, portals: ['attendee'] })
    );
    markFreshSignIn();

    show();

    expect(await screen.findByText('attendee portal')).toBeInTheDocument();
    expect(apiClient.startHosting).not.toHaveBeenCalled();
  });
});

describe('an account that holds neither role yet', () => {
  const brandNew = () => roles({
    is_host: false, can_start_hosting: true, portals: [],
    plan: null, usage: null,
  });

  /** Hosting is the only thing a new account can actually do. */
  it('opens the trial at a desk, so the door is not locked', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(brandNew());
    markFreshSignIn();

    show();

    expect(await screen.findByText('organizer portal')).toBeInTheDocument();
    await waitFor(() => expect(apiClient.startHosting).toHaveBeenCalled());
  });

  it('falls back to the attendee app where the trial cannot be opened', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(brandNew());
    (apiClient.startHosting as jest.Mock).mockRejectedValue(new Error('nope'));
    markFreshSignIn();

    show();

    expect(await screen.findByText('attendee portal')).toBeInTheDocument();
  });

  it('starts nothing on a phone', async () => {
    usingA('finger');
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(brandNew());
    markFreshSignIn();

    show();

    expect(await screen.findByText('attendee portal')).toBeInTheDocument();
    expect(apiClient.startHosting).not.toHaveBeenCalled();
  });
});

describe('arriving without having just signed in', () => {
  /** Somebody who switched should not be sent back by their device. */
  it('honours what they last chose over the device', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_attendee: true, portals: ['host', 'attendee'] })
    );
    rememberPortal('attendee');

    show();

    expect(await screen.findByText('attendee portal')).toBeInTheDocument();
  });

  it('ignores a remembered choice that no longer applies', async () => {
    usingA('finger');
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_host: false, is_attendee: true, portals: ['attendee'] })
    );
    rememberPortal('host');

    show();

    expect(await screen.findByText('attendee portal')).toBeInTheDocument();
  });

  it('falls back to the attendee app when roles cannot be read', async () => {
    (apiClient.getMyRoles as jest.Mock).mockRejectedValue(new Error('offline'));

    show();

    expect(await screen.findByText('attendee portal')).toBeInTheDocument();
  });
});

describe('what the device is read from', () => {
  /** A narrowed window on a laptop is still a laptop. */
  it('reads the pointer, not the width', async () => {
    (window as any).innerWidth = 380;
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_attendee: true, portals: ['host', 'attendee'] })
    );
    markFreshSignIn();

    show();

    expect(await screen.findByText('organizer portal')).toBeInTheDocument();
  });

  /** A browser too old to answer still has to be sent somewhere. */
  it('falls back to the user agent', async () => {
    delete (window as any).matchMedia;
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_attendee: true, portals: ['host', 'attendee'] })
    );
    markFreshSignIn();

    show();

    expect(await screen.findByText('attendee portal')).toBeInTheDocument();
  });
});

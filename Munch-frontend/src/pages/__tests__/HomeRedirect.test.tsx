import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HomeRedirect, markFreshSignIn, rememberPortal, forgetPortal } from '../HomeRedirect';
import { apiClient } from '../../services/api';
import { UserRoles } from '../../types';

// English is what a browser that has never chosen is shown; Nepali is
// still the source language, and a stored choice still wins.
const HOST_CARD = 'Sign in as host';
const ATTENDEE_CARD = 'Sign in as attendee';
const FREE_TRIAL = 'Free trial: 2 events, 2 meetings each, 2 sessions each.';

jest.mock('../../services/api', () => ({
  apiClient: { getMyRoles: jest.fn(), startHosting: jest.fn() },
}));

const roles = (over: Partial<UserRoles> = {}): UserRoles => ({
  is_host: true,
  is_attendee: false,
  can_start_hosting: false,
  portals: ['host'],
  plan: { id: 'free', name: 'Free', paid: false, limits: {
    events: 2, meetings: 4, meetings_per_event: 2, sessions_per_meeting: 2, attendees: 100,
  } },
  usage: { events: 0, meetings: 0, sessions: 0 },
  subscription: null,
  ...over,
});

/**
 * Rendered the way the real application renders it.
 *
 * StrictMode is what index.tsx wraps the app in, and it runs every effect
 * twice. Leaving it out of the test is how a chooser that mounted and was
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
});

describe('the chooser after signing in', () => {
  it('asks even somebody who only holds one role', async () => {
    // The bug this covers: a host-only account was routed straight through
    // and never saw the question.
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(roles());
    markFreshSignIn();

    show();

    expect(await screen.findByText(HOST_CARD)).toBeInTheDocument();
    expect(screen.getByText(ATTENDEE_CARD)).toBeInTheDocument();
  });

  it('asks somebody who holds both', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_attendee: true, portals: ['host', 'attendee'] })
    );
    markFreshSignIn();

    show();

    expect(await screen.findByText(HOST_CARD)).toBeInTheDocument();
  });

  it('asks somebody brand new, who holds neither yet', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_host: false, can_start_hosting: true, portals: [], plan: null, usage: null })
    );
    markFreshSignIn();

    show();

    expect(
      await screen.findByText(FREE_TRIAL)
    ).toBeInTheDocument();
  });

  it('stays on the chooser rather than being replaced a moment later', async () => {
    // The regression: with effects running twice, the second pass found
    // the mark already spent and routed straight through.
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(roles());
    markFreshSignIn();

    show();
    await screen.findByText(HOST_CARD);

    // Give any second pass a chance to navigate away before checking.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText(HOST_CARD)).toBeInTheDocument();
    expect(screen.queryByText('organizer portal')).not.toBeInTheDocument();
  });

  it('asks only once per sign-in', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(roles());
    markFreshSignIn();

    const first = show();
    fireEvent.click(await first.findByText(HOST_CARD));
    await first.findByText('organizer portal');
    first.unmount();

    // Coming back to "/" later is ordinary navigation, not a new sign-in.
    const second = show();
    expect(await second.findByText('organizer portal')).toBeInTheDocument();
  });
});

describe('arriving without having just signed in', () => {
  it('goes straight through for a single role', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(roles());

    show();

    expect(await screen.findByText('organizer portal')).toBeInTheDocument();
  });

  it('honours what they last chose', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_attendee: true, portals: ['host', 'attendee'] })
    );
    rememberPortal('attendee');

    show();

    expect(await screen.findByText('attendee portal')).toBeInTheDocument();
  });

  it('ignores a remembered choice that no longer applies', async () => {
    (apiClient.getMyRoles as jest.Mock).mockResolvedValue(
      roles({ is_host: false, portals: ['attendee'], plan: null, usage: null })
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

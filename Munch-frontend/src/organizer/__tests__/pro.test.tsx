import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { OrganizerShell } from '../OrganizerShell';
import { AppearanceView } from '../AppearanceView';
import { apiClient } from '../../services/api';

/**
 * What a free account is told, and where the type size reaches.
 *
 * Two separate things, tested together because both are about the shell
 * rather than about any one screen inside it.
 */
jest.mock('../../services/api', () => ({
  apiClient: { getMyRoles: jest.fn() },
}));

jest.mock('../../store/authStore', () => ({
  useAuthStore: () => ({
    user: { first_name: 'Sumin', last_name: 'Maharjan', email: 's@example.com' },
    logout: jest.fn(),
  }),
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const onPlan = (paid: boolean) =>
  api.getMyRoles.mockResolvedValue({
    is_host: true, is_attendee: false, can_start_hosting: false,
    portals: ['host'],
    plan: { id: 'p', name: paid ? 'Pro' : 'Free', paid, limits: {} },
    usage: null, subscription: null,
  } as any);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  document.documentElement.removeAttribute('data-text-size');
});

const shell = (view = 'events', onNavigate = jest.fn()) =>
  render(
    <OrganizerProvider>
      <OrganizerShell
        view={view}
        onNavigate={onNavigate}
        onOpenA11y={jest.fn()}
      >
        <p>the screen</p>
      </OrganizerShell>
    </OrganizerProvider>
  );

const BANNER = /You are using free plan as of now/;

describe('what a free account is told', () => {
  it('says so across the top, and offers the card on the rail', async () => {
    onPlan(false);
    shell();

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(screen.getByText('Get Pro Access')).toBeInTheDocument();
  });

  it('says nothing of the kind to somebody who has paid', async () => {
    onPlan(true);
    shell();

    await waitFor(() => expect(api.getMyRoles).toHaveBeenCalled());
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.queryByText('Get Pro Access')).toBeNull();
  });

  /*
   * Somebody already reading the plans does not need sending to them.
   *
   * The same free account is shown on another screen first, and only
   * then moved to the billing one. Rendering the billing screen on its
   * own proves nothing: the answer from the server is a promise, and
   * "the banner is absent" is true for a moment on every screen there
   * is - so a test that only looks once is passed by a shell that has
   * simply not heard back yet.
   */
  it('leaves the billing screen alone', async () => {
    onPlan(false);
    const { rerender } = shell('events');

    // Heard back, and saying so.
    await screen.findByText(BANNER);

    rerender(
      <OrganizerProvider>
        <OrganizerShell
          view="subscription"
          onNavigate={jest.fn()}
          onOpenA11y={jest.fn()}
        >
          <p>the screen</p>
        </OrganizerShell>
      </OrganizerProvider>
    );

    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.queryByText('Get Pro Access')).toBeNull();
  });

  /*
   * Not shown while the answer is still on its way.
   *
   * A paying host should never watch the line flash up and disappear,
   * so "not yet known" has to be its own answer rather than "free".
   */
  it('waits for the server before saying anything', async () => {
    api.getMyRoles.mockReturnValue(new Promise(() => undefined) as any);
    shell();

    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.queryByText('Get Pro Access')).toBeNull();
  });

  it('both ways in lead to the billing screen', async () => {
    onPlan(false);
    const went = jest.fn();
    shell('events', went);

    fireEvent.click(await screen.findByText('Upgrade Now!'));
    expect(went).toHaveBeenCalledWith('subscription');

    went.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Upgrade$/ }));
    expect(went).toHaveBeenCalledWith('subscription');
  });
});

describe('the text size', () => {
  const sizes = () =>
    render(
      <OrganizerProvider>
        <AppearanceView />
      </OrganizerProvider>
    );

  /*
   * One control, two settings.
   *
   * It used to size a transcript and nothing else, which left somebody
   * who found the type small everywhere with the one screen they had
   * not complained about made larger.
   */
  it('reaches the whole dashboard, not only a transcript', async () => {
    sizes();

    fireEvent.click(screen.getByRole('radio', { name: /large/i }));

    await waitFor(() => expect(
      document.documentElement.getAttribute('data-text-size')
    ).toBe('large'));
    expect(document.documentElement.getAttribute('data-transcript-size'))
      .toBe('large');
  });

  /** 'medium' is the size the design is drawn at, so it is the base. */
  it('treats the middle step as the base the design is drawn at', async () => {
    sizes();

    fireEvent.click(screen.getByRole('radio', { name: /small/i }));
    await waitFor(() => expect(
      document.documentElement.getAttribute('data-text-size')
    ).toBe('small'));

    fireEvent.click(screen.getByRole('radio', { name: /medium/i }));
    await waitFor(() => expect(
      document.documentElement.getAttribute('data-text-size')
    ).toBe('default'));
  });

  it('is kept, so it is still there on the way back', async () => {
    sizes();

    fireEvent.click(screen.getByRole('radio', { name: /large/i }));

    await waitFor(() => {
      const saved = JSON.parse(
        window.localStorage.getItem('manch.organizer.prefs') || '{}'
      );
      expect(saved.look.textSize).toBe('large');
    });
  });
});

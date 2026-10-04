import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../LoginPage';
import { GuestJoinDialog } from '../../components/GuestJoinDialog';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    guestKnock: jest.fn(),
    googleConnect: jest.fn(),
    // The auth store asks this as the module loads.
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

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: (values: Uint8Array) => {
        values.fill(7);
        return values;
      },
    },
  });
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile',
  });
});

const showLogin = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );

/**
 * What a guest is asked for at the door.
 *
 * A name, and nothing else. The telephone number that used to be required
 * was never used for anything - the host decides on the name, the register
 * keeps the name - so it was a box on a form collecting personal data for
 * its own sake.
 */
describe('the guest door', () => {
  const reachTheDialog = async () => {
    showLogin();
    fireEvent.click(screen.getByRole('button', { name: /Join with a event code/ }));
    fireEvent.change(screen.getByPlaceholderText('Event code'), {
      target: { value: 'abc123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enter event room' }));
    return screen.findByRole('dialog', { name: 'Enter event info' });
  };

  it('asks for the code first, and then for the name', async () => {
    const dialog = await reachTheDialog();

    expect(dialog).toHaveTextContent('Enter Event Info');
    expect(dialog).toHaveTextContent('ABC123');
    expect(screen.getByLabelText(/Your Name/)).toBeInTheDocument();
  });

  it('asks for nothing else at all', async () => {
    await reachTheDialog();

    expect(screen.queryByPlaceholderText(/Phone/i)).toBeNull();
    expect(screen.queryByLabelText(/phone/i)).toBeNull();
  });

  it('will not send a request without a name', async () => {
    await reachTheDialog();

    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();
  });

  it('sends the code and the name, and the token if there is one', async () => {
    window.sessionStorage.setItem('guest_token', 'held-token');
    api.guestKnock.mockResolvedValue({
      guest_token: 't', guest: { status: 'pending', full_name: 'Bishnu' },
      event: { code: 'ABC123', title: 'Opening day' },
    } as any);

    await reachTheDialog();
    fireEvent.change(screen.getByLabelText(/Your Name/), {
      target: { value: 'Bishnu Prasad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(api.guestKnock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ABC123',
        full_name: 'Bishnu Prasad',
        token: 'held-token',
      })
    ));
    expect(api.guestKnock.mock.calls[0][0].device_id).toMatch(/^[a-f0-9]{48}$/);
  });

  it('says what becomes of the name, because that is the question', async () => {
    const dialog = await reachTheDialog();

    expect(dialog).toHaveTextContent(/kept for this event only/);
  });
});

describe('remembering a name', () => {
  const join = jest.fn();

  const showDialog = () =>
    render(
      <GuestJoinDialog
        eventCode="ABC123"
        onCancel={jest.fn()}
        onJoin={join}
      />
    );

  it('keeps it in this browser when asked to', () => {
    showDialog();

    fireEvent.change(screen.getByLabelText(/Your Name/), {
      target: { value: 'Bishnu Prasad' },
    });
    fireEvent.click(screen.getByLabelText(/Remember my name/));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(window.localStorage.getItem('manch.guest.name')).toBe('Bishnu Prasad');
  });

  it('fills it in next time, so the door is one press', () => {
    window.localStorage.setItem('manch.guest.name', 'Bishnu Prasad');

    showDialog();

    expect(screen.getByLabelText(/Your Name/)).toHaveValue('Bishnu Prasad');
    expect(screen.getByLabelText(/Remember my name/)).toBeChecked();
  });

  it('forgets it again when the box is cleared', () => {
    window.localStorage.setItem('manch.guest.name', 'Bishnu Prasad');
    showDialog();

    fireEvent.click(screen.getByLabelText(/Remember my name/));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(window.localStorage.getItem('manch.guest.name')).toBeNull();
  });

  it('keeps it here and nowhere else: the request carries only the name', () => {
    window.localStorage.setItem('manch.guest.name', 'Bishnu Prasad');
    showDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(join).toHaveBeenCalledWith('Bishnu Prasad');
  });
});

/**
 * Somebody who followed the link, or scanned the square at the door.
 *
 * The code is in the address they arrived at, so nothing is left to type.
 * What is left is a decision: a guest presses the button, and anybody with
 * an account signs in instead and needs no code at all.
 */
describe('arriving with the code already', () => {
  const showWithLink = (mobile = true) => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0',
    });
    return render(
      <MemoryRouter initialEntries={['/login?join=abc123']}>
        <LoginPage />
      </MemoryRouter>
    );
  };

  it('opens the guest door and fills the code in', async () => {
    showWithLink();

    expect(await screen.findByLabelText('Event code')).toHaveValue('ABC123');
    expect(screen.getByRole('button', { name: 'Enter event room' }))
      .toBeInTheDocument();
  });

  it('explains guest mode is mobile-only when a desktop opens an event link', async () => {
    showWithLink(false);

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Guest mode is only supported on mobile devices for now.');
    expect(screen.queryByLabelText('Event code')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enter event room' })).toBeNull();
  });

  it('says where the code came from, rather than asking for it', async () => {
    showWithLink();

    expect(await screen.findByText(/code came with your link/)).toBeInTheDocument();
  });

  it('opens the guest join form without requiring another button press', async () => {
    showWithLink();

    await screen.findByLabelText('Event code');
    expect(await screen.findByRole('dialog', { name: 'Enter event info' }))
      .toBeInTheDocument();
    expect(api.guestKnock).not.toHaveBeenCalled();
  });

  it('prefills a remembered name for a QR arrival', async () => {
    window.localStorage.setItem('manch.guest.name', 'Bishnu Prasad');
    showWithLink();

    expect(await screen.findByLabelText(/Your Name/)).toHaveValue('Bishnu Prasad');
  });

  it('leaves signing in right there for anybody who has an account', async () => {
    showWithLink();

    // No code is needed for that, so the way back is one press and the
    // Google button never left the page.
    expect(await screen.findByRole('button', { name: /Sign in with Google/ }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Go back and sign in/ }));

    expect(screen.queryByLabelText('Event code')).toBeNull();
    expect(screen.getByRole('button', { name: /Sign in with Google/ }))
      .toBeInTheDocument();
  });
});

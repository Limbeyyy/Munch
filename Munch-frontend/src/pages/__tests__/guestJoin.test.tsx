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
 * A name, a number and an address. The last two were dropped once, on
 * the reasoning that the host decides on the name and the register
 * keeps the name; they are asked for again because an organizer running
 * a real event has to be able to reach the people who were in the hall
 * once it is over.
 *
 * None of the three admits anybody. The host still decides.
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

  it('asks how to reach them afterwards, as well as who they are', async () => {
    await reachTheDialog();

    expect(screen.getByLabelText(/Phone Number/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
  });

  it('will not send a request without a name', async () => {
    await reachTheDialog();

    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();
  });

  /* Asked for means asked for: a box nobody has to fill is a box that
     comes back empty, and an organizer with no number is where this
     started. */
  it('waits for all three before it will knock', async () => {
    await reachTheDialog();
    const press = () => screen.getByRole('button', { name: 'Join' });

    fireEvent.change(screen.getByLabelText(/Your Name/), {
      target: { value: 'Bishnu Prasad' },
    });
    expect(press()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Phone Number/), {
      target: { value: '9801234567' },
    });
    expect(press()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'bishnu@example.com' },
    });
    expect(press()).toBeEnabled();
  });

  it('does not take an address that is not one', async () => {
    await reachTheDialog();

    fireEvent.change(screen.getByLabelText(/Your Name/), {
      target: { value: 'Bishnu Prasad' },
    });
    fireEvent.change(screen.getByLabelText(/Phone Number/), {
      target: { value: '9801234567' },
    });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'bishnu-at-example' },
    });

    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();
  });

  it('sends the code, the details, and the token if there is one', async () => {
    window.sessionStorage.setItem('guest_token', 'held-token');
    api.guestKnock.mockResolvedValue({
      guest_token: 't', guest: { status: 'pending', full_name: 'Bishnu' },
      event: { code: 'ABC123', title: 'Opening day' },
    } as any);

    await reachTheDialog();
    fireEvent.change(screen.getByLabelText(/Your Name/), {
      target: { value: 'Bishnu Prasad' },
    });
    fireEvent.change(screen.getByLabelText(/Phone Number/), {
      target: { value: '9801234567' },
    });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'bishnu@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(api.guestKnock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ABC123',
        full_name: 'Bishnu Prasad',
        phone: '9801234567',
        email: 'bishnu@example.com',
        token: 'held-token',
      })
    ));
    expect(api.guestKnock.mock.calls[0][0].device_id).toMatch(/^[a-f0-9]{48}$/);
  });

  it('says what becomes of the details, because that is the question', async () => {
    const dialog = await reachTheDialog();

    expect(dialog).toHaveTextContent(/kept for this event only/);
  });
});

describe('remembering the details', () => {
  const join = jest.fn();

  const showDialog = () =>
    render(
      <GuestJoinDialog
        eventCode="ABC123"
        onCancel={jest.fn()}
        onJoin={join}
      />
    );

  const fillAll = () => {
    fireEvent.change(screen.getByLabelText(/Your Name/), {
      target: { value: 'Bishnu Prasad' },
    });
    fireEvent.change(screen.getByLabelText(/Phone Number/), {
      target: { value: '9801234567' },
    });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'bishnu@example.com' },
    });
  };

  const remembered = () => ({
    name: window.localStorage.getItem('manch.guest.name'),
    phone: window.localStorage.getItem('manch.guest.phone'),
    email: window.localStorage.getItem('manch.guest.email'),
  });

  beforeEach(() => join.mockClear());

  it('keeps them in this browser when asked to', () => {
    showDialog();

    fillAll();
    fireEvent.click(screen.getByLabelText(/Remember my details/));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(remembered()).toEqual({
      name: 'Bishnu Prasad',
      phone: '9801234567',
      email: 'bishnu@example.com',
    });
  });

  it('fills them in next time, so the door is one press', () => {
    window.localStorage.setItem('manch.guest.name', 'Bishnu Prasad');
    window.localStorage.setItem('manch.guest.phone', '9801234567');
    window.localStorage.setItem('manch.guest.email', 'bishnu@example.com');

    showDialog();

    expect(screen.getByLabelText(/Your Name/)).toHaveValue('Bishnu Prasad');
    expect(screen.getByLabelText(/Phone Number/)).toHaveValue('9801234567');
    expect(screen.getByLabelText(/Email/)).toHaveValue('bishnu@example.com');
    expect(screen.getByLabelText(/Remember my details/)).toBeChecked();
    // One press, and that press works.
    expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled();
  });

  /* All three, not just the name: half-forgotten details are worse than
     none, because the next door silently sends a stale number. */
  it('forgets all of them when the box is cleared', () => {
    window.localStorage.setItem('manch.guest.name', 'Bishnu Prasad');
    window.localStorage.setItem('manch.guest.phone', '9801234567');
    window.localStorage.setItem('manch.guest.email', 'bishnu@example.com');
    showDialog();

    fireEvent.click(screen.getByLabelText(/Remember my details/));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(remembered()).toEqual({ name: null, phone: null, email: null });
  });

  it('hands all three on, trimmed', () => {
    showDialog();

    fireEvent.change(screen.getByLabelText(/Your Name/), {
      target: { value: '  Bishnu Prasad  ' },
    });
    fireEvent.change(screen.getByLabelText(/Phone Number/), {
      target: { value: ' 9801234567 ' },
    });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: ' bishnu@example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(join).toHaveBeenCalledWith({
      name: 'Bishnu Prasad',
      phone: '9801234567',
      email: 'bishnu@example.com',
    });
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

  /*
   * A laptop following an event link is not a guest.
   *
   * Guest entry is for a phone. This used to open the dialog here,
   * which collected a name and then had nowhere to go; the laptop is
   * told why instead, and the sign-in that does work on it is the way
   * forward.
   */
  it('turns a desktop visitor away from the guest door', async () => {
    showWithLink(false);

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Enter event info' }))
        .toBeNull());
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

  it('prefills remembered details for a QR arrival', async () => {
    window.localStorage.setItem('manch.guest.name', 'Bishnu Prasad');
    window.localStorage.setItem('manch.guest.phone', '9801234567');
    window.localStorage.setItem('manch.guest.email', 'bishnu@example.com');
    showWithLink();

    expect(await screen.findByLabelText(/Your Name/)).toHaveValue('Bishnu Prasad');
    expect(screen.getByLabelText(/Phone Number/)).toHaveValue('9801234567');
    expect(screen.getByLabelText(/Email/)).toHaveValue('bishnu@example.com');
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

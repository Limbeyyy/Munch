import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../../../organizer/i18n';
import { ProfileInformation } from '../profile/ProfileInformation';
import { apiClient } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';

/**
 * The one thing Google does not hand over.
 *
 * Signing in with Google supplies a name, a picture and an address, and
 * never a telephone number - so this screen is the only place one can
 * come from, and an organizer who needs to reach somebody about the day
 * has nowhere else to look.
 *
 * The address stays read-only beside it: that is what the account *is*,
 * and the server refuses to change it too.
 */
jest.mock('../../../services/api', () => ({
  apiClient: {
    updateProfile: jest.fn(),
    uploadAvatar: jest.fn(),
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

const asUser = (over: any = {}) => {
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'sita@example.com',
      first_name: 'Sita',
      last_name: 'Rai',
      is_verified: true,
      created_at: '',
      ...over,
    } as any,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  asUser();
  api.updateProfile.mockImplementation(
    async (patch: any) => ({
      id: 'u1', email: 'sita@example.com', first_name: 'Sita',
      last_name: 'Rai', is_verified: true, created_at: '', ...patch,
    }) as any
  );
});

const show = () =>
  render(
    <OrganizerProvider>
      <ProfileInformation onBack={jest.fn()} />
    </OrganizerProvider>
  );

const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
const keep = () => fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

describe('the phone number on a profile', () => {
  it('is shown, empty, for a Google account that has never set one', () => {
    show();

    const row = screen.getByText('Phone Number').closest('div') as HTMLElement;
    expect(row).toHaveTextContent('—');
  });

  it('shows the one the account carries', () => {
    asUser({ phone: '9801234567' });
    show();

    expect(screen.getByText('9801234567')).toBeInTheDocument();
  });

  it('is theirs to set', async () => {
    show();
    edit();

    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '9801234567' },
    });
    keep();

    await waitFor(() => expect(api.updateProfile)
      .toHaveBeenCalledWith({ phone: '9801234567' }));
  });

  /* One write, not one per field: two requests would leave the account
     half-saved if the second failed. */
  it('goes up with the name in a single write', async () => {
    show();
    edit();

    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Sita Rai Magar' },
    });
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '9801234567' },
    });
    keep();

    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1));
    expect(api.updateProfile).toHaveBeenCalledWith({
      first_name: 'Sita',
      last_name: 'Rai Magar',
      phone: '9801234567',
    });
  });

  it('does not offer to save when nothing has been typed', () => {
    show();
    edit();

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('offers to save once the number alone has changed', () => {
    show();
    edit();

    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '9801234567' },
    });

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  /** What the account is, so neither this screen nor the server will. */
  it('leaves the address alone', () => {
    show();
    edit();

    expect(screen.queryByLabelText('Email address')).toBeNull();
    expect(screen.getByText('sita@example.com')).toBeInTheDocument();
  });
});

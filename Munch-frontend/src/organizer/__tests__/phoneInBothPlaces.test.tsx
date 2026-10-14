import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { ProfileView } from '../ProfileView';
import { ProfileInformation } from '../../attendee/pwa/profile/ProfileInformation';
import { apiClient } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

/**
 * One telephone number, wherever it is read.
 *
 * The host sets it on the organizer's profile and the attendee sets it
 * on theirs. Both are the same person and the same column, so neither
 * is "the host's number" - there is one, and both screens have to be
 * looking at it.
 *
 * They do not read it from the same place, which is what made that
 * worth pinning: the organizer's screen asks the server each time it
 * opens, and the attendee's reads the signed-in user held in the store.
 * A save on the organizer's side updated the server and left the store
 * alone, so the attendee's screen went on showing the old number for
 * the rest of the session.
 */
jest.mock('../../services/api', () => ({
  apiClient: {
    getProfileSummary: jest.fn(),
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

/** The one row both screens are looking at. */
let onTheAccount = { phone: '' };

const account = () => ({
  id: 'u1',
  email: 'sita@example.com',
  first_name: 'Sita',
  last_name: 'Rai',
  phone: onTheAccount.phone,
  is_verified: true,
  created_at: '',
});

beforeEach(() => {
  jest.clearAllMocks();
  onTheAccount = { phone: '' };
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );

  api.getProfileSummary.mockImplementation(async () => ({
    user: {
      ...account(), name: 'Sita Rai', position: '', organization_name: '',
      billing_address: '', signed_in_with_google: true, joined: '',
      language: 'en', timezone: 'Asia/Kathmandu', avatar_url: '',
    },
    is_host: true, is_attendee: false, can_start_hosting: false,
    portals: ['host'], plan: { id: 'free', name: 'Free', paid: false, limits: {} },
    usage: null, subscription: null, remaining: {}, plans: [],
  }) as any);

  api.updateProfile.mockImplementation(async (patch: any) => {
    if (patch.phone !== undefined) onTheAccount.phone = patch.phone;
    return account() as any;
  });
});

const hostScreen = () =>
  render(
    <OrganizerProvider>
      <ProfileView onNavigate={jest.fn()} />
    </OrganizerProvider>
  );

const userScreen = () =>
  render(
    <OrganizerProvider>
      <ProfileInformation onBack={jest.fn()} />
    </OrganizerProvider>
  );

describe('a number set on the host side', () => {
  it('is the number the user side shows', async () => {
    // Signed in after the host had already set it: the store is seeded
    // from the sign-in payload, which now carries the number.
    onTheAccount.phone = '9801234567';
    useAuthStore.setState({ user: account() as any });

    userScreen();

    expect(await screen.findByText('9801234567')).toBeInTheDocument();
  });

  it('reaches the user side when it is changed', async () => {
    useAuthStore.setState({ user: account() as any });
    hostScreen();

    const box = await screen.findByLabelText(/Phone/i);
    fireEvent.change(box, { target: { value: '9801234567' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(api.updateProfile).toHaveBeenCalled());
    // The store is what the attendee's screen reads, so that is where
    // this has to have landed.
    await waitFor(() =>
      expect(useAuthStore.getState().user?.phone).toBe('9801234567'));
  });
});

describe('a number set on the user side', () => {
  it('is the number the host side shows', async () => {
    useAuthStore.setState({ user: account() as any });
    userScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '9812223344' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(onTheAccount.phone).toBe('9812223344'));

    // The organizer's screen asks the server when it opens, so what it
    // shows is whatever the attendee's screen last wrote.
    hostScreen();
    await waitFor(() =>
      expect(screen.getByDisplayValue('9812223344')).toBeInTheDocument());
  });

  it('is kept in the store as well, so neither screen goes stale', async () => {
    useAuthStore.setState({ user: account() as any });
    userScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '9812223344' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(useAuthStore.getState().user?.phone).toBe('9812223344'));
  });
});

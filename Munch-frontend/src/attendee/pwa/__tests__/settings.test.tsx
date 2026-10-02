import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../../organizer/i18n';
import { Settings } from '../profile/Settings';
import { HomeShell } from '../HomeShell';
import { apiClient } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';

jest.mock('../../../services/api', () => ({
  apiClient: {
    getNotificationPrefs: jest.fn(),
    setNotificationPrefs: jest.fn(),
    updateProfile: jest.fn(),
    uploadAvatar: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

// jsdom has neither, and the picture preview is held on an object URL.
beforeAll(() => {
  (URL as any).createObjectURL = jest.fn(() => 'blob:picked');
  (URL as any).revokeObjectURL = jest.fn();
});

const PREFS = {
  event_reminders: true, new_sessions: false, event_updates: true,
  new_files: true, published_summaries: false, email_event_reminders: true,
  email_event_updates: false, email_weekly_digest: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-text-size');
  useAuthStore.setState({
    user: {
      id: 'u1', email: 'suminmaharjan@gmail.com', first_name: 'Sumin',
      last_name: 'Maharjan', is_verified: true, created_at: '',
    } as any,
  });
  api.getNotificationPrefs.mockResolvedValue(PREFS as any);
  api.updateProfile.mockImplementation(async (d) => ({ ...d }) as any);
  api.uploadAvatar.mockResolvedValue({} as any);
  api.setNotificationPrefs.mockImplementation(
    async (changes) => ({ ...PREFS, ...changes }) as any
  );
});

const show = () =>
  render(
    <OrganizerProvider>
      <Settings />
    </OrganizerProvider>
  );

const open = async (row: string) => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(row) }));
};

/**
 * Everything about the app that is this person's to set.
 *
 * A list rather than a page of controls: each of these is a question
 * with more than two answers, and each answer needs a line saying what
 * it means.
 */
describe('the settings list', () => {
  it('says who this is', async () => {
    show();
    expect(await screen.findByText('Sumin Maharjan')).toBeInTheDocument();
    expect(screen.getByText('suminmaharjan@gmail.com')).toBeInTheDocument();
  });

  it('says what each answer currently is, without opening it', () => {
    show();
    const row = screen.getByRole('button', { name: /Appearance/ });
    expect(within(row).getByText('Light')).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Text size/ }))
        .getByText('Default')
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Language/ }))
        .getByText('English')
    ).toBeInTheDocument();
  });

  it('signs out', () => {
    const bye = jest.fn();
    useAuthStore.setState({ logout: bye } as any);
    show();
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(bye).toHaveBeenCalled();
  });
});

describe('profile information', () => {
  it('reads out what the account carries', async () => {
    await open('Profile information');

    expect(
      await screen.findByText('Profile Information')
    ).toBeInTheDocument();
    expect(screen.getByText('Sumin Maharjan')).toBeInTheDocument();
    expect(screen.getByText('suminmaharjan@gmail.com')).toBeInTheDocument();
  });

  /**
   * Google seeds the name and the picture; this system owns them
   * after that, so both are the person's to change.
   */
  it('reads rather than edits until asked', async () => {
    await open('Profile information');
    await screen.findByText('Profile Information');

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Edit Profile' })
    ).toBeInTheDocument();
  });

  it('opens the name for editing, and offers to save', async () => {
    await open('Profile information');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Profile' }));

    expect(screen.getByLabelText('Full Name')).toHaveValue('Sumin Maharjan');
    expect(
      screen.getByRole('button', { name: 'Save Changes' })
    ).toBeInTheDocument();
  });

  /** Nothing to keep yet, so there is nothing to press. */
  it('will not save until something has changed', async () => {
    await open('Profile information');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Profile' }));

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Sumin K Shrestha' },
    });
    expect(
      screen.getByRole('button', { name: 'Save Changes' })
    ).not.toBeDisabled();
  });

  it('writes the name back as the two the account keeps', async () => {
    await open('Profile information');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Profile' }));
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Sumin K Shrestha' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({
      first_name: 'Sumin', last_name: 'K Shrestha',
    }));
  });

  it('puts up a photograph', async () => {
    await open('Profile information');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Profile' }));

    const file = new File(['x'], 'me.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose a photo'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(api.uploadAvatar).toHaveBeenCalledWith(file));
  });

  /** The address is what the account is. */
  it('never offers the email for editing', async () => {
    await open('Profile information');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Profile' }));

    expect(screen.getByText('suminmaharjan@gmail.com')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Email/)).toBeNull();
    // The name is the only thing open.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('comes back', async () => {
    await open('Profile information');
    fireEvent.click(await screen.findByRole('button', { name: /Back/ }));

    expect(
      await screen.findByText('Profile and Settings')
    ).toBeInTheDocument();
  });
});

describe('the notification switches', () => {
  it('hides the app navbar on a settings subpage and restores it on Back', async () => {
    const InShell: React.FC = () => {
      const [subpageOpen, setSubpageOpen] = React.useState(false);
      return (
        <HomeShell at="profile" onGo={() => {}} showNav={!subpageOpen}>
          <Settings onSubpageChange={setSubpageOpen} />
        </HomeShell>
      );
    };
    render(<OrganizerProvider><InShell /></OrganizerProvider>);
    expect(screen.getByRole('navigation', { name: 'Sections' }))
      .toBeInTheDocument();

    const preferences = screen.getByRole('heading', { name: 'App Preferences' })
      .closest('section')!;
    fireEvent.click(within(preferences).getByRole('button', { name: 'Notifications' }));
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: /Back/ }));
    expect(await screen.findByRole('navigation', { name: 'Sections' }))
      .toBeInTheDocument();
  });

  it('shows each one as the account has it', async () => {
    await open('^Notifications');

    const off = await screen.findByRole('switch', { name: 'New sessions' });
    expect(off).toHaveAttribute('aria-checked', 'false');

    // Both sections carry a row of this name, as the design has them.
    const push = screen.getByText('Push notifications').closest('section')!;
    expect(
      within(push).getByRole('switch', { name: 'Event reminders' })
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('sends only the one that was pressed', async () => {
    await open('^Notifications');
    fireEvent.click(await screen.findByRole('switch', { name: 'New sessions' }));

    await waitFor(() => expect(api.setNotificationPrefs)
      .toHaveBeenCalledWith({ new_sessions: true }));
  });

  /** A switch that lies about the answer is worse than no switch. */
  it('puts a switch back where it did not save', async () => {
    api.setNotificationPrefs.mockRejectedValue(new Error('no'));
    await open('^Notifications');

    const one = await screen.findByRole('switch', { name: 'New sessions' });
    fireEvent.click(one);

    await waitFor(() => expect(
      screen.getByRole('switch', { name: 'New sessions' })
    ).toHaveAttribute('aria-checked', 'false'));
  });

  it('keeps the email ones apart from the push ones', async () => {
    await open('^Notifications');
    await screen.findByRole('switch', { name: 'New sessions' });

    const push = screen.getByText('Push notifications').closest('section')!;
    const mail = screen.getByText('Email notifications').closest('section')!;
    expect(within(push).getByText('When the agenda is updated')).toBeInTheDocument();
    expect(within(mail).getByText('Weekly digest')).toBeInTheDocument();
    expect(within(push).queryByText('Weekly digest')).toBeNull();
  });
});

describe('appearance', () => {
  it('lets the device decide, and says so on the list', async () => {
    await open('Appearance');
    fireEvent.click(await screen.findByRole('radio', { name: /System default/ }));
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));

    const row = await screen.findByRole('button', { name: /Appearance/ });
    expect(within(row).getByText('System')).toBeInTheDocument();
  });

  it('turns the whole document dark', async () => {
    await open('Appearance');
    fireEvent.click(await screen.findByRole('radio', { name: /Dark/ }));

    await waitFor(() => expect(
      document.documentElement.getAttribute('data-theme')
    ).toBe('dark'));
  });
});

describe('text size', () => {
  it('shows a preview of what is being chosen', async () => {
    await open('Text size');
    expect(await screen.findByText('Session heading')).toBeInTheDocument();
  });

  it('applies the chosen step to the document', async () => {
    await open('Text size');
    fireEvent.click(await screen.findByRole('radio', { name: /Extra large/ }));

    await waitFor(() => expect(
      document.documentElement.getAttribute('data-text-size')
    ).toBe('xlarge'));
  });
});

describe('language', () => {
  it('switches the app over, and the screen with it', async () => {
    await open('Language');
    fireEvent.click(await screen.findByRole('radio', { name: /Nepali/ }));

    expect(await screen.findByText('भाषा')).toBeInTheDocument();
  });

  it('says the organizer sets the transcription language, not this', async () => {
    await open('Language');
    expect(
      await screen.findByText(/set per event by the organizer/)
    ).toBeInTheDocument();
  });
});

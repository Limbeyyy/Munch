import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { SettingsView } from '../views/SettingsView';
import { HubView } from '../../attendee/views/HubView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getSchedulingPrefs: jest.fn(),
    setSchedulingPrefs: jest.fn(),
    setSessionGap: jest.fn(),
    getPhotos: jest.fn(),
    getMeetingBoard: jest.fn(),
    getGuestBoard: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const prefs = (over: any = {}) => ({
  session_gap_minutes: 15,
  meeting_reminder_minutes: 60,
  session_reminder_minutes: 15,
  reminders_enabled: true,
  defaults: {
    session_gap_minutes: 15, meeting_reminder_minutes: 60, session_reminder_minutes: 15,
  },
  maximums: {
    session_gap_minutes: 240, meeting_reminder_minutes: 1440, session_reminder_minutes: 1440,
  },
  default_session_gap_minutes: 15,
  max_session_gap_minutes: 240,
  ...over,
});

const show = (node: React.ReactElement) =>
  render(<OrganizerProvider>{node}</OrganizerProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getSchedulingPrefs.mockResolvedValue(prefs() as any);
});

describe('what settings is for', () => {
  it('keeps the things that are set once and left', async () => {
    show(<SettingsView />);

    expect(await screen.findByRole('tab', { name: 'Scheduling' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hall device' })).toBeInTheDocument();
  });

  it('no longer keeps a second copy of things that live elsewhere', async () => {
    // Chat rules belong to a session that is running; accessibility has its
    // own button; the plan has its own page.
    show(<SettingsView />);

    await screen.findByRole('tab', { name: 'Scheduling' });
    expect(screen.queryByRole('tab', { name: 'Chat rules' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Accessibility' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument();
  });
});

describe('how much warning a programme gives', () => {
  const openNotifications = async () => {
    show(<SettingsView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Notifications' }));
  };

  it('shows the two lead times it works to', async () => {
    await openNotifications();

    expect(await screen.findByLabelText('Before a meeting')).toHaveValue(60);
    expect(screen.getByLabelText('Before a session')).toHaveValue(15);
  });

  it('saves both together', async () => {
    api.setSchedulingPrefs.mockResolvedValue(
      prefs({ meeting_reminder_minutes: 120, session_reminder_minutes: 30 }) as any
    );
    await openNotifications();

    fireEvent.change(await screen.findByLabelText('Before a meeting'), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByLabelText('Before a session'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.setSchedulingPrefs).toHaveBeenCalledWith({
        meeting_reminder_minutes: 120,
        session_reminder_minutes: 30,
      })
    );
  });

  it('will not save something that is not a number of minutes', async () => {
    await openNotifications();

    fireEvent.change(await screen.findByLabelText('Before a meeting'), {
      target: { value: '9999' },
    });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/from 0 to 1440 minutes/)).toBeInTheDocument();
  });

  it('turns the whole thing off with one switch', async () => {
    api.setSchedulingPrefs.mockResolvedValue(prefs({ reminders_enabled: false }) as any);
    await openNotifications();

    fireEvent.click(await screen.findByRole('button', { name: /Send reminders/ }));

    await waitFor(() =>
      expect(api.setSchedulingPrefs).toHaveBeenCalledWith({ reminders_enabled: false })
    );
  });

  it('greys the fields out while they are switched off', async () => {
    api.getSchedulingPrefs.mockResolvedValue(prefs({ reminders_enabled: false }) as any);
    await openNotifications();

    expect(await screen.findByLabelText('Before a meeting')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

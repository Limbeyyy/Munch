import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { ProfileView } from '../ProfileView';
import { SubscriptionView } from '../SubscriptionView';
import { RemindersView } from '../RemindersView';
import { useNudges } from '../nudges';
import { ATTENDEE_NAV } from '../../attendee/AttendeeShell';
import { NAV } from '../OrganizerShell';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getProfileSummary: jest.fn(),
    getUpgradeRequests: jest.fn(),
    requestUpgrade: jest.fn(),
    getReminders: jest.fn(),
    markRemindersRead: jest.fn(),
    // OrganizerShell reaches the auth store, which asks this on import.
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const FREE = {
  id: 'free',
  name: 'Free trial',
  paid: false,
  limits: { events: 2, meetings: 2, sessions_per_meeting: 2, attendees: 100 },
};
const BIG = {
  id: 'enterprise',
  name: 'Enterprise',
  paid: true,
  limits: { events: null, meetings: null, sessions_per_meeting: null, attendees: null },
};

const profile = (over: any = {}) => ({
  user: {
    id: 'u1',
    email: 'sabina@example.org',
    name: 'Sabina Rai',
    avatar_url: null,
    is_verified: true,
    joined: '2026-01-05T04:00:00Z',
    signed_in_with_google: true,
    language: 'ne',
    timezone: 'Asia/Kathmandu',
  },
  is_host: true,
  is_attendee: false,
  can_start_hosting: false,
  portals: ['host'],
  plan: FREE,
  usage: { events: 1, meetings: 3, sessions: 6 },
  subscription: { status: 'trialing', current_period_end: null },
  remaining: { events: 1, meetings: null, sessions_per_meeting: 2, attendees: 100 },
  plans: [FREE, BIG],
  ...over,
});

const reminder = (over: any = {}) => ({
  id: 'r1',
  kind: 'session' as const,
  meeting_id: 'm1',
  meeting_code: 'ABC123',
  meeting_title: 'Opening day',
  session_id: 's1',
  session_title: 'Mehendi',
  speaker_name: 'Surya Adhikari',
  hall: 'Hall A',
  starts_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
  ends_at: new Date(Date.now() + 4 * 3600_000).toISOString(),
  due_at: new Date(Date.now() + 2.75 * 3600_000).toISOString(),
  is_due: false,
  read: false,
  lead_minutes: 15,
  calendar_url: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Mehendi',
  ...over,
});

const show = (node: React.ReactElement) =>
  render(<OrganizerProvider>{node}</OrganizerProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  // The pages are read in English here; the Nepali wording is the default.
  window.localStorage.setItem(
    'manch.organizer.prefs',
    JSON.stringify({ lang: 'en', a11y: {} })
  );
});

describe('the profile page', () => {
  it('says what is left of the allowance, not just what the plan includes', async () => {
    api.getProfileSummary.mockResolvedValue(profile() as any);

    show(<ProfileView />);

    expect(await screen.findByText('Sabina Rai')).toBeInTheDocument();
    expect(screen.getByText('sabina@example.org')).toBeInTheDocument();
    expect(screen.getByText(/Free trial/)).toBeInTheDocument();
    // One of two events used, so one is left.
    expect(screen.getByText('1 left of 2')).toBeInTheDocument();
  });

  it('calls an uncapped allowance unlimited rather than showing a full bar', async () => {
    api.getProfileSummary.mockResolvedValue(
      profile({ plan: BIG, remaining: { events: null, meetings: null, sessions_per_meeting: null, attendees: null } }) as any
    );

    show(<ProfileView />);

    await screen.findByText('Enterprise');
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThan(0);
  });

  it('offers the trial to somebody who has never hosted', async () => {
    api.getProfileSummary.mockResolvedValue(
      profile({ is_host: false, is_attendee: true, can_start_hosting: true, plan: null, usage: null }) as any
    );

    show(<ProfileView />);

    expect(await screen.findByText(/not hosting yet/i)).toBeInTheDocument();
  });
});

describe('the subscription page', () => {
  it('says plainly that no payment is taken here', async () => {
    api.getProfileSummary.mockResolvedValue(profile() as any);
    api.getUpgradeRequests.mockResolvedValue({ requests: [] } as any);

    show(<SubscriptionView />);

    expect(await screen.findByText(/No payment is taken here/i)).toBeInTheDocument();
  });

  it('marks the plan in use and does not offer it again', async () => {
    api.getProfileSummary.mockResolvedValue(profile() as any);
    api.getUpgradeRequests.mockResolvedValue({ requests: [] } as any);

    show(<SubscriptionView />);

    await screen.findByText('Enterprise');
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In use' })).toBeDisabled();
  });

  it('treats the free plan as current for somebody who has not hosted', async () => {
    // The server refuses an ask for the plan you are already on, so a
    // button offering it would only ever produce an error.
    api.getProfileSummary.mockResolvedValue(
      profile({ is_host: false, plan: null, usage: null }) as any
    );
    api.getUpgradeRequests.mockResolvedValue({ requests: [] } as any);

    show(<SubscriptionView />);

    // 'Free trial' names the card and captions it, hence the two matches.
    expect((await screen.findAllByText('Free trial')).length).toBeGreaterThan(0);
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('records the ask and then stops offering that plan', async () => {
    api.getProfileSummary.mockResolvedValue(profile() as any);
    // Held as state rather than a call queue: the page may read the list
    // more than once while the language preference settles.
    let requests: any[] = [];
    api.getUpgradeRequests.mockImplementation(async () => ({ requests }) as any);
    api.requestUpgrade.mockImplementation(async () => {
      requests = [{
        id: 'q1', plan: 'enterprise', plan_name: 'Enterprise',
        from_plan: 'free', status: 'asked', note: '',
        created_at: new Date().toISOString(),
      }];
      return {} as any;
    });

    show(<SubscriptionView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ask for this plan' }));

    await waitFor(() => expect(api.requestUpgrade).toHaveBeenCalledWith('enterprise'));
    expect(await screen.findByRole('button', { name: 'Requested' })).toBeDisabled();
  });
});

/** The page as the portals render it: the shared hook holds the data. */
const Reminders: React.FC = () => {
  const { page, loading, markRead } = useNudges();
  return <RemindersView page={page} loading={loading} onRead={markRead} />;
};

describe('the reminders page', () => {
  it('states the two lead times it works to', async () => {
    api.getReminders.mockResolvedValue({
      reminders: [], unread: 0, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);

    show(<Reminders />);

    expect(
      await screen.findByText(/60 minutes ahead, and each session 15 minutes ahead/)
    ).toBeInTheDocument();
  });

  it('gives every nudge a diary link that needs no sign-in', async () => {
    api.getReminders.mockResolvedValue({
      reminders: [reminder()], unread: 1, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);

    show(<Reminders />);

    const link = await screen.findByRole('link', { name: /Add to Google Calendar/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('action=TEMPLATE'));
  });

  it('shows the meeting and its sessions apart, with their own lead times', async () => {
    api.getReminders.mockResolvedValue({
      reminders: [
        reminder({ id: 'meet', kind: 'meeting', session_id: null, session_title: null, lead_minutes: 60 }),
        reminder({ id: 's1', session_title: 'Mehendi' }),
        reminder({ id: 's2', session_title: 'Sagun' }),
      ],
      unread: 3, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);

    show(<Reminders />);

    await screen.findByText('Mehendi');
    expect(screen.getByText('Sagun')).toBeInTheDocument();
    expect(screen.getByText('Opening day')).toBeInTheDocument();
    expect(screen.getAllByText('Session')).toHaveLength(2);
    expect(screen.getAllByText('Meeting')).toHaveLength(1);
    expect(screen.getByText(/Reminds 60 min before/)).toBeInTheDocument();
    expect(screen.getAllByText(/Reminds 15 min before/)).toHaveLength(2);
  });

  it('hides what has already finished until All is asked for', async () => {
    api.getReminders.mockResolvedValue({
      reminders: [
        reminder({ id: 'old', session_title: 'Yesterday',
          starts_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
          ends_at: new Date(Date.now() - 25 * 3600_000).toISOString(),
          due_at: new Date(Date.now() - 27 * 3600_000).toISOString(), read: true }),
        reminder({ id: 'new', session_title: 'Mehendi' }),
      ],
      unread: 1, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);

    show(<Reminders />);

    await screen.findByText('Mehendi');
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('ticks a nudge off without waiting for the round trip', async () => {
    api.getReminders.mockResolvedValue({
      reminders: [reminder()], unread: 1, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);
    let settle: () => void = () => {};
    api.markRemindersRead.mockReturnValue(
      new Promise((resolve) => { settle = () => resolve({ marked: 1 } as any); }) as any
    );

    show(<Reminders />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mark read' }));

    expect(screen.queryByRole('button', { name: 'Mark read' })).not.toBeInTheDocument();
    expect(api.markRemindersRead).toHaveBeenCalledWith('r1');
    settle();
  });
});

describe('a nudge that has come due announces itself', () => {
  const due = (over: any = {}) =>
    reminder({
      is_due: true, read: false,
      starts_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      ends_at: new Date(Date.now() + 40 * 60_000).toISOString(),
      due_at: new Date(Date.now() - 60_000).toISOString(),
      ...over,
    });

  const withNotification = (permission: NotificationPermission) => {
    const made: any[] = [];
    class FakeNotification {
      static permission = permission;
      static requestPermission = jest.fn(async () => 'granted' as NotificationPermission);
      constructor(public title: string, public options?: NotificationOptions) {
        made.push({ title, options });
      }
    }
    (window as any).Notification = FakeNotification;
    return made;
  };

  afterEach(() => { delete (window as any).Notification; });

  it('tells the browser once a session is a quarter of an hour off', async () => {
    const made = withNotification('granted');
    api.getReminders.mockResolvedValue({
      reminders: [due()], unread: 1, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);

    show(<Reminders />);

    await waitFor(() => expect(made).toHaveLength(1));
    expect(made[0].title).toBe('Mehendi');
    expect(made[0].options.body).toContain('Hall A');
  });

  it('does not say the same thing twice', async () => {
    const made = withNotification('granted');
    api.getReminders.mockResolvedValue({
      reminders: [due()], unread: 1, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);

    const first = show(<Reminders />);
    await waitFor(() => expect(made).toHaveLength(1));
    first.unmount();

    // A fresh visit reads the list again; what has been said already is
    // remembered across the mount, so nothing is repeated.
    const readsSoFar = api.getReminders.mock.calls.length;
    show(<Reminders />);
    await screen.findByText('Mehendi');
    await waitFor(() =>
      expect(api.getReminders.mock.calls.length).toBeGreaterThan(readsSoFar)
    );
    expect(made).toHaveLength(1);
  });

  it('says nothing at all until it has been allowed', async () => {
    const made = withNotification('default');
    api.getReminders.mockResolvedValue({
      reminders: [due()], unread: 1, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);

    show(<Reminders />);

    await screen.findByText('Mehendi');
    expect(made).toHaveLength(0);
    // ...and offers to ask, since a browser will only be asked from a click.
    expect(screen.getByRole('button', { name: 'Turn on alerts' })).toBeInTheDocument();
  });

  it('says so plainly when the browser has refused', async () => {
    withNotification('denied');
    api.getReminders.mockResolvedValue({
      reminders: [due()], unread: 1, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);

    show(<Reminders />);

    expect(await screen.findByText(/browser is blocking alerts/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on alerts' })).not.toBeInTheDocument();
  });

  it('leaves a nudge that is not due yet alone', async () => {
    const made = withNotification('granted');
    api.getReminders.mockResolvedValue({
      reminders: [reminder()], unread: 0, meeting_lead_minutes: 60, session_lead_minutes: 15,
    } as any);

    show(<Reminders />);

    await screen.findByText('Mehendi');
    expect(made).toHaveLength(0);
  });
});

describe('both portals can reach the new pages', () => {
  it('carries them in the organizer rail', () => {
    const ids = NAV.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['profile', 'subscription', 'reminders']));
  });

  it('carries them in the attendee rail', () => {
    const ids = ATTENDEE_NAV.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['profile', 'subscription', 'reminders']));
  });

  it('leaves nothing unreachable on a phone', () => {
    // The rail is hidden at phone width, so anything kept out of the
    // bottom strip could not be opened at all. The strip scrolls instead.
    const ids = ATTENDEE_NAV.map((n) => n.id);
    expect(ids).toContain('reminders');
    expect(ids).toContain('subscription');
    expect(ids).toContain('profile');
  });
});

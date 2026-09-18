import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { EventWizard } from '../EventWizard';
import { EventDetail } from '../EventDetail';
import { apiClient } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';

jest.mock('../../../services/api', () => ({
  apiClient: {
    getProgrammeRoles: jest.fn(),
    getEventInvites: jest.fn(),
    withdrawEventInvite: jest.fn(),
    revokeRole: jest.fn(),
    getEvent: jest.fn(),
    getResources: jest.fn(),
    getEventSegments: jest.fn(),
    getConclusions: jest.fn(),
    createSession: jest.fn(),
    updateSession: jest.fn(),
    deleteSession: jest.fn(),
    rescheduleSessions: jest.fn(),
    getSchedulingPrefs: jest.fn(),
    // The auth store reads this the moment it is imported.
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

const event = {
  id: 'e1',
  title: 'Emergency Service Meeting',
  description: '',
  venue: 'Kathmandu Convention Center',
  event_date: '2026-09-15',
  status: 'scheduled',
  code: 'MXC-DOX',
  host_email: 'sarah@example.com',
  scheduled_start: '2026-09-15T10:00:00',
  scheduled_end: '2026-09-15T12:00:00',
  participant_count: 0,
  sessions: [],
  session_count: 0,
  created_at: '', updated_at: '',
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  useAuthStore.setState({
    user: { first_name: 'Sarah', last_name: 'Sharma', email: 'sarah@example.com' } as any,
  });
  api.getProgrammeRoles.mockResolvedValue({
    granted: [{ id: 'g1', email: 'man@gmail.com', role: 'co_host' }],
    speakers: [],
  } as any);
  api.getEventInvites.mockResolvedValue({
    added: 0,
    invited: [
      { email: 'john@example.com', joined: false, invited_at: '' },
      { email: 'jane@example.com', joined: true, invited_at: '' },
    ],
    total_invited: 2,
    total_joined: 1,
  } as any);
  api.withdrawEventInvite.mockResolvedValue({
    added: 0, invited: [], total_invited: 0, total_joined: 0,
  } as any);
  api.getSchedulingPrefs.mockResolvedValue({ session_gap_minutes: 15 } as any);
});

/** Open the wizard and walk it to the last step. */
const atPeoples = async () => {
  render(
    <OrganizerProvider>
      <EventWizard event={event} onClose={jest.fn()} onSaved={jest.fn()} />
    </OrganizerProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  // Wait for the lists themselves, not merely for the calls that fetch
  // them - the state lands a tick after the request goes out.
  await screen.findByText('man@gmail.com');
  await screen.findByText('john@example.com');
};

/** The row a person's address appears on. */
const rowOf = (email: string) =>
  screen.getByText(email).closest('div.flex.gap-3') as HTMLElement;

/**
 * Everybody on one list, read top to bottom.
 *
 * The two side-by-side cards this replaced asked the eye to start twice,
 * and left the host - the one person who is always there - off it
 * entirely.
 */
describe('the people on an event', () => {
  it('names the host, and marks them as you', async () => {
    await atPeoples();

    const row = rowOf('sarah@example.com');
    expect(within(row).getByText(/Sarah Sharma/)).toBeInTheDocument();
    expect(within(row).getByText(/\(you\)/)).toBeInTheDocument();
    expect(within(row).getByText('Host')).toBeInTheDocument();
  });

  it('says how many co-hosts there are, beside the heading', async () => {
    await atPeoples();

    expect(screen.getByText('Co-hosts · 1')).toBeInTheDocument();
  });

  it('gives a co-host their tag and a way off', async () => {
    await atPeoples();

    const row = rowOf('man@gmail.com');
    expect(within(row).getByText('Co-host')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('lists the attendees, and marks the ones who came', async () => {
    await atPeoples();

    expect(within(rowOf('jane@example.com')).getByText('Joined')).toBeInTheDocument();
    expect(within(rowOf('john@example.com')).queryByText('Joined')).toBeNull();
  });

  it('takes an attendee off the list when asked', async () => {
    await atPeoples();

    fireEvent.click(
      within(rowOf('john@example.com')).getByRole('button', { name: 'Remove' })
    );

    await waitFor(() =>
      expect(api.withdrawEventInvite).toHaveBeenCalledWith('e1', 'john@example.com')
    );
  });

  it('takes a co-host off by the grant, not by the address', async () => {
    await atPeoples();

    fireEvent.click(
      within(rowOf('man@gmail.com')).getByRole('button', { name: 'Remove' })
    );

    await waitFor(() => expect(api.revokeRole).toHaveBeenCalledWith('e1', 'g1'));
  });

  it('is one list rather than two columns', async () => {
    await atPeoples();

    // The host, the co-host and the two attendees all sit under the same
    // parent: that is what makes it one column to read down.
    const host = rowOf('sarah@example.com').parentElement;
    expect(rowOf('man@gmail.com').parentElement).toBe(host);
    expect(rowOf('john@example.com').parentElement).toBe(host);
  });
});

/**
 * The same list, on the event opened afterwards.
 *
 * The People tab used to be two cards side by side while the form that
 * built the event had one column - the same people drawn two ways.
 */
describe('the People tab of an event', () => {
  const openPeople = async () => {
    render(
      <OrganizerProvider>
        <EventDetail
          event={event}
          onBack={jest.fn()}
          onEdit={jest.fn()}
          onOpenRoom={jest.fn()}
          onChanged={jest.fn()}
        />
      </OrganizerProvider>
    );
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    await screen.findByText('man@gmail.com');
  };

  it('starts with the host, as the form does', async () => {
    await openPeople();

    const row = rowOf('sarah@example.com');
    expect(within(row).getByText(/Sarah Sharma/)).toBeInTheDocument();
    expect(within(row).getByText('Host')).toBeInTheDocument();
  });

  it('is one column, not two cards', async () => {
    await openPeople();

    const host = rowOf('sarah@example.com').parentElement;
    expect(rowOf('man@gmail.com').parentElement).toBe(host);
    expect(rowOf('john@example.com').parentElement).toBe(host);
  });

  it('takes an attendee off from here too', async () => {
    await openPeople();

    fireEvent.click(
      within(rowOf('john@example.com')).getByRole('button', { name: 'Remove' })
    );

    await waitFor(() =>
      expect(api.withdrawEventInvite).toHaveBeenCalledWith('e1', 'john@example.com')
    );
  });
});

/**
 * Where "Edit" beside a talk goes.
 *
 * It used to bounce out to the first step of the setup form, which is
 * where an event's name and hours live rather than a talk's. It opens
 * the same dialog the talk was written in, on what is already there.
 */
describe('editing a session from the agenda', () => {
  const withSessions = {
    ...event,
    sessions: [{
      id: 's9',
      title: 'Session Kataho',
      description: '',
      speaker_name: 'Prabhat Karmacharya',
      speaker_contact: { email: 'p@example.com', phone: '9811111111' },
      starts_at: '2026-09-15T09:30:00',
      duration_minutes: 30,
      hall: '',
      status: 'scheduled',
    }],
    session_count: 1,
  };

  const openDetail = (onEdit = jest.fn()) => {
    render(
      <OrganizerProvider>
        <EventDetail
          event={withSessions as any}
          onBack={jest.fn()}
          onEdit={onEdit}
          onOpenRoom={jest.fn()}
          onChanged={jest.fn()}
        />
      </OrganizerProvider>
    );
    return onEdit;
  };

  /**
   * The overview is a summary, so Edit there takes you to where the
   * running order is arranged rather than opening a form over the top of
   * a summary. The form itself opens from the agenda.
   */
  it('goes to the agenda from the overview, rather than opening a form', () => {
    const onEdit = openDetail();

    // Not the first Edit on the page - that one belongs to the event's
    // own details. This is the one on the talk's row.
    const row = screen.getByText('Session Kataho').closest('div') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('tab', { name: 'Agenda' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Edit agenda')).toBeNull();
    // The setup form is where an event's own details live; Edit on a talk
    // has no business going there either.
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('opens the form once you are on the agenda', async () => {
    openDetail();

    fireEvent.click(screen.getByRole('tab', { name: 'Agenda' }));
    const row = await screen.findByText('Session Kataho');
    fireEvent.click(
      within(row.closest('li') as HTMLElement).getByRole('button', { name: 'Edit' })
    );

    expect(screen.getByText('Edit agenda')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Session Kataho')).toBeInTheDocument();
  });

  it('adds a new one from the same place, unfilled', () => {
    openDetail();

    fireEvent.click(screen.getByRole('button', { name: /\+ Add session/ }));

    expect(
      screen.getByRole('heading', { name: 'Add agenda' })
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Session Kataho')).toBeNull();
  });

  /**
   * The two things done to a running order from outside it: add to it,
   * and let people in to see it. They sat at opposite ends of the screen,
   * one above the list and one below it.
   */
  it('keeps adding and inviting together, above the running order', () => {
    openDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Agenda' }));

    const add = screen.getByRole('button', { name: /Add sessions/ });
    const invite = screen.getByRole('button', { name: 'Invite' });
    expect(add.parentElement).toBe(invite.parentElement);
    // Adding first, since inviting people to an empty list is the odd
    // way round.
    expect(add.compareDocumentPosition(invite))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('calls it inviting, rather than naming the two things handed over', () => {
    openDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Agenda' }));

    expect(screen.queryByRole('button', { name: /Link & QR/ })).toBeNull();
  });
});

/**
 * Who is speaking, and what they do.
 *
 * A name on its own says who is at the front of the room; the post says
 * why they are the one to speak, and it was already being collected on
 * the form. The agenda tab showed both and the overview did not.
 */
describe('the speaker on an overview row', () => {
  const withRole = (role?: string) => ({
    ...event,
    sessions: [{
      id: 's1',
      title: 'Session Kataho',
      description: '',
      speaker_name: 'Prabhat Karmacharya',
      speaker_role: role,
      speaker_contact: { email: 'p@example.com', phone: '9811111111' },
      starts_at: '2026-09-15T10:00:00',
      duration_minutes: 30,
      status: 'scheduled',
    }],
    session_count: 1,
  });

  const openWith = (role?: string) =>
    render(
      <OrganizerProvider>
        <EventDetail
          event={withRole(role) as any}
          onBack={jest.fn()}
          onEdit={jest.fn()}
          onOpenRoom={jest.fn()}
          onChanged={jest.fn()}
        />
      </OrganizerProvider>
    );

  it('follows the name with the post', () => {
    openWith('Senior Manager, Kataho');

    expect(
      screen.getByText('Prabhat Karmacharya · Senior Manager, Kataho')
    ).toBeInTheDocument();
  });

  it('says the name alone where no post was given', () => {
    openWith(undefined);

    expect(screen.getByText('Prabhat Karmacharya')).toBeInTheDocument();
  });
});

/**
 * A speaker who is named but cannot be reached afterwards.
 *
 * The server asks for an address and a number when a session is first
 * written and leaves them alone on a patch, so a talk edited later can
 * carry a name and nothing else - and nothing said so. The warning for a
 * missing speaker did not fire, because there was a speaker.
 */
describe('warning that a speaker cannot be reached', () => {
  const withSpeaker = (contact: any) => ({
    ...event,
    sessions: [{
      id: 's1',
      title: 'Session Kataho',
      description: '',
      speaker_name: 'Prabhat Karmacharya',
      speaker_contact: contact,
      starts_at: '2026-09-15T10:00:00',
      duration_minutes: 30,
      status: 'scheduled',
    }],
    session_count: 1,
  });

  const openWith = (contact: any) =>
    render(
      <OrganizerProvider>
        <EventDetail
          event={withSpeaker(contact) as any}
          onBack={jest.fn()}
          onEdit={jest.fn()}
          onOpenRoom={jest.fn()}
          onChanged={jest.fn()}
        />
      </OrganizerProvider>
    );

  const warning = /Speaker contact information is not assigned or empty/;

  it('says so when there is no address', () => {
    openWith({ email: '', phone: '9811111111' });

    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it('says so when there is no number', () => {
    openWith({ email: 'p@example.com', phone: '' });

    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it('says so when there is neither', () => {
    openWith({ email: '   ', phone: '' });

    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it('says nothing when the speaker can be reached', () => {
    openWith({ email: 'p@example.com', phone: '9811111111' });

    expect(screen.queryByText(warning)).toBeNull();
  });

  /**
   * Only the host is sent a speaker's details, so for a co-host the field
   * is null - which says nothing about whether they were filled in.
   */
  it('claims nothing where the reader is not sent the details', () => {
    openWith(null);

    expect(screen.queryByText(warning)).toBeNull();
  });

  /** The older warning is about there being no speaker at all. */
  it('leaves the missing-speaker warning to say its own thing', () => {
    openWith({ email: '', phone: '' });

    expect(screen.queryByText(/has no speaker assigned/)).toBeNull();
  });
});

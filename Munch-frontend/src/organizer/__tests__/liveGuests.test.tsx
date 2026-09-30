import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { LiveView } from '../views/LiveView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getPendingMessages: jest.fn(),
    getGuests: jest.fn(),
    listSessions: jest.fn(),
    admitGuest: jest.fn(),
    getResources: jest.fn(),
    getConclusions: jest.fn(),
    getEventBoard: jest.fn(),
    getTranscript: jest.fn(),
    getEventSegments: jest.fn(),
    getPhotos: jest.fn(),
    createPhotoFolder: jest.fn(),
    getSchedulingPrefs: jest.fn(),
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
  id: 'm1', code: 'ABC123', title: 'Opening day', status: 'active',
  scheduled_start: new Date(Date.now() - 600000).toISOString(),
  scheduled_end: new Date(Date.now() + 3600000).toISOString(),
  started_at: new Date(Date.now() - 600000).toISOString(),
  participant_count: 1, sessions: [], session_count: 0,
  created_at: '', updated_at: '',
} as any;

const knocking = {
  id: 'g9', full_name: 'Rahul Ingnam', phone: null,
  status: 'pending', created_at: new Date().toISOString(), decided_at: null,
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getPendingMessages.mockResolvedValue([] as any);
  api.moderateMessage = jest.fn().mockResolvedValue({} as any);
  api.getGuests.mockResolvedValue([knocking] as any);
  api.listSessions.mockResolvedValue([] as any);
  api.admitGuest.mockResolvedValue({} as any);
  api.getResources.mockResolvedValue([] as any);
  api.uploadResource = jest.fn().mockResolvedValue({} as any);
  api.deleteResource = jest.fn().mockResolvedValue(undefined as any);
  api.getConclusions.mockResolvedValue({ conclusions: [] } as any);
  api.getEventBoard.mockResolvedValue({ faq: [], suggestions: [] } as any);
  api.getTranscript.mockResolvedValue({ segments: [] } as any);
  api.getEventSegments.mockResolvedValue([] as any);
  api.getPhotos.mockResolvedValue({
    folders: [], photos: [], can_arrange: true,
  } as any);
  api.createPhotoFolder.mockResolvedValue({ id: 'f1', name: 'Prabhat' } as any);
  api.getSchedulingPrefs.mockResolvedValue({ session_gap_minutes: 15 } as any);
});

const show = () =>
  render(
    <MemoryRouter>
      <OrganizerProvider>
        <LiveView events={[event]} onChanged={jest.fn()} onNavigate={jest.fn()} />
      </OrganizerProvider>
    </MemoryRouter>
  );

/**
 * A guest at the door, from live control.
 *
 * Moderation used to carry a queue of them; it does not any more. This
 * card and the popup inside the room are the whole of how somebody is
 * let in, and both call the same endpoint.
 */
describe('the join request queue', () => {
  it('names who is waiting', async () => {
    show();

    expect(await screen.findByText('Rahul Ingnam')).toBeInTheDocument();
    expect(screen.getByText('Join Request')).toBeInTheDocument();
  });

  it('lets them in', async () => {
    show();
    await screen.findByText('Rahul Ingnam');

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() =>
      expect(api.admitGuest).toHaveBeenCalledWith('m1', 'g9', 'admit')
    );
  });

  it('turns them away', async () => {
    show();
    await screen.findByText('Rahul Ingnam');

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    await waitFor(() =>
      expect(api.admitGuest).toHaveBeenCalledWith('m1', 'g9', 'deny')
    );
  });

  /** Somebody already in the room is not still knocking. */
  it('leaves out a guest who has already been let in', async () => {
    api.getGuests.mockResolvedValue([
      { ...knocking, id: 'g8', full_name: 'Sumin Maharjan', status: 'admitted' },
      knocking,
    ] as any);
    show();
    await screen.findByText('Rahul Ingnam');

    expect(screen.queryByText('Sumin Maharjan')).toBeNull();
  });
});


/**
 * What the live dashboard shows of the day.
 *
 * The running order is the same one the room shows rather than a second
 * drawing of it: a host rearranging the day here and looking at the room
 * on the next screen should be looking at one thing.
 */
describe('the live dashboard', () => {
  it('shows the running order the room shows', async () => {
    api.listSessions.mockResolvedValue([{
      id: 's1', event: 'm1', title: 'Kataho 1', description: '',
      speaker_name: 'Ram Rimal', speaker_visibility: 'public',
      starts_at: new Date().toISOString(), duration_minutes: 30,
      ends_at: new Date(Date.now() + 1800000).toISOString(),
      position: 0, status: 'scheduled', started_at: null, ended_at: null,
      attendance_count: 0,
    }] as any);
    show();

    expect(
      await screen.findByRole('heading', { name: 'Agenda Summary' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Drag a session onto another to change their places/)
    ).toBeInTheDocument();
  });

  /**
   * The chat rules went with the chat.
   *
   * Driven with a session actually on stage, because that is the only
   * state the panel ever appeared in - asserted against an event with
   * nothing running, the test passes whether the panel exists or not.
   */
  it('offers no chat rules, even with a session on stage', async () => {
    api.listSessions.mockResolvedValue([{
      id: 's1', event: 'm1', title: 'Kataho 1', description: '',
      speaker_name: 'Ram Rimal', speaker_visibility: 'public',
      starts_at: new Date(Date.now() - 300000).toISOString(),
      duration_minutes: 30,
      ends_at: new Date(Date.now() + 1500000).toISOString(),
      position: 0, status: 'live',
      started_at: new Date(Date.now() - 300000).toISOString(),
      ended_at: null, attendance_count: 0,
    }] as any);
    show();
    await screen.findByText('Rahul Ingnam');

    expect(screen.queryByText('Chat rules')).toBeNull();
  });
});


/**
 * What is waiting for the host, and the one decision left on it.
 *
 * Which board a message belongs on is not the host's to choose: the
 * person who wrote it chose, under the questions board or the
 * suggestions board, and it has carried that choice ever since. Asking
 * the host to pick again meant two people deciding one thing, and the
 * second one guessing.
 */
describe('the message request queue', () => {
  const waiting = (over: any = {}) => ({
    id: 'q9', body: 'who is prabhat?', created_at: new Date().toISOString(),
    is_direct: true, moderation_status: 'pending', sender_id: 'g1',
    sender_name: 'Rahul Ingnam', sender_is_guest: true,
    recipient_name: 'The host', topic: 'faq',
    ...over,
  });

  it('offers approving and rejecting, not two boards', async () => {
    api.getPendingMessages.mockResolvedValue([waiting()] as any);
    show();

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Question' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suggestions' })).toBeNull();
  });

  /** Approving files it where the asker said, without being told again. */
  it('puts one up without naming a board', async () => {
    api.getPendingMessages.mockResolvedValue([waiting()] as any);
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(api.moderateMessage).toHaveBeenCalledWith(
        'm1', 'q9', 'approve', undefined
      )
    );
  });

  it('turns one down', async () => {
    api.getPendingMessages.mockResolvedValue([waiting()] as any);
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(api.moderateMessage).toHaveBeenCalledWith(
        'm1', 'q9', 'decline', undefined
      )
    );
  });
});

/**
 * Making a folder from the desk.
 *
 * It used to be the browser's own prompt box, which is not a screen
 * anybody designed.
 */
describe('the photos tab', () => {
  const openPhotos = async () => {
    show();
    await screen.findByText('Rahul Ingnam');
    fireEvent.click(screen.getByRole('tab', { name: 'Photos' }));
  };

  it('asks for the name on a dialog, not a prompt box', async () => {
    const asked = jest.spyOn(window, 'prompt');
    await openPhotos();

    fireEvent.click(await screen.findByRole('button', { name: /New Folder/ }));

    expect(await screen.findByLabelText('Folder name')).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
    asked.mockRestore();
  });

  it('creates the folder it was given', async () => {
    await openPhotos();
    fireEvent.click(await screen.findByRole('button', { name: /New Folder/ }));

    fireEvent.change(await screen.findByLabelText('Folder name'), {
      target: { value: 'Prabhat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));

    await waitFor(() =>
      expect(api.createPhotoFolder).toHaveBeenCalledWith('ABC123', 'Prabhat')
    );
  });

  /** A name is required; the button says so by staying off. */
  it('will not create an unnamed one', async () => {
    await openPhotos();
    fireEvent.click(await screen.findByRole('button', { name: /New Folder/ }));
    await screen.findByLabelText('Folder name');

    expect(screen.getByRole('button', { name: 'Create folder' })).toBeDisabled();
  });

  /** Dismissed mid-typing, it should not reopen with the abandoned name. */
  it('forgets what was typed when it is dismissed', async () => {
    await openPhotos();
    fireEvent.click(await screen.findByRole('button', { name: /New Folder/ }));
    fireEvent.change(await screen.findByLabelText('Folder name'), {
      target: { value: 'Abandoned' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: /New Folder/ }));
    expect(await screen.findByLabelText('Folder name')).toHaveValue('');
  });
});

/**
 * What the room has asked, on the questions tab.
 *
 * Grouped under the talk it was asked during: a host deciding on
 * twenty questions is deciding about four talks, and the pile said
 * nothing about which.
 */
describe('the questions tab', () => {
  const asked = (over: any = {}) => ({
    id: 'q1', body: 'What happens to the escalation list?',
    sender_name: 'John D.', sender_id: 'u2', sender_email: null,
    sender_is_guest: false, recipient_id: null, recipient_name: null,
    recipient_is_guest: false, is_direct: false,
    moderation_status: 'pending',
    created_at: new Date(Date.now() - 120000).toISOString(),
    session: 's1', session_title: 'Opening Keynote',
    ...over,
  });

  const openQuestions = async () => {
    api.listSessions.mockResolvedValue([
      { id: 's1', event: 'm1', title: 'Opening Keynote',
        speaker_name: 'Ram Rimal',
        starts_at: '2026-09-15T04:00:00Z', duration_minutes: 30,
        status: 'done', position: 0 },
      { id: 's2', event: 'm1', title: 'Field Response',
        speaker_name: 'Sita Gurung',
        starts_at: '2026-09-15T05:00:00Z', duration_minutes: 30,
        status: 'scheduled', position: 1 },
    ] as any);
    show();
    await screen.findByText('Rahul Ingnam');
    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));
  };

  it('files each one under the talk it was asked during', async () => {
    api.getPendingMessages.mockResolvedValue([
      asked({ id: 'q1', body: 'About the keynote.', session: 's1' }),
      asked({ id: 'q2', body: 'About the field.', session: 's2' }),
    ] as any);

    await openQuestions();

    const group = (await screen.findByText('“About the keynote.”'))
      .closest('div.bg-white') as HTMLElement;
    expect(within(group).queryByText('“About the field.”')).toBeNull();
  });

  it('says how many each talk is waiting on', async () => {
    api.getPendingMessages.mockResolvedValue([
      asked({ id: 'q1', session: 's1' }),
      asked({ id: 'q2', session: 's1' }),
    ] as any);

    await openQuestions();

    expect(await screen.findByText('2 pending')).toBeInTheDocument();
  });

  /** Approving files it where the asker said, without being told again. */
  it('approves without naming a board', async () => {
    api.getPendingMessages.mockResolvedValue([asked()] as any);
    await openQuestions();

    const card = (await screen.findByText('“What happens to the escalation list?”'))
      .closest('div.bg-white') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(api.moderateMessage).toHaveBeenCalledWith('m1', 'q1', 'approve')
    );
  });

  it('rejects one', async () => {
    api.getPendingMessages.mockResolvedValue([asked()] as any);
    await openQuestions();

    const card = (await screen.findByText('“What happens to the escalation list?”'))
      .closest('div.bg-white') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(api.moderateMessage).toHaveBeenCalledWith('m1', 'q1', 'decline')
    );
  });

  /** A decided question leaves at once; waiting for the poll to agree
      would leave the host looking at a stale queue. */
  it('takes a decided one off the list straight away', async () => {
    api.getPendingMessages.mockResolvedValue([asked()] as any);
    await openQuestions();

    const card = (await screen.findByText('“What happens to the escalation list?”'))
      .closest('div.bg-white') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(
      screen.queryByText('“What happens to the escalation list?”')
    ).toBeNull());
  });
});

/**
 * What has been shared with the room, on the slides tab.
 *
 * A bare filename said nothing about what a file was, how big, who put
 * it there or when - and offered no way to take it off again. It now
 * reads the way every other list of files in the product reads.
 */
describe('the slides tab', () => {
  const file = (over: any = {}) => ({
    id: 'a1', event_id: 'm1', artifact_type: 'resource',
    display_name: 'Field Protocol Guide.pdf', file_size: 1258291,
    sync_status: 'synced', uploaded_by_name: 'Sarah Sharma',
    created_at: new Date().toISOString(),
    ...over,
  });

  const openSlides = async () => {
    show();
    await screen.findByText('Rahul Ingnam');
    fireEvent.click(screen.getByRole('tab', { name: 'Slides' }));
  };

  it('says what each file is, and who shared it', async () => {
    api.getResources.mockResolvedValue([file()] as any);
    await openSlides();

    expect(await screen.findByText('Field Protocol Guide.pdf')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText(/Sarah Sharma/)).toBeInTheDocument();
  });

  it('takes one off', async () => {
    api.getResources.mockResolvedValue([file()] as any);
    await openSlides();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove Field Protocol Guide.pdf' })
    );

    await waitFor(() => expect(api.deleteResource).toHaveBeenCalledWith('m1', 'a1'));
  });

  /**
   * Under the talk it belongs to. A flat list said which files
   * existed and not which part of the day they were for, which is
   * what a host asks of them while the day is running.
   */
  it('files each one under the talk it belongs to', async () => {
    api.listSessions.mockResolvedValue([
      { id: 's1', event: 'm1', title: 'Opening Keynote',
        starts_at: '2026-09-15T04:00:00Z', duration_minutes: 30,
        status: 'done', position: 0 },
      { id: 's2', event: 'm1', title: 'Field Response',
        starts_at: '2026-09-15T05:00:00Z', duration_minutes: 30,
        status: 'scheduled', position: 1 },
    ] as any);
    api.getResources.mockResolvedValue([
      file({ id: 'a1', display_name: 'Keynote Deck.pdf', session: 's1' }),
      file({ id: 'a2', display_name: 'Field Map.pdf', session: 's2' }),
    ] as any);

    await openSlides();

    // Anchored on the file rather than the heading: the stage card and
    // the running order below both name the talk as well.
    const group = (await screen.findByText('Keynote Deck.pdf'))
      .closest('div.bg-white') as HTMLElement;

    expect(within(group).getByText('Opening Keynote')).toBeInTheDocument();
    expect(within(group).queryByText('Field Map.pdf')).toBeNull();
  });

  /** A file shared against no talk is still findable. */
  it('keeps one that belongs to no talk where it can be seen', async () => {
    api.getResources.mockResolvedValue([
      file({ display_name: 'Programme.pdf', session: null }),
    ] as any);

    await openSlides();

    const loose = (await screen.findByText('For the whole event'))
      .closest('div.bg-white') as HTMLElement;
    expect(within(loose).getByText('Programme.pdf')).toBeInTheDocument();
  });

  /** Each group adds to itself, so a file goes where it was put. */
  it('shares a new one into the talk it was added under', async () => {
    api.listSessions.mockResolvedValue([
      { id: 's1', event: 'm1', title: 'Opening Keynote',
        starts_at: '2026-09-15T04:00:00Z', duration_minutes: 30,
        status: 'done', position: 0 },
    ] as any);
    api.getResources.mockResolvedValue([] as any);

    await openSlides();
    // The one Add inside the panel; the group is the only thing there.
    fireEvent.click(await screen.findByRole('button', { name: '+ Add' }));

    const sent = new File(['x'], 'Map.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Choose files'), {
      target: { files: [sent] },
    });

    await waitFor(() =>
      expect(api.uploadResource).toHaveBeenCalledWith('m1', sent, undefined, 's1')
    );
  });

  /**
   * Questions arrive from the room and photographs have their own way
   * in, so an Add on those two tabs would be a puzzle.
   */
  it('offers no Add on the questions tab', async () => {
    await openSlides();

    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));
    expect(screen.queryByRole('button', { name: '+ Add' })).toBeNull();
  });
});

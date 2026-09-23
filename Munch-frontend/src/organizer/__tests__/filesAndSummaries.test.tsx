import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { ContentView } from '../views/ContentView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    listSessions: jest.fn(),
    getResources: jest.fn(),
    getPhotos: jest.fn(),
    getSessionSummary: jest.fn(),
    saveSessionSummary: jest.fn(),
    publishSessionSummary: jest.fn(),
    unpublishSessionSummary: jest.fn(),
    uploadResource: jest.fn(),
    deleteResource: jest.fn(),
    createPhotoFolder: jest.fn(),
    uploadPhoto: jest.fn(),
    getPhotoObjectUrl: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const event = (over: any = {}) => ({
  id: 'm1', code: 'EMG-1', title: 'Emergency Service Meeting',
  status: 'ended', started_at: '2026-09-15T04:15:00Z',
  venue: 'Kathmandu Convention Center',
  scheduled_start: '2026-09-15T04:15:00Z',
  scheduled_end: '2026-09-15T06:15:00Z',
  ...over,
}) as any;

const session = (over: any = {}) => ({
  id: 's1', event: 'm1', title: 'Emergency Response Overview',
  speaker_name: 'Sarah Sharma', starts_at: '2026-09-15T04:15:00Z',
  duration_minutes: 30, status: 'done',
  ...over,
}) as any;

const summary = (over: any = {}) => ({
  session: 's1', session_title: 'Emergency Response Overview',
  body: 'The opening agenda introduced key themes.',
  actions: [], status: 'published', is_published: true, saved: true,
  published_at: '2026-09-15T04:42:00Z', updated_at: '2026-09-15T04:42:00Z',
  ...over,
}) as any;

const artifact = (over: any = {}) => ({
  id: 'a1', event_id: 'm1', artifact_type: 'resource',
  display_name: 'Response Plan Overview.pdf',
  file_size: 1258291, sync_status: 'synced',
  session: 's1', session_title: 'Emergency Response Overview',
  uploaded_by_name: 'Sarah Sharma',
  created_at: new Date().toISOString(),
  ...over,
}) as any;

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.listSessions.mockResolvedValue([session()] as any);
  api.getResources.mockResolvedValue([artifact()] as any);
  api.getPhotos.mockResolvedValue({
    event_id: 'm1', code: 'EMG-1', event_title: 'Emergency Service Meeting',
    event_is_finished: true, can_upload: true, is_a_photographer: true,
    can_arrange: true,
    folders: [{
      id: 'f1', name: 'Event Opening', is_default: false, created_by: 'Sumin',
      is_mine: true, photo_count: 2, created_at: new Date().toISOString(),
    }],
    photos: [],
  } as any);
  api.getSessionSummary.mockResolvedValue(summary() as any);
  api.getPhotoObjectUrl.mockResolvedValue('blob:one');
});

const show = (events = [event()]) =>
  render(
    <OrganizerProvider>
      <ContentView events={events} />
    </OrganizerProvider>
  );

/** Getting from the grid of events into one event's three tabs. */
const openEvent = async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'View Event' }));
};

/**
 * The first screen: the events themselves.
 *
 * A summary or a handout belongs to one event, so the landing is the
 * events rather than a list across all of them at once.
 */
describe('the files and summaries grid', () => {
  it('gives each event a card with what it produced', async () => {
    show();

    expect(await screen.findByText('Emergency Service Meeting')).toBeInTheDocument();
    expect(await screen.findByText('1 Agendas')).toBeInTheDocument();
    expect(screen.getByText('1 Summaries')).toBeInTheDocument();
    expect(screen.getByText('1 files')).toBeInTheDocument();
    expect(screen.getByText('1 Folders')).toBeInTheDocument();
  });

  /** An event that has run is tinted and says so; one still to come is not. */
  it('says whether an event has happened', async () => {
    show([event(), event({ id: 'm2', title: 'Budget Hearing', status: 'scheduled', started_at: null })]);

    await screen.findByText('Budget Hearing');
    // 'Completed' is also a filter pill, so the chips are counted rather
    // than fetched: one card carries each word.
    expect(screen.getAllByText('Completed')).toHaveLength(2);
    expect(screen.getAllByText('Upcoming')).toHaveLength(2);
  });

  it('narrows to the ones that have happened', async () => {
    show([event(), event({ id: 'm2', title: 'Budget Hearing', status: 'scheduled', started_at: null })]);
    await screen.findByText('Budget Hearing');

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));

    expect(screen.queryByText('Budget Hearing')).toBeNull();
    expect(screen.getByText('Emergency Service Meeting')).toBeInTheDocument();
  });

  it('narrows by what is typed', async () => {
    show([event(), event({ id: 'm2', title: 'Budget Hearing' })]);
    await screen.findByText('Budget Hearing');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'budget' } });

    expect(screen.queryByText('Emergency Service Meeting')).toBeNull();
  });

  it('opens one, on its summaries', async () => {
    await openEvent();

    expect(await screen.findByRole('tab', { name: 'Summaries' })).toHaveAttribute(
      'aria-selected', 'true'
    );
    expect(screen.getByText(/Kathmandu Convention Center/)).toBeInTheDocument();
  });

  it('goes back to the grid', async () => {
    await openEvent();
    await screen.findByRole('tab', { name: 'Summaries' });

    fireEvent.click(screen.getByRole('button', { name: 'Files and Summaries' }));

    expect(await screen.findByRole('button', { name: 'View Event' })).toBeInTheDocument();
  });
});

describe('the summaries of one event', () => {
  it('counts the agendas, the published and the drafts', async () => {
    api.listSessions.mockResolvedValue([
      session(), session({ id: 's2', title: 'Field Response' }),
    ] as any);
    api.getSessionSummary.mockImplementation((id: string) =>
      Promise.resolve(
        id === 's1' ? summary() : summary({
          session: 's2', is_published: false, status: 'needs_approval',
          published_at: null,
        })
      ) as any
    );
    await openEvent();

    const agendas = await screen.findByText('Agendas');
    expect(agendas.parentElement).toHaveTextContent('2');
  });

  it('offers to withdraw one that is published', async () => {
    api.unpublishSessionSummary.mockResolvedValue(summary() as any);
    await openEvent();

    fireEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));

    await waitFor(() =>
      expect(api.unpublishSessionSummary).toHaveBeenCalledWith('s1')
    );
  });

  it('offers to put out one that is a draft', async () => {
    api.getSessionSummary.mockResolvedValue(summary({
      is_published: false, status: 'needs_approval', published_at: null,
    }) as any);
    api.publishSessionSummary.mockResolvedValue(summary() as any);
    await openEvent();

    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    await waitFor(() =>
      expect(api.publishSessionSummary).toHaveBeenCalledWith('s1')
    );
  });

  /**
   * One that was never written has nothing to preview or withdraw, only
   * the transcript to read and a first draft to make from it.
   */
  it('offers a transcript and a first draft where nothing is written', async () => {
    api.getSessionSummary.mockResolvedValue(summary({
      saved: false, is_published: false, published_at: null,
      body: 'We opened at nine.',
    }) as any);
    await openEvent();

    // Also the name of a filter pill, so the badge is the second of two.
    expect(await screen.findAllByText('Not available')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'View transcript' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate summary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unpublish' })).toBeNull();
  });

  it('writes the first draft out of the transcript', async () => {
    api.getSessionSummary.mockResolvedValue(summary({
      saved: false, is_published: false, published_at: null,
      body: 'We opened at nine.',
    }) as any);
    api.saveSessionSummary.mockResolvedValue(summary() as any);
    await openEvent();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate summary' }));

    await waitFor(() =>
      expect(api.saveSessionSummary).toHaveBeenCalledWith('s1', 'We opened at nine.')
    );
  });

  /** Nothing was said, so there is nothing to write a summary out of. */
  it('refuses to invent one where there is no transcript', async () => {
    api.getSessionSummary.mockResolvedValue(summary({
      saved: false, is_published: false, published_at: null, body: '',
    }) as any);
    await openEvent();

    fireEvent.click(await screen.findByRole('button', { name: 'Generate summary' }));

    await waitFor(() => expect(api.saveSessionSummary).not.toHaveBeenCalled());
  });

  it('rewrites one, and can publish in the same breath', async () => {
    api.saveSessionSummary.mockResolvedValue(summary() as any);
    api.publishSessionSummary.mockResolvedValue(summary() as any);
    await openEvent();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Summary'), {
      target: { value: 'A shorter account.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save & publish' }));

    // Waited on the second call, not the first: the save resolves before
    // the publish is sent, so waiting on the save proves nothing about it.
    await waitFor(() =>
      expect(api.publishSessionSummary).toHaveBeenCalledWith('s1')
    );
    expect(api.saveSessionSummary).toHaveBeenCalledWith('s1', 'A shorter account.');
  });

  /** Which summary is being rewritten is not itself editable. */
  it('names the agenda and its speaker, read-only, while editing', async () => {
    await openEvent();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Emergency Response Overview')).toBeInTheDocument();
    expect(within(dialog).getByText('Sarah Sharma')).toBeInTheDocument();
  });
});

describe('the files of one event', () => {
  const openFiles = async () => {
    await openEvent();
    fireEvent.click(await screen.findByRole('tab', { name: 'Files' }));
  };

  it('groups them under the agenda they were shared at', async () => {
    await openFiles();

    expect(await screen.findByText('Response Plan Overview.pdf')).toBeInTheDocument();
    expect(screen.getByText(/1 file/)).toBeInTheDocument();
    expect(screen.getByText(/Sarah Sharma/)).toBeInTheDocument();
  });

  it('says what kind of file each one is', async () => {
    api.getResources.mockResolvedValue([
      artifact(), artifact({ id: 'a2', display_name: 'Checklist.xlsx' }),
    ] as any);
    await openFiles();

    expect(await screen.findByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('XLSX')).toBeInTheDocument();
  });

  /**
   * An agenda nobody has shared anything against still appears: its
   * header is where the button to add the first file lives.
   */
  it('shows an agenda with nothing on it', async () => {
    api.getResources.mockResolvedValue([] as any);
    await openFiles();

    expect(await screen.findByText('Emergency Response Overview')).toBeInTheDocument();
    expect(screen.getByText('Nothing on this agenda yet.')).toBeInTheDocument();
  });

  it('takes one off', async () => {
    api.deleteResource.mockResolvedValue(undefined as any);
    await openFiles();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove Response Plan Overview.pdf' })
    );

    await waitFor(() => expect(api.deleteResource).toHaveBeenCalledWith('m1', 'a1'));
  });

  it('files a new one against the agenda it was opened from', async () => {
    api.uploadResource.mockResolvedValue(artifact() as any);
    await openFiles();

    fireEvent.click(await screen.findByRole('button', { name: '+ Add' }));
    const file = new File(['x'], 'Map.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Choose files'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() =>
      expect(api.uploadResource).toHaveBeenCalledWith('m1', file, undefined, 's1')
    );
  });
});

describe('the photographs of one event', () => {
  const openPhotos = async () => {
    await openEvent();
    fireEvent.click(await screen.findByRole('tab', { name: 'Photos' }));
  };

  it('lists the folders', async () => {
    await openPhotos();

    expect(await screen.findByText('Event Opening')).toBeInTheDocument();
    expect(screen.getByText(/2 photos/)).toBeInTheDocument();
  });

  it('makes a new one', async () => {
    api.createPhotoFolder.mockResolvedValue({} as any);
    await openPhotos();

    fireEvent.click(await screen.findByRole('button', { name: 'New Folder' }));
    fireEvent.change(screen.getByLabelText('Folder name'), {
      target: { value: 'Networking' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));

    await waitFor(() =>
      expect(api.createPhotoFolder).toHaveBeenCalledWith('EMG-1', 'Networking')
    );
  });

  /** A folder is the whole of the arrangement, so opening one replaces the grid. */
  it('opens one, and comes back out of it', async () => {
    await openPhotos();

    fireEvent.click(await screen.findByText('Event Opening'));

    expect(
      await screen.findByRole('button', { name: 'Upload photos' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Folder' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Folders' }));

    expect(
      await screen.findByRole('button', { name: 'New Folder' })
    ).toBeInTheDocument();
  });

  it('puts a photograph into the folder that is open', async () => {
    api.uploadPhoto.mockResolvedValue({} as any);
    await openPhotos();
    fireEvent.click(await screen.findByText('Event Opening'));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload photos' }));

    const shot = new File(['x'], 'one.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Choose photos'), {
      target: { files: [shot] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() =>
      expect(api.uploadPhoto).toHaveBeenCalledWith('EMG-1', 'f1', shot)
    );
  });
});

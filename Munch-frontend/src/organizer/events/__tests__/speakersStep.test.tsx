import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizerProvider } from '../../i18n';
import { SpeakersStep } from '../SpeakersStep';
import { apiClient } from '../../../services/api';

jest.mock('../../../services/api', () => ({
  apiClient: {
    getSpeakers: jest.fn(),
    createSpeaker: jest.fn(),
    updateSpeaker: jest.fn(),
    deleteSpeaker: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const event = { id: 'e1', code: 'ABC', title: 'Emergency Services' } as any;

const session = (over: any = {}) => ({
  id: 's1', event: 'e1', title: 'Opening', description: '',
  speaker_name: '', speaker_visibility: 'private',
  starts_at: '2026-09-15T04:15:00Z', duration_minutes: 30,
  ends_at: '2026-09-15T04:45:00Z', position: 0, status: 'scheduled',
  started_at: null, ended_at: null, attendance_count: 0,
  ...over,
}) as any;

const speaker = (over: any = {}) => ({
  id: 'sp1', event: 'e1', full_name: 'Anjelika Sah',
  position: 'VP of Engineering', organization: 'Prixa Technologies',
  photo_url: null, linkedin_url: '', website_url: '', email: '', phone: '',
  sessions: [], created_at: '',
  ...over,
});

// jsdom has no object URLs, and the form makes one to preview the photo
// somebody has just chosen.
beforeAll(() => {
  (URL as any).createObjectURL = jest.fn(() => 'blob:preview');
  (URL as any).revokeObjectURL = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getSpeakers.mockResolvedValue([] as any);
  api.createSpeaker.mockResolvedValue(speaker() as any);
  api.updateSpeaker.mockResolvedValue(speaker() as any);
  api.deleteSpeaker.mockResolvedValue(undefined as any);
});

const show = (sessions: any[] = [session()]) =>
  render(
    <OrganizerProvider>
      <SpeakersStep event={event} sessions={sessions} onChanged={jest.fn()} />
    </OrganizerProvider>
  );

const openForm = async (sessions: any[] = [session()]) => {
  show(sessions);
  fireEvent.click(await screen.findByRole('button', { name: /Add Speaker/ }));
};

/**
 * The dialog's own submit.
 *
 * It shares its name with the button that opened it, which is right on
 * screen - both say what they do - and ambiguous to a query, so the
 * dialog is what gets asked.
 */
const submit = (name = 'Add Speaker') =>
  within(screen.getByRole('dialog')).getByRole('button', { name });

/**
 * A speaker as a profile, rather than four strings on a talk.
 *
 * Somebody speaking twice used to be two unrelated sets of strings, and
 * their photograph had nowhere to live. The profile is written once and
 * put on whichever talks they give.
 */
describe('the speakers step', () => {
  it('says so plainly where there are none', async () => {
    show();

    expect(await screen.findByText('No speakers yet.')).toBeInTheDocument();
  });

  it('gives each one a card with what they do', async () => {
    api.getSpeakers.mockResolvedValue([speaker()] as any);
    show();

    expect(await screen.findByText('Anjelika Sah')).toBeInTheDocument();
    expect(screen.getByText('VP of Engineering')).toBeInTheDocument();
    expect(screen.getByText('Prixa Technologies')).toBeInTheDocument();
  });

  it('says which agendas they are on, or that they are on none', async () => {
    api.getSpeakers.mockResolvedValue([
      speaker(),
      speaker({ id: 'sp2', full_name: 'David Thapa', sessions: [{ id: 's1', title: 'Opening' }] }),
    ] as any);
    show();

    expect(await screen.findByText('No agenda assigned')).toBeInTheDocument();
    expect(screen.getByText('Opening')).toBeInTheDocument();
  });

  /** A profile with no photograph still has a face-shaped place. */
  it('shows a photograph where there is one', async () => {
    api.getSpeakers.mockResolvedValue([
      speaker({ photo_url: 'http://x/face.png' }),
    ] as any);
    show();

    await screen.findByText('Anjelika Sah');
    expect(document.querySelector('img[src="http://x/face.png"]')).toBeTruthy();
  });
});

describe('adding one', () => {
  it('writes the profile', async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText(/Speaker's name/), {
      target: { value: 'Anjelika Sah' },
    });
    fireEvent.change(screen.getByLabelText('Position'), {
      target: { value: 'VP of Engineering' },
    });
    fireEvent.click(submit());

    await waitFor(() => expect(api.createSpeaker).toHaveBeenCalled());
    const [, draft] = api.createSpeaker.mock.calls[0];
    expect(draft.full_name).toBe('Anjelika Sah');
    expect(draft.position).toBe('VP of Engineering');
  });

  it('will not write one with no name', async () => {
    await openForm();

    fireEvent.click(submit());

    await waitFor(() => expect(api.createSpeaker).not.toHaveBeenCalled());
  });

  it('puts them on the agendas that were ticked', async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText(/Speaker's name/), {
      target: { value: 'Anjelika Sah' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit());

    await waitFor(() => expect(api.createSpeaker).toHaveBeenCalled());
    expect(api.createSpeaker.mock.calls[0][1].session_ids).toEqual(['s1']);
  });

  /** They can be written before the running order exists. */
  it('says so where there is no agenda to assign yet', async () => {
    await openForm([]);

    expect(
      screen.getByText('No agendas yet — they can be assigned later.')
    ).toBeInTheDocument();
  });

  it('carries the photograph with the profile, in one request', async () => {
    await openForm();

    const face = new File(['x'], 'face.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose a photo'), {
      target: { files: [face] },
    });
    fireEvent.change(screen.getByLabelText(/Speaker's name/), {
      target: { value: 'Anjelika Sah' },
    });
    fireEvent.click(submit());

    await waitFor(() => expect(api.createSpeaker).toHaveBeenCalled());
    expect(api.createSpeaker.mock.calls[0][2]).toBe(face);
  });

  /** Refused here as well as on the server, so the answer is immediate. */
  it('turns away a photograph over five megabytes', async () => {
    await openForm();

    const huge = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Choose a photo'), {
      target: { files: [huge] },
    });
    fireEvent.change(screen.getByLabelText(/Speaker's name/), {
      target: { value: 'Anjelika Sah' },
    });
    fireEvent.click(submit());

    await waitFor(() => expect(api.createSpeaker).toHaveBeenCalled());
    expect(api.createSpeaker.mock.calls[0][2]).toBeNull();
  });
});

describe('changing one', () => {
  it('opens the form on what is already there', async () => {
    api.getSpeakers.mockResolvedValue([speaker()] as any);
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Anjelika Sah' }));

    expect(screen.getByLabelText(/Speaker's name/)).toHaveValue('Anjelika Sah');
    expect(screen.getByLabelText('Position')).toHaveValue('VP of Engineering');
  });

  it('saves the change against the same profile', async () => {
    api.getSpeakers.mockResolvedValue([speaker()] as any);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Anjelika Sah' }));

    fireEvent.change(screen.getByLabelText(/Speaker's name/), {
      target: { value: 'A. Sah' },
    });
    fireEvent.click(submit('Save'));

    await waitFor(() =>
      expect(api.updateSpeaker).toHaveBeenCalledWith(
        'e1', 'sp1', expect.objectContaining({ full_name: 'A. Sah' }), null
      )
    );
  });
});

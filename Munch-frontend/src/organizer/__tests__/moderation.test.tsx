import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { ModerationView } from '../views/ModerationView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    listEvents: jest.fn(),
    getPendingMessages: jest.fn(),
    getGuests: jest.fn(),
    getReviewedMessages: jest.fn(),
    getMeetingBoard: jest.fn(),
    getPhotos: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const meeting = {
  id: 'm1', title: 'Wedding Preparation', meeting_code: 'IRL-NH7',
  status: 'active',
  scheduled_start: '2026-09-08T03:30:00Z',
  scheduled_end: '2026-09-08T09:00:00Z',
} as any;

const message = (over: any = {}) => ({
  id: 'x1',
  body: 'when is the reception?',
  created_at: '2026-09-08T04:00:00Z',
  is_direct: true,
  sender_id: 'g1',
  sender_name: 'Suman Dhungana',
  sender_email: '',
  sender_is_guest: true,
  recipient_id: 'u9',
  recipient_name: 'tithighadi@gmail.com',
  recipient_is_guest: false,
  moderation_status: 'pending',
  topic: 'not_required',
  answer: '',
  ...over,
});

const show = () =>
  render(
    <OrganizerProvider>
      <ModerationView meetings={[meeting]} />
    </OrganizerProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.listEvents.mockResolvedValue([]);
  api.getGuests.mockResolvedValue([]);
  api.getReviewedMessages.mockResolvedValue({ from_users: [], from_guests: [] } as any);
  api.getPendingMessages.mockResolvedValue([]);
  api.getPhotos.mockResolvedValue({
    meeting_id: 'm1', meeting_code: 'IRL-NH7', meeting_title: 'Wedding Preparation',
    meeting_is_finished: false, can_upload: false, is_a_photographer: true,
    can_arrange: true, folders: [], photos: [],
  } as any);
});

describe('which queue a message belongs in', () => {
  it("keeps a guest's message out of the messages tab", async () => {
    // It arrived through the guest door, so it is the guest queue's
    // business wherever it is in its life.
    api.getPendingMessages.mockResolvedValue([message()] as any);

    show();

    // Wait for the queue to have landed somewhere before saying where it
    // is not: a negative assertion made too early passes on its own.
    await screen.findByRole('tab', { name: 'Guests (1)' });
    expect(screen.getByRole('tab', { name: 'Messages (0)' })).toBeInTheDocument();
    expect(screen.queryByText('when is the reception?')).not.toBeInTheDocument();
  });

  it('shows it under guests instead', async () => {
    api.getPendingMessages.mockResolvedValue([message()] as any);

    show();

    fireEvent.click(await screen.findByRole('tab', { name: /Guests/ }));
    expect(await screen.findByText('when is the reception?')).toBeInTheDocument();
  });

  it('counts it against the guests tab', async () => {
    api.getPendingMessages.mockResolvedValue([message(), message({ id: 'x2' })] as any);

    show();

    expect(await screen.findByRole('tab', { name: 'Guests (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Messages (0)' })).toBeInTheDocument();
  });

  it("leaves an account holder's message where it was", async () => {
    api.getPendingMessages.mockResolvedValue([
      message({
        id: 'u1', sender_is_guest: false, sender_name: 'Sabina Rai',
        sender_email: 'sabina@example.org', body: 'will slides be shared?',
      }),
    ] as any);

    show();

    expect(await screen.findByText('will slides be shared?')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Messages (1)' })).toBeInTheDocument();
  });

  it('sorts a mixed queue into the two tabs', async () => {
    api.getPendingMessages.mockResolvedValue([
      message({ id: 'g', body: 'from a guest' }),
      message({ id: 'u', sender_is_guest: false, body: 'from an attendee' }),
    ] as any);

    show();

    await screen.findByRole('tab', { name: 'Guests (1)' });
    expect(screen.getByText('from an attendee')).toBeInTheDocument();
    expect(screen.queryByText('from a guest')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Guests/ }));
    expect(await screen.findByText('from a guest')).toBeInTheDocument();
    expect(screen.queryByText('from an attendee')).not.toBeInTheDocument();
  });
});

describe('what belongs under the photographs', () => {
  it('does not put the passed-on record beneath them', async () => {
    show();

    fireEvent.click(await screen.findByRole('tab', { name: 'Photos' }));

    await waitFor(() => expect(api.getPhotos).toHaveBeenCalled());
    expect(screen.queryByText('Passed on')).not.toBeInTheDocument();
  });

  it('still keeps that record under the two queues', async () => {
    show();

    fireEvent.click(await screen.findByRole('tab', { name: /Transfers/ }));
    expect(screen.getByText('Passed on')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Guests/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Transfers/ }));
    expect(screen.getByText('Passed on')).toBeInTheDocument();
  });
});

describe('the two halves of a queue', () => {
  const passedOn = (over: any = {}) => ({
    ...message({ id: 'p1', moderation_status: 'approved', topic: 'faq' }),
    meetingId: 'm1',
    ...over,
  });

  it('opens on the deciding half', async () => {
    api.getPendingMessages.mockResolvedValue([
      message({ sender_is_guest: false, body: 'will slides be shared?' }),
    ] as any);

    show();

    // Wait for the queue itself, then say which half is showing it.
    expect(await screen.findByText('will slides be shared?')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Permissions/ })).toHaveAttribute(
      'aria-selected', 'true'
    );
    expect(screen.queryByText('Passed on')).not.toBeInTheDocument();
  });

  it('counts each half on its own tab', async () => {
    api.getPendingMessages.mockResolvedValue([
      message({ sender_is_guest: false }),
      message({ id: 'x2', sender_is_guest: false }),
    ] as any);
    api.getReviewedMessages.mockResolvedValue({
      from_users: [passedOn()], from_guests: [],
    } as any);

    show();

    expect(await screen.findByRole('tab', { name: 'Permissions (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Transfers (1)' })).toBeInTheDocument();
  });

  it('shows what was passed on under transfers, and the queue not at all', async () => {
    api.getPendingMessages.mockResolvedValue([
      message({ sender_is_guest: false, body: 'still waiting on this' }),
    ] as any);
    api.getReviewedMessages.mockResolvedValue({
      from_users: [passedOn({ body: 'already passed on' })], from_guests: [],
    } as any);

    show();

    fireEvent.click(await screen.findByRole('tab', { name: /Transfers/ }));

    expect(await screen.findByText('already passed on')).toBeInTheDocument();
    expect(screen.queryByText('still waiting on this')).not.toBeInTheDocument();
  });

  it('gives the guests queue its own pair', async () => {
    api.getReviewedMessages.mockResolvedValue({
      from_users: [], from_guests: [passedOn({ body: 'from a guest, passed on' })],
    } as any);

    show();

    fireEvent.click(await screen.findByRole('tab', { name: /Guests/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Transfers (1)' }));

    expect(await screen.findByText('from a guest, passed on')).toBeInTheDocument();
  });

  it('names the queue above its halves', async () => {
    show();

    // "Messages" as the heading, with Permissions and Transfers beneath.
    expect(
      await screen.findByRole('heading', { name: 'Messages' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Guests/ }));
    expect(screen.getByRole('heading', { name: 'Guests' })).toBeInTheDocument();
  });

  it('has no such halves on the board or the photographs', async () => {
    show();

    fireEvent.click(await screen.findByRole('tab', { name: /Questions/ }));
    expect(screen.queryByRole('tab', { name: /Permissions/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Photos' }));
    expect(screen.queryByRole('tab', { name: /Transfers/ })).not.toBeInTheDocument();
  });
});

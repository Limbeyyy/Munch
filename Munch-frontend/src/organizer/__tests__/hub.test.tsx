import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { HubView } from '../../attendee/views/HubView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getMeetingBoard: jest.fn(),
    getGuestBoard: jest.fn(),
    getPhotos: jest.fn(),
    getPhotoObjectUrl: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const show = (node: React.ReactElement) =>
  render(<OrganizerProvider>{node}</OrganizerProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
});

describe('the attendee hub', () => {
  const meetings = [
    { id: 'm1', title: 'Opening day', meeting_code: 'ABC123' } as any,
  ];

  it('is down to the board and the photographs', async () => {
    api.getMeetingBoard.mockResolvedValue({ questions: [], suggestions: [] } as any);

    show(<HubView meetings={meetings} myName="Sabina" />);

    expect(
      await screen.findByRole('tab', { name: 'Questions & suggestions' })
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Photos' })).toBeInTheDocument();
    // The board draws its own tabs inside, so the count is of the hub's own.
    const [hubTabs] = screen.getAllByRole('tablist');
    expect(hubTabs.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });

  it('has no room chat or private word in it any more', async () => {
    api.getMeetingBoard.mockResolvedValue({ questions: [], suggestions: [] } as any);

    show(<HubView meetings={meetings} myName="Sabina" />);

    await screen.findByRole('tab', { name: 'Photos' });
    expect(screen.queryByRole('tab', { name: 'The room' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'A word with a speaker' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Discussion' })).not.toBeInTheDocument();
  });

  it('opens the photographs from that tab', async () => {
    api.getMeetingBoard.mockResolvedValue({ questions: [], suggestions: [] } as any);
    api.getPhotos.mockResolvedValue({
      meeting_id: 'm1', meeting_code: 'ABC123', meeting_title: 'Opening day',
      meeting_is_finished: true, can_upload: false, is_a_photographer: false,
      can_arrange: false,
      folders: [{
        id: 'f1', name: 'Default', is_default: true, created_by: '',
        is_mine: false, photo_count: 0, created_at: '2026-09-08T04:00:00Z',
      }],
      photos: [],
    } as any);

    show(<HubView meetings={meetings} myName="Sabina" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Photos' }));

    await waitFor(() => expect(api.getPhotos).toHaveBeenCalledWith('ABC123'));
    expect(await screen.findByText('Default')).toBeInTheDocument();
  });
});

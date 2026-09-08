import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../i18n';
import { PhotoAlbums, PhotoUploads } from '../Photos';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    getPhotos: jest.fn(),
    createPhotoFolder: jest.fn(),
    deletePhotoFolder: jest.fn(),
    uploadPhoto: jest.fn(),
    deletePhoto: jest.fn(),
    getPhotoObjectUrl: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const folder = (over: any = {}) => ({
  id: 'f-default', name: 'Default', is_default: true, created_by: '',
  is_mine: false, photo_count: 0, created_at: '2026-09-08T04:00:00Z', ...over,
});

const photo = (over: any = {}) => ({
  id: 'p1', folder_id: 'f-default', caption: 'group.jpg', mime_type: 'image/jpeg',
  file_size: 1024, taken_by: 'Sunita Budha', taken_by_id: 'u2', is_mine: false,
  created_at: '2026-09-08T05:00:00Z', url: '/api/v1/meetings/photos/p1/file/', ...over,
});

const page = (over: any = {}) => ({
  meeting_id: 'm1', meeting_code: 'ABC123', meeting_title: 'Opening day',
  meeting_is_finished: true, can_upload: true, is_a_photographer: true,
  can_arrange: true, folders: [folder()], photos: [], ...over,
});

const show = (node: React.ReactElement) =>
  render(<OrganizerProvider>{node}</OrganizerProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.getPhotoObjectUrl.mockResolvedValue('blob:photo');
  (URL as any).revokeObjectURL = jest.fn();
});

describe('the photo section in the meeting room', () => {
  it('lists every folder with an upload beside it', async () => {
    api.getPhotos.mockResolvedValue(page({
      folders: [
        folder(),
        folder({ id: 'f2', name: 'Prize distribution', is_default: false, photo_count: 4 }),
        folder({ id: 'f3', name: 'Halls', is_default: false }),
      ],
    }) as any);

    show(<PhotoUploads meetingRef="ABC123" tone="dark" />);

    expect(await screen.findByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Prize distribution')).toBeInTheDocument();
    expect(screen.getByText('Halls')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Upload' })).toHaveLength(3);
  });

  it('sends the photograph to the folder whose button was pressed', async () => {
    api.getPhotos.mockResolvedValue(page({
      folders: [folder(), folder({ id: 'f2', name: 'Halls', is_default: false })],
    }) as any);
    api.uploadPhoto.mockResolvedValue(photo() as any);

    show(<PhotoUploads meetingRef="ABC123" tone="dark" />);

    await screen.findByText('Halls');
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload' })[1]);

    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], 'hall.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalled());
    expect(api.uploadPhoto.mock.calls[0][1]).toBe('f2');
  });

  it('is not shown at all to somebody with no photographs to add', async () => {
    // Looking at them belongs in the portal; in here the section is a
    // place to put them.
    api.getPhotos.mockResolvedValue(
      page({ is_a_photographer: false, can_upload: false, can_arrange: false }) as any
    );

    show(<PhotoUploads meetingRef="ABC123" tone="dark" />);

    await waitFor(() => expect(api.getPhotos).toHaveBeenCalled());
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
    expect(screen.queryByText('Photos')).not.toBeInTheDocument();
  });

  it('offers a new folder only to somebody who may arrange them', async () => {
    api.getPhotos.mockResolvedValue(page({ can_arrange: false }) as any);

    show(<PhotoUploads meetingRef="ABC123" tone="dark" />);

    await screen.findByText('Default');
    expect(screen.queryByRole('button', { name: '+ Folder' })).not.toBeInTheDocument();
  });

  it('will not upload before the meeting has finished, and says why', async () => {
    api.getPhotos.mockResolvedValue(
      page({ meeting_is_finished: false, can_upload: false }) as any
    );

    show(<PhotoUploads meetingRef="ABC123" tone="dark" />);

    expect(
      await screen.findByText(/once the meeting has finished/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });
});

describe('the photo section in a portal', () => {
  it('shows the folders as tiles with what is in them', async () => {
    api.getPhotos.mockResolvedValue(page({
      folders: [
        folder({ photo_count: 2 }),
        folder({ id: 'f2', name: 'Prize distribution', is_default: false, created_by: 'Sunita Budha' }),
      ],
      photos: [photo(), photo({ id: 'p2' })],
    }) as any);

    show(<PhotoAlbums meetingRef="ABC123" />);

    expect(await screen.findByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Prize distribution')).toBeInTheDocument();
    expect(screen.getByText(/2 photos/)).toBeInTheDocument();
    expect(screen.getByText(/Sunita Budha/)).toBeInTheDocument();
  });

  it('previews the photographs without anybody clicking one', async () => {
    // The whole ask: opening a folder shows what is inside.
    api.getPhotos.mockResolvedValue(page({
      photos: [photo({ caption: 'group.jpg' }), photo({ id: 'p2', caption: 'stage.jpg' })],
    }) as any);

    show(<PhotoAlbums meetingRef="ABC123" />);

    fireEvent.click(await screen.findByText('Default'));

    await waitFor(() => expect(api.getPhotoObjectUrl).toHaveBeenCalledWith('p1'));
    const shown = await screen.findAllByRole('img');
    expect(shown.length).toBeGreaterThanOrEqual(2);
    expect(shown[0]).toHaveAttribute('src', 'blob:photo');
  });

  it('fetches the file rather than linking to it, since it needs the sign-in', async () => {
    api.getPhotos.mockResolvedValue(page({ photos: [photo()] }) as any);

    show(<PhotoAlbums meetingRef="ABC123" />);
    fireEvent.click(await screen.findByText('Default'));

    const link = await screen.findByRole('link', { name: 'Download' });
    fireEvent.click(link);

    await waitFor(() => expect(api.getPhotoObjectUrl).toHaveBeenCalledWith('p1'));
  });

  it('lets a viewer look and download but not add', async () => {
    api.getPhotos.mockResolvedValue(page({
      is_a_photographer: false, can_upload: false, can_arrange: false,
      photos: [photo()],
    }) as any);

    show(<PhotoAlbums meetingRef="ABC123" />);
    fireEvent.click(await screen.findByText('Default'));

    expect(await screen.findByRole('link', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add photos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create folder' })).not.toBeInTheDocument();
  });

  it('keeps a guest out of the managing side of it', async () => {
    api.getPhotos.mockResolvedValue(page() as any);

    show(<PhotoAlbums meetingRef="ABC123" canManage={false} />);

    await screen.findByText('Default');
    expect(screen.queryByRole('button', { name: 'Create folder' })).not.toBeInTheDocument();
  });

  it('narrows to what this person took', async () => {
    api.getPhotos.mockResolvedValue(page({
      folders: [folder({ photo_count: 2 })],
      photos: [photo(), photo({ id: 'p2', caption: 'mine.jpg', is_mine: true })],
    }) as any);

    show(<PhotoAlbums meetingRef="ABC123" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mine' }));
    fireEvent.click(screen.getByText('Default'));

    expect(await screen.findByText('mine.jpg')).toBeInTheDocument();
    expect(screen.queryByText('group.jpg')).not.toBeInTheDocument();
  });

  it('can get back out of a folder', async () => {
    api.getPhotos.mockResolvedValue(page({ photos: [photo()] }) as any);

    show(<PhotoAlbums meetingRef="ABC123" />);
    fireEvent.click(await screen.findByText('Default'));
    fireEvent.click(await screen.findByRole('button', { name: 'All folders' }));

    expect(await screen.findByText('Default')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All folders' })).not.toBeInTheDocument();
  });
});

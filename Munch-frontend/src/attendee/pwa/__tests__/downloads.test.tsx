import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../../../organizer/i18n';
import { FilesScreen } from '../FilesScreen';
import { apiClient } from '../../../services/api';

/**
 * Taking a copy away.
 *
 * Both halves of this screen were look-but-don't-touch. A shared file
 * was linked to the host's own Drive copy, which nobody else in the
 * event has a place in; a photograph had no control at all. Both now
 * come back through this backend on the signed-in request.
 */
jest.mock('../../../services/api', () => ({
  apiClient: {
    getResources: jest.fn(),
    getPhotos: jest.fn(),
    getPhotoObjectUrl: jest.fn(),
    getPhotoBlob: jest.fn(),
    downloadResource: jest.fn(),
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

const event = { id: 'e1', code: 'ABC123', title: 'Opening day' } as any;
const session = {
  id: 's1', title: 'Haldi', starts_at: new Date().toISOString(),
} as any;

const file = {
  id: 'f1',
  event_id: 'e1',
  artifact_type: 'file',
  display_name: 'Budget.pdf',
  // As the listing really carries it: the host's own copy, in the
  // host's Drive. This is exactly the link that used to be followed.
  web_view_link: 'https://drive.google.com/file/d/x/view',
  file_size: 1024,
  sync_status: 'synced',
  created_at: new Date().toISOString(),
  session: 's1',
} as any;

const photo = {
  id: 'p1', folder_id: 'fold1', caption: 'Ribbon', created_at: '',
} as any;

let clicked: HTMLAnchorElement[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  clicked = [];
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  (URL as any).createObjectURL = jest.fn(() => 'blob:x');
  (URL as any).revokeObjectURL = jest.fn();
  // jsdom will not follow a download, so the anchor is caught instead.
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function (this: HTMLAnchorElement) { clicked.push(this); }
  );

  api.getResources.mockResolvedValue([file]);
  api.getPhotos.mockResolvedValue({
    folders: [{ id: 'fold1', name: 'Day one', photo_count: 1 }],
    photos: [photo],
  } as any);
  api.getPhotoObjectUrl.mockResolvedValue('blob:thumb');
  api.getPhotoBlob.mockResolvedValue(new Blob(['x']) as any);
  api.downloadResource.mockResolvedValue(new Blob(['y']) as any);
});

const show = (props: any = {}) =>
  render(
    <OrganizerProvider>
      <FilesScreen
        event={event}
        sessions={[session]}
        onFolderOpenChange={() => undefined}
        {...props}
      />
    </OrganizerProvider>
  );

describe('a signed-in attendee taking a file', () => {
  it('fetches the bytes from this backend, not from Drive', async () => {
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Download Budget.pdf' }));

    await waitFor(() => expect(api.downloadResource).toHaveBeenCalledWith('e1', 'f1'));
    await waitFor(() => expect(clicked.length).toBe(1));
    expect(clicked[0].download).toBe('Budget.pdf');
    // Not the host's Drive copy, which is the thing they cannot open.
    expect(clicked[0].href).not.toContain('drive.google.com');
  });

  it('offers it even when the listing carries no Drive link', async () => {
    api.getResources.mockResolvedValue([{ ...file, web_view_link: '' }]);
    show();

    expect(await screen.findByRole('button', { name: 'Download Budget.pdf' }))
      .toBeInTheDocument();
  });
});

describe('a guest taking a file', () => {
  it('follows their own pre-signed link, which carries their token', async () => {
    show({
      guestToken: 'tok',
      guestResources: [{
        id: 'f1',
        display_name: 'Budget.pdf',
        mime_type: 'application/pdf',
        file_size: 1024,
        created_at: new Date().toISOString(),
        uploaded_by: 'host@example.com',
        download_url: '/api/v1/events/guest/resources/f1/download/?token=tok',
      }],
    });

    const link = await screen.findByRole('link', { name: 'Download Budget.pdf' });
    expect(link).toHaveAttribute('href', expect.stringContaining('token=tok'));
    expect(link).toHaveAttribute('download', 'Budget.pdf');
    // A guest's request needs no header, so it never comes through here.
    expect(api.downloadResource).not.toHaveBeenCalled();
  });
});

describe('an attendee keeping a photograph', () => {
  it('saves the bytes it already had to fetch to show the tile', async () => {
    show();

    fireEvent.click(await screen.findByText('Photos'));
    fireEvent.click(await screen.findByText('Day one'));
    fireEvent.click(await screen.findByRole('button', { name: 'Download photo' }));

    await waitFor(() => expect(api.getPhotoBlob).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(clicked.length).toBe(1));
    expect(clicked[0].download).toBe('Ribbon.jpg');
  });
});

import toast from 'react-hot-toast';
import { openAsSheet } from '../sheets';
import { apiClient } from '../../services/api';
import { Pair } from '../i18n';

jest.mock('../../services/api', () => ({
  apiClient: { exportToSheet: jest.fn(), hasSession: jest.fn(() => false) },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    success: jest.fn(),
    loading: jest.fn(() => 'toast-1'),
    dismiss: jest.fn(),
  },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;
const t = (pair: Pair) => pair.en || pair.ne;

const ROWS = [['person', 'sessions'], ['Bishnu', 3]];
const SHEET = {
  id: 'sheet-1',
  name: 'Manch attendance',
  url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
};

/** A stand-in for the tab a click is allowed to open. */
const stubTab = (blocked = false) => {
  const tab = { location: { href: '' }, closed: false, close: jest.fn() };
  const open = jest.fn(() => (blocked ? null : tab));
  (window as any).open = open;
  return { tab, open };
};

beforeEach(() => jest.clearAllMocks());

describe('sending a report to Google Sheets', () => {
  it('opens the tab on the click and points it at the sheet after', async () => {
    // Opened first and aimed later: a window opened from an awaited
    // callback is blocked, which looks like a button that does nothing.
    const { tab, open } = stubTab();
    api.exportToSheet.mockResolvedValue(SHEET as any);

    const done = openAsSheet('attendance', ROWS, { t });
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.location.href).toBe('');

    await done;
    expect(tab.location.href).toBe(SHEET.url);
  });

  it('sends the rows that are on the screen', async () => {
    stubTab();
    api.exportToSheet.mockResolvedValue(SHEET as any);

    await openAsSheet('attendance', ROWS, { subject: 'Wedding day', t });

    expect(api.exportToSheet).toHaveBeenCalledWith('attendance', ROWS, 'Wedding day');
  });

  it('hands over the link when the tab was blocked', async () => {
    const { open } = stubTab(true);
    api.exportToSheet.mockResolvedValue(SHEET as any);

    await openAsSheet('report', ROWS, { t });

    expect(open).toHaveBeenLastCalledWith(SHEET.url, '_blank', 'noopener');
  });

  it('does not ask for a sheet of nothing but headings', async () => {
    const { open } = stubTab();

    await openAsSheet('attendance', [['person', 'sessions']], { t });

    expect(api.exportToSheet).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('closes the empty tab when the export fails', async () => {
    const { tab } = stubTab();
    api.exportToSheet.mockRejectedValue({
      response: { data: { error: 'Google would not create the sheet' } },
    });

    await openAsSheet('report', ROWS, { t });

    expect(tab.close).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Google would not create the sheet');
  });

  it('says what to do about a missing Google connection', async () => {
    stubTab();
    api.exportToSheet.mockRejectedValue({
      response: {
        data: {
          code: 'google_not_connected',
          error: 'Sign in with Google to export to Sheets.',
        },
      },
    });

    await openAsSheet('attendance', ROWS, { t });

    expect(toast.error).toHaveBeenCalledWith(
      'Sign in with Google to export to Sheets.',
      expect.anything()
    );
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportProgramme } from '../ImportProgramme';
import { OrganizerProvider } from '../i18n';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: {
    downloadProgrammeTemplate: jest.fn(),
    importProgrammeSheet: jest.fn(),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn(),
  }),
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
  api.downloadProgrammeTemplate.mockResolvedValue(new Blob(['x']) as any);
  (URL as any).createObjectURL = jest.fn(() => 'blob:template');
  (URL as any).revokeObjectURL = jest.fn();
  // jsdom will not navigate, so the anchor's click is stubbed rather than
  // followed - what matters here is which file was asked for.
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

const show = () =>
  render(
    <OrganizerProvider>
      <ImportProgramme onImported={jest.fn()} />
    </OrganizerProvider>
  );

/**
 * The template is three tables joined by id, and comes in two shapes.
 *
 * The CSV opens anywhere. The workbook carries the one thing a CSV cannot:
 * the sessions table picking its event and event from the ids typed
 * above, rather than having them typed again.
 */
describe('the programme template', () => {
  it('is offered as a workbook and as a CSV', async () => {
    show();

    expect(screen.getByRole('button', { name: 'Excel template' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV template' })).toBeInTheDocument();
  });

  it('asks for the workbook when that is the one pressed', async () => {
    show();

    fireEvent.click(screen.getByRole('button', { name: 'Excel template' }));

    await waitFor(() =>
      expect(api.downloadProgrammeTemplate).toHaveBeenCalledWith('xlsx')
    );
  });

  it('asks for the CSV when that is the one pressed', async () => {
    show();

    fireEvent.click(screen.getByRole('button', { name: 'CSV template' }));

    await waitFor(() =>
      expect(api.downloadProgrammeTemplate).toHaveBeenCalledWith('csv')
    );
  });

  it('says the sheet is three tables joined by id', () => {
    show();

    expect(screen.getByText(/three tables/)).toBeInTheDocument();
    expect(screen.getByText(/joined by id/)).toBeInTheDocument();
  });

  it('takes a filled-in workbook back without a detour through Save As', async () => {
    api.importProgrammeSheet.mockResolvedValue({ programmes: [] } as any);
    const { container } = show();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain('.xlsx');

    const file = new File(['PK'], 'plan.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(api.importProgrammeSheet).toHaveBeenCalledWith(file, true)
    );
  });
});

/**
 * What the preview shows has to be what the sheet says.
 *
 * The preview printed clock times only, so a session dated a fortnight
 * after its event - a date left over from the example, usually - read as
 * simply the next talk that afternoon. The one thing that would have shown
 * the mistake was the one thing left out.
 */
describe('the day the preview shows', () => {
  const programme = (sessionStart: string) => ([{
    title: 'National Addressing Concept',
    event_date: '2026-09-14',
    venue: 'National Assembly Hall',
    scheduled_start: '2026-09-14T15:00:00+05:45',
    sessions: [
      { title: 'Kataho', starts_at: '2026-09-14T15:00:00+05:45',
        speaker_name: 'Dr Sumin Maharjan', hall: 'Hall A' },
      { title: 'Digipin', starts_at: sessionStart,
        speaker_name: 'Dr Darpan Pandey', hall: 'Hall A' },
    ],
  }]);

  const preview = async (sessionStart: string) => {
    api.importProgrammeSheet.mockResolvedValue(
      { programmes: programme(sessionStart) } as any
    );
    const { container } = show();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'plan.csv', { type: 'text/csv' })] },
    });
    await screen.findByText(/Kataho/);
  };

  it('names the day when a session falls on another one', async () => {
    await preview('2026-10-02T15:15:00+05:45');

    // The sheet said 2 October; the preview used to say only "09:00 PM".
    // Which way round the day and the month read is the reader's locale.
    expect(screen.getByText(/Digipin/).textContent).toMatch(/Oct/);
  });

  it("leaves the day out when everything is on the event's own day", async () => {
    await preview('2026-09-14T15:15:00+05:45');

    expect(screen.getByText(/Digipin/).textContent).not.toMatch(/Sep/);
  });
});

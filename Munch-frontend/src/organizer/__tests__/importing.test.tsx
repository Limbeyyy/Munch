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
 * the sessions table picking its event and meeting from the ids typed
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

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizerProvider } from '../../organizer/i18n';
import { ConclusionsView } from '../views/ConclusionsView';
import { apiClient } from '../../services/api';

jest.mock('../../services/api', () => ({
  apiClient: { getConclusions: jest.fn(), hasSession: jest.fn(() => false) },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));

const api = apiClient as jest.Mocked<typeof apiClient>;

const entry = (over: any = {}) => ({
  session_id: 's1',
  session_title: 'Health service delivery in federalism',
  session_starts_at: '2026-10-02T09:00:00Z',
  speaker_name: 'Dr Sarita Poudel',
  hall: 'Hall A',
  meeting_id: 'm1',
  meeting_title: 'Opening day',
  event_id: 'e1',
  event_title: 'Health Conference',
  findings: ['Conditional grant released', 'Joint committee formed'],
  actions: [
    { task: 'Orient the district team on form 9.3', owner: 'Sunita Budha', due: 'Asoj 9' },
  ],
  published_at: '2026-10-02T11:00:00Z',
  ...over,
});

const show = () =>
  render(
    <OrganizerProvider>
      <ConclusionsView myName="Sunita Budha" myEmail="sunita@example.org" />
    </OrganizerProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(
    'manch.organizer.prefs', JSON.stringify({ lang: 'en', a11y: {} })
  );
});

describe('the conclusions page', () => {
  it('shows what each session settled', async () => {
    api.getConclusions.mockResolvedValue({ conclusions: [entry()], mine: [] } as any);

    show();

    expect(
      await screen.findByText('Health service delivery in federalism')
    ).toBeInTheDocument();
    expect(screen.getByText('Conditional grant released')).toBeInTheDocument();
    expect(screen.getByText('Joint committee formed')).toBeInTheDocument();
  });

  it('says who owes what, and by when', async () => {
    api.getConclusions.mockResolvedValue({ conclusions: [entry()], mine: [] } as any);

    show();

    expect(
      await screen.findByText('Orient the district team on form 9.3')
    ).toBeInTheDocument();
    expect(screen.getByText('Sunita Budha')).toBeInTheDocument();
    expect(screen.getByText('Asoj 9')).toBeInTheDocument();
  });

  it("pulls the reader's own lines to the top", async () => {
    api.getConclusions.mockResolvedValue({
      conclusions: [entry()],
      mine: [{
        task: 'Orient the district team on form 9.3', owner: 'Sunita Budha',
        due: 'Asoj 9', session_title: 'Health service delivery in federalism',
      }],
    } as any);

    show();

    expect(await screen.findByText('Against your name')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Send my action list \(1\)/ })
    ).toBeEnabled();
  });

  it('offers nothing to send when nothing is owed', async () => {
    api.getConclusions.mockResolvedValue({ conclusions: [entry()], mine: [] } as any);

    show();

    await screen.findByText('Conditional grant released');
    expect(
      screen.getByRole('button', { name: /Send my action list/ })
    ).toBeDisabled();
  });

  it('says plainly that nothing is published yet', async () => {
    api.getConclusions.mockResolvedValue({ conclusions: [], mine: [] } as any);

    show();

    expect(await screen.findByText(/Nothing published yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save all conclusions/ })).toBeDisabled();
  });

  it('makes a PDF by printing, which every browser can do', async () => {
    api.getConclusions.mockResolvedValue({ conclusions: [entry()], mine: [] } as any);
    const print = jest.fn();
    (window as any).print = print;

    show();
    fireEvent.click(await screen.findByRole('button', { name: /Save all conclusions/ }));

    expect(print).toHaveBeenCalled();
  });

  it('hands the action list to the mail client, since we cannot send it', async () => {
    api.getConclusions.mockResolvedValue({
      conclusions: [entry()],
      mine: [{ task: 'Orient the district team', owner: 'Sunita', due: 'Asoj 9' }],
    } as any);
    // jsdom will not navigate, so the assignment is what is watched.
    const setHref = jest.fn();
    delete (window as any).location;
    (window as any).location = { set href(value: string) { setHref(value); } };

    show();
    fireEvent.click(await screen.findByRole('button', { name: /Send my action list/ }));

    await waitFor(() => expect(setHref).toHaveBeenCalled());
    const url = setHref.mock.calls[0][0] as string;
    expect(url.startsWith('mailto:')).toBe(true);
    expect(decodeURIComponent(url)).toContain('Orient the district team');
  });

  it('says which session and speaker a finding came from', async () => {
    api.getConclusions.mockResolvedValue({ conclusions: [entry()], mine: [] } as any);

    show();

    expect(await screen.findByText(/Opening day/)).toBeInTheDocument();
    expect(screen.getByText(/Dr Sarita Poudel/)).toBeInTheDocument();
  });
});

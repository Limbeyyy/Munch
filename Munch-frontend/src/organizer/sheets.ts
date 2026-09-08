import toast from 'react-hot-toast';
import { apiClient } from '../services/api';
import { Pair } from './i18n';

type Kind = 'attendance' | 'report' | 'analytics';

/**
 * Send a table to the reader's own Google Sheets and open it.
 *
 * The tab is opened on the click itself and pointed at the sheet once the
 * link arrives: a browser blocks a window opened from an awaited callback,
 * which would leave the export looking like a button that does nothing.
 */
export const openAsSheet = async (
  kind: Kind,
  rows: (string | number)[][],
  { subject = '', t }: { subject?: string; t: (p: Pair) => string }
): Promise<void> => {
  if (rows.length <= 1) {
    toast.error(t({ ne: 'निकाल्न कुनै पङ्क्ति छैन', en: 'There is nothing to export' }));
    return;
  }

  const tab = window.open('', '_blank');
  const waiting = toast.loading(
    t({ ne: 'गुगल शीट बनाउँदै…', en: 'Creating the Google Sheet…' })
  );

  try {
    const sheet = await apiClient.exportToSheet(kind, rows, subject);
    toast.dismiss(waiting);

    if (tab && !tab.closed) {
      tab.location.href = sheet.url;
    } else {
      // The tab was blocked or closed, so hand over the link instead of
      // dropping a sheet that has already been created.
      window.open(sheet.url, '_blank', 'noopener');
    }
    toast.success(t({ ne: 'गुगल शीटमा गयो', en: 'Opened in Google Sheets' }));
  } catch (error: any) {
    toast.dismiss(waiting);
    if (tab && !tab.closed) tab.close();

    const refusal = error?.response?.data;
    if (refusal?.code === 'google_not_connected' || refusal?.code === 'google_reauth_needed') {
      toast.error(
        t({
          ne: 'गुगल शीटमा पठाउन गुगलबाट साइन इन गर्नुपर्छ।',
          en: refusal.error || 'Sign in with Google to export to Sheets.',
        }),
        { duration: 8000 }
      );
      return;
    }
    toast.error(
      refusal?.error ||
        t({ ne: 'शीट बनाउन सकिएन', en: 'Could not create the sheet' })
    );
  }
};

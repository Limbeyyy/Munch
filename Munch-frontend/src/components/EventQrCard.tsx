import React from 'react';
import toast from 'react-hot-toast';
import { FigmaIcon } from '../assets/icons';
import { useOrganizer } from '../organizer/i18n';

const API_ROOT = process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1';

interface Props {
  eventName: string;
  eventCode: string;
}

export const EventQrCard: React.FC<Props> = ({ eventName, eventCode }) => {
  const { t } = useOrganizer();
  const guestLink = `${window.location.origin}/login?join=${eventCode}`;
  const qrSrc = `${API_ROOT}/events/${eventCode}/qr/?url=${encodeURIComponent(guestLink)}`;

  const qrFile = async () => {
    const response = await fetch(qrSrc);
    if (!response.ok) throw new Error('QR image unavailable');
    return new File([await response.blob()], `${eventCode}-qr.png`, { type: 'image/png' });
  };

  const shareQr = async () => {
    try {
      const file = await qrFile();
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: eventName, files: [file] });
        return;
      }
      window.open(qrSrc, '_blank', 'noopener');
    } catch {
      toast.error(t({ ne: 'QR साझा गर्न सकिएन', en: 'Could not share the QR image' }));
    }
  };

  const copyQr = async () => {
    try {
      const file = await qrFile();
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(qrSrc);
          toast.success(t({ ne: 'QR को लिंक प्रतिलिपि भयो', en: 'QR link copied' }));
        } else {
          window.open(qrSrc, '_blank', 'noopener');
          toast(t({ ne: 'QR नयाँ ट्याबमा खोलियो', en: 'QR opened in a new tab' }));
        }
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]);
      toast.success(t({ ne: 'QR प्रतिलिपि भयो', en: 'QR image copied' }));
    } catch {
      try {
        await navigator.clipboard.writeText(qrSrc);
        toast.success(t({ ne: 'QR को लिंक प्रतिलिपि भयो', en: 'QR link copied' }));
      } catch {
        window.open(qrSrc, '_blank', 'noopener');
        toast(t({ ne: 'QR नयाँ ट्याबमा खोलियो', en: 'QR opened in a new tab' }));
      }
    }
  };

  return (
    <aside className="event-qr-card bg-white border border-line rounded-[12px] p-5">
      <h2 className="text-[12px] font-medium tracking-[.06em] uppercase text-subtle mb-2">
        {t({ ne: 'QR बाट निम्तो', en: 'Invite with QR' })}
      </h2>
      <p className="text-[15px] font-medium text-head truncate" title={eventName}>{eventName}</p>
      <div className="mt-4 flex justify-center rounded-[10px] bg-[#f9fafb] border border-line p-3">
        <img
          src={qrSrc}
          alt={t({ ne: `${eventName} को QR`, en: `QR code for ${eventName}` })}
          width={190}
          height={190}
          className="event-qr-image object-contain"
        />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={shareQr}
          className="flex-1 bg-navy-800 hover:bg-navy-700 text-white rounded-[8px] px-3 py-2 text-[13px] font-medium flex items-center justify-center gap-1.5"
        >
          <FigmaIcon name="shareNodes" size={15} />
          {t({ ne: 'QR साझा', en: 'Share QR' })}
        </button>
        <button
          onClick={copyQr}
          className="border border-line bg-[#f9fafb] hover:border-navy-800 text-body rounded-[8px] px-3 py-2 text-[13px] font-medium flex items-center justify-center gap-1.5"
        >
          <FigmaIcon name="copy" size={15} />
          {t({ ne: 'प्रतिलिपि', en: 'Copy' })}
        </button>
      </div>
    </aside>
  );
};
import React, { useState } from 'react';
import { apiClient } from '../services/api';
import toast from 'react-hot-toast';
import { FigmaIcon } from '../assets/icons';

const API_ROOT = process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1';

interface Props {
  meetingId: string;
  meetingCode: string;
  onClose: () => void;
  onInvited?: (totalInvited: number) => void;
}

const splitEmails = (raw: string): string[] =>
  raw
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shares the meeting link and records who it went to.
 *
 * The recorded addresses are what the attendance report treats as the
 * expected headcount, so sharing and counting are the same action.
 */
export const ShareMeetingDialog: React.FC<Props> = ({
  meetingId,
  meetingCode,
  onClose,
  onInvited,
}) => {
  const [raw, setRaw] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Anyone with an account opens the room directly; a guest scanning the
  // QR is sent to the join form instead, since they have no account.
  const link = `${window.location.origin}/meeting/${meetingCode}`;
  const guestLink = `${window.location.origin}/login?join=${meetingCode}`;
  const qrSrc =
    `${API_ROOT}/meetings/${meetingCode}/qr/?url=${encodeURIComponent(guestLink)}`;
  const parsed = splitEmails(raw);
  const invalid = parsed.filter((e) => !EMAIL_RE.test(e));
  const valid = parsed.filter((e) => EMAIL_RE.test(e));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy - select and copy the link manually');
    }
  };

  const send = async () => {
    if (valid.length === 0) {
      toast.error('Add at least one email address');
      return;
    }
    if (invalid.length > 0) {
      toast.error(`Not a valid address: ${invalid[0]}`);
      return;
    }

    try {
      setIsSending(true);
      const result = await apiClient.addMeetingInvites(meetingId, valid);
      const added = result.added.length;
      const dupes = result.already_invited.length;

      toast.success(
        added > 0
          ? `${added} invited${dupes ? `, ${dupes} already on the list` : ''}`
          : 'Everyone was already invited'
      );
      onInvited?.(result.total_invited);
      setRaw('');

      // Hand off to the user's mail client with the link prefilled.
      const subject = encodeURIComponent('Meeting invitation');
      const body = encodeURIComponent(
        `Join the meeting:\n\n${link}\n\nMeeting code: ${meetingCode}`
      );
      window.open(
        `mailto:${valid.join(',')}?subject=${subject}&body=${body}`,
        '_blank'
      );
    } catch (error: any) {
      toast.error(error.response?.data?.error ?? 'Could not record invitations');
    } finally {
      setIsSending(false);
    }
  };

  /**
   * Hand the QR to whatever the device shares with, or open it.
   *
   * Nothing here can send a file, so this offers the image the platform
   * already has rather than pretending to deliver it somewhere.
   */
  const shareQr = async () => {
    const url = qrSrc;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join the meeting', text: guestLink, url: guestLink });
        return;
      } catch {
        // Cancelled, or unsupported for this payload: fall through.
      }
    }
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manch-share-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-[#e3e8ef] rounded-[12px] shadow-2xl w-full max-w-[652px]
          max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="bg-[#fcfcfc] flex items-start justify-between gap-2 py-3 px-5 rounded-t-[12px]">
          <div className="py-2 min-w-0">
            <h2
              id="manch-share-title"
              className="text-[24px] font-bold tracking-[-0.12px] text-black leading-[1.4]"
            >
              Share this meeting
            </h2>
            <p className="text-[16px] tracking-[-0.08px] text-black leading-[1.4]">
              Everyone you share with is counted as expected to attend
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[#9ea8b7] hover:text-navy-800 text-[26px] leading-none px-2 pt-1 flex-none"
          >
            &#10005;
          </button>
        </div>

        <div className="px-[23px] py-[13px] flex flex-col gap-3">
          {/* Meeting link */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="manch-share-link"
              className="text-[20px] font-medium tracking-[-0.1px] text-black leading-[1.4]"
            >
              Meeting Link
            </label>
            <div className="flex gap-[14px] items-center flex-wrap">
              <input
                id="manch-share-link"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-[220px] bg-[#f9fafb] border border-[#e5e7eb] rounded-[12px]
                  px-[14px] py-3 text-[16px] leading-6 text-[#101010]"
              />
              <button
                onClick={copyLink}
                className="bg-navy-800 hover:bg-navy-700 text-white rounded-[12px] px-5 py-3
                  flex items-center justify-center gap-1.5 text-[16px] font-medium leading-6"
              >
                <FigmaIcon name="copy" size={16} />
                Copy
              </button>
            </div>
          </div>

          {/* QR code, for the door */}
          <div className="flex flex-col gap-2">
            <p className="text-[20px] font-medium tracking-[-0.1px] text-black leading-[1.4]">
              QR Code
            </p>
            <div className="flex gap-2 items-center flex-wrap">
              <img
                src={qrSrc}
                alt={`QR code to join meeting ${meetingCode}`}
                width={167}
                height={148}
                style={{ width: 167, height: 148 }}
                className="object-contain"
              />
              <button
                onClick={shareQr}
                className="bg-navy-800 hover:bg-navy-700 text-white rounded-[12px] px-5 py-3
                  flex items-center justify-center gap-1.5 text-[16px] font-medium leading-6"
              >
                <FigmaIcon name="shareNodes" size={16} />
                Share QR
              </button>
            </div>
            <p className="text-[13px] text-[#656565]">
              Scanning opens the join form. Guests still wait for you to let them in.
            </p>
          </div>

          {/* Who it is going to */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="manch-share-emails"
              className="text-[20px] font-medium tracking-[-0.1px] text-black leading-[1.4]"
            >
              Send to email address
            </label>
            <textarea
              id="manch-share-emails"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="alice@gmail.com, bob@gmail.com"
              className="w-full h-[90px] bg-[#f9fafb] border border-[#e5e7eb] rounded-[12px]
                px-4 py-[14px] text-[16px] leading-6 text-[#101010] resize-none
                focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
            <p className="text-[16px] leading-6 min-h-[24px]">
              {invalid.length > 0 ? (
                <span className="text-live">Not valid: {invalid.join(', ')}</span>
              ) : valid.length > 0 ? (
                <span className="text-[#101010]">
                  {valid.length} recipient{valid.length === 1 ? '' : 's'} will be counted as
                  expected
                </span>
              ) : (
                <span className="text-[#656565]">
                  Separate addresses with commas or spaces
                </span>
              )}
            </p>
          </div>
        </div>

        {/* The one action this dialog is for */}
        <div className="px-[59px] pb-6 pt-1">
          <button
            onClick={send}
            disabled={isSending || valid.length === 0}
            className="w-full bg-navy-800 hover:bg-navy-700 text-white rounded-[12px] px-5 py-3
              flex items-center justify-center gap-1.5 text-[16px] font-medium leading-6
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FigmaIcon name="shareNodes" size={16} />
            {isSending ? 'Recording…' : 'Share and count as invited'}
          </button>
          <p className="text-[13px] text-[#656565] text-center mt-2.5">
            Guests who join by code instead are recorded when you admit them.
          </p>
        </div>
      </div>
    </div>
  );
};

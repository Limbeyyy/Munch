import React, { useState } from 'react';
import { apiClient } from '../services/api';
import toast from 'react-hot-toast';

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

  const link = `${window.location.origin}/meeting/${meetingCode}`;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white text-gray-800 rounded-lg shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">Share this meeting</h2>
            <p className="text-sm text-gray-600">
              Everyone you share with is counted as expected to attend.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700 px-2"
          >
            &#10005;
          </button>
        </div>

        <label className="block text-sm font-medium mb-1">Meeting link</label>
        <div className="flex gap-2 mb-5">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
          />
          <button
            onClick={copyLink}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-semibold"
          >
            Copy
          </button>
        </div>

        <label className="block text-sm font-medium mb-1">
          Send to email addresses
        </label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={3}
          placeholder="alice@gmail.com, bob@gmail.com"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="min-h-[1.5rem] mt-1 mb-4 text-xs">
          {invalid.length > 0 ? (
            <span className="text-red-600">
              Not valid: {invalid.join(', ')}
            </span>
          ) : valid.length > 0 ? (
            <span className="text-gray-600">
              {valid.length} recipient{valid.length === 1 ? '' : 's'} will be
              counted as expected
            </span>
          ) : (
            <span className="text-gray-400">
              Separate addresses with commas or spaces
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={send}
            disabled={isSending || valid.length === 0}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold disabled:opacity-50"
          >
            {isSending ? 'Recording...' : 'Share & count as invited'}
          </button>
          <button
            onClick={onClose}
            className="px-5 border border-gray-300 hover:bg-gray-50 rounded-lg font-semibold"
          >
            Done
          </button>
        </div>

        <p className="text-xs text-gray-500 mt-3">
          Guests who join by code instead are recorded when you admit them.
        </p>
      </div>
    </div>
  );
};

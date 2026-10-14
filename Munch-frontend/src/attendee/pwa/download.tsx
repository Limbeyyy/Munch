import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient } from '../../services/api';
import { useOrganizer } from '../../organizer/i18n';
import downloadIcon from './icons/download.svg';

/**
 * Taking a copy away.
 *
 * Both halves of this screen used to be look-but-don't-touch, for two
 * different reasons.
 *
 * A shared file was linked straight to Drive's own ``web_view_link``.
 * That is the host's copy in the host's Drive, so the host could open it
 * and everybody else reached Google's "request access" page - and where
 * the listing carried no link at all, which it often does, there was no
 * button to press in the first place.
 *
 * A photograph had no control at all. The tiles are fetched as blobs
 * already, because an <img src> carries no Authorization header and the
 * endpoint wants one; nothing then offered those bytes to the reader.
 *
 * So both come through this backend, on the signed-in request, and are
 * saved from memory. A guest holds a token rather than a session, and
 * their link already carries it in the query string, so theirs stays an
 * ordinary link - there is no header to be missing.
 */

/** Hand the browser some bytes to save under a name. */
export const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next turn rather than at once: Safari has not
  // finished reading the URL by the time click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

/** What the button says while it is working, and what it does. */
export const useSaving = () => {
  const { t } = useOrganizer();
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (id: string, name: string, bytes: () => Promise<Blob>) => {
    if (busy) return;
    setBusy(id);
    try {
      saveBlob(await bytes(), name);
    } catch {
      toast.error(t({
        ne: 'यो फाइल ल्याउन सकिएन।',
        en: 'Could not fetch this file.',
      }));
    } finally {
      setBusy(null);
    }
  };

  return { busy, save };
};

/** The round grey button the design puts at the end of a file's row. */
export const SaveButton: React.FC<{
  label: string;
  busy?: boolean;
  onClick: () => void;
}> = ({ label, busy, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    aria-label={label}
    className="bg-[#efefef] rounded-[12px] p-2 flex-none grid place-items-center
      disabled:opacity-50"
  >
    <img src={downloadIcon} alt="" width="18" height="18" />
  </button>
);

/**
 * One file's row-end control.
 *
 * A guest gets a link, because their URL carries their token and a link
 * is the one thing that cannot go wrong. Everybody else gets a button,
 * because their request needs a header only the client can add.
 */
export const FileSave: React.FC<{
  eventId: string;
  fileId: string;
  name: string;
  /** A guest's own pre-signed link, where there is one. */
  guestLink?: string;
  busy?: boolean;
  onSave: () => void;
}> = ({ name, guestLink, busy, onSave }) => {
  const { t } = useOrganizer();
  const label = t({ ne: `${name} डाउनलोड गर्नुहोस्`, en: `Download ${name}` });

  if (guestLink) {
    return (
      <a
        href={guestLink}
        download={name}
        aria-label={label}
        className="bg-[#efefef] rounded-[12px] p-2 flex-none grid place-items-center"
      >
        <img src={downloadIcon} alt="" width="18" height="18" />
      </a>
    );
  }
  return <SaveButton label={label} busy={busy} onClick={onSave} />;
};

/** Fetch a shared file's bytes, signed in. */
export const resourceBytes = (eventId: string, fileId: string) =>
  apiClient.downloadResource(eventId, fileId);

/** Fetch a photograph's bytes. */
export const photoBytes = (photoId: string) => apiClient.getPhotoBlob(photoId);

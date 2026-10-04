const DEVICE_KEY = 'manch.guest.device_id';

/** A browser-held random credential; this does not inspect hardware. */
export const getGuestDeviceId = (): string | undefined => {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;

    const bytes = window.crypto.getRandomValues(new Uint8Array(24));
    const created = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    window.localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return undefined;
  }
};

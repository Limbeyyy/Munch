/**
 * Which address Google is told to send somebody back to.
 *
 * It used to be whatever the browser happened to be using, which is
 * right on a laptop at localhost and wrong on a phone: opening the app
 * across the office wi-fi makes the origin something like
 * http://192.168.10.130:3001, and Google refuses a private IP as a
 * redirect for a web client. The person gets "Access blocked:
 * Authorization Error" on Google's own page, which says nothing about
 * what to do.
 *
 * So two things. The origin can be pinned to one Google has been told
 * about, whatever address the device reached the app on; and where it
 * cannot be, we say so here rather than sending somebody to Google to
 * be turned away.
 */

/** Set this to the origin registered in the Google console. */
const PINNED = (process.env.REACT_APP_OAUTH_ORIGIN || '').trim().replace(/\/+$/, '');

export const oauthOrigin = (): string => PINNED || window.location.origin;

export const googleRedirectUri = (): string => `${oauthOrigin()}/login`;

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1'];

/** An address written as numbers rather than a name. */
const isIpLiteral = (host: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');

/**
 * Why Google will turn this origin away, if it will.
 *
 * Null when it is fine. Google accepts loopback and real hostnames; a
 * bare IP address is refused, and a private one is refused with the
 * device_id message that started this.
 */
export const whyGoogleWillRefuse = (origin: string): string | null => {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return `“${origin}” is not an address Google can send anybody back to.`;
  }

  if (LOOPBACK.includes(host)) return null;
  if (!isIpLiteral(host)) return null;

  return (
    `Google will not sign anybody in to ${origin}, because it is an IP `
    + 'address rather than a name. Reach this page on localhost, or give '
    + 'the app a hostname Google has been told about and set '
    + 'REACT_APP_OAUTH_ORIGIN to it.'
  );
};

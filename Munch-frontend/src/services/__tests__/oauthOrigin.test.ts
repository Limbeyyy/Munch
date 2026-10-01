/**
 * Which address Google is told to send somebody back to.
 *
 * Opening the app on a phone across the office wi-fi made the origin a
 * private IP, which Google refuses for a web client - and the person
 * found that out on Google's own error page.
 */
const load = () => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  return require('../oauthOrigin');
};

const at = (href: string) => {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, href, origin: url.origin, hostname: url.hostname },
  });
};

const was = process.env.REACT_APP_OAUTH_ORIGIN;

afterEach(() => {
  if (was === undefined) delete process.env.REACT_APP_OAUTH_ORIGIN;
  else process.env.REACT_APP_OAUTH_ORIGIN = was;
});

describe('the origin Google is given', () => {
  it('is the one the browser is on, by default', () => {
    delete process.env.REACT_APP_OAUTH_ORIGIN;
    at('http://localhost:3000/login');

    expect(load().oauthOrigin()).toBe('http://localhost:3000');
  });

  /** So a phone reaching the app by IP still comes back somewhere real. */
  it('is the pinned one where there is one', () => {
    process.env.REACT_APP_OAUTH_ORIGIN = 'https://manch.example.com';
    at('http://192.168.10.130:3001/login');

    expect(load().oauthOrigin()).toBe('https://manch.example.com');
  });

  it('does not double the slash before /login', () => {
    process.env.REACT_APP_OAUTH_ORIGIN = 'https://manch.example.com/';
    at('http://localhost:3000/login');

    expect(load().googleRedirectUri()).toBe('https://manch.example.com/login');
  });
});

describe('saying so before Google does', () => {
  const why = (origin: string) => load().whyGoogleWillRefuse(origin);

  it('passes localhost, which Google allows', () => {
    expect(why('http://localhost:3000')).toBeNull();
    expect(why('http://127.0.0.1:3000')).toBeNull();
  });

  it('passes a real hostname', () => {
    expect(why('https://manch.example.com')).toBeNull();
  });

  /** The error in the screenshot, caught before anybody leaves. */
  it('turns back the private IP a phone on the wi-fi would use', () => {
    const said = why('http://192.168.10.130:3001');

    expect(said).toContain('192.168.10.130');
    expect(said).toContain('REACT_APP_OAUTH_ORIGIN');
  });

  it('turns back any bare IP, not only the private ranges', () => {
    expect(why('http://10.0.0.5:3001')).not.toBeNull();
    expect(why('http://203.0.113.9')).not.toBeNull();
  });

  it('turns back something that is not an address at all', () => {
    expect(why('not-a-url')).not.toBeNull();
  });
});

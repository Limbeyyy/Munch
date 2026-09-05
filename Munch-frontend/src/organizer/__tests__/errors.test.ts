import { errorText, isQuotaError } from '../errors';

const rejected = (data: any) => ({ response: { data } });

describe('errorText', () => {
  it('reads a plan ceiling as the sentence the server wrote', () => {
    const e = rejected({
      detail: 'The Free plan covers 2 events, and you have 2.',
      code: 'quota_reached',
      plan: 'free',
      upgrade: '/pricing',
    });
    expect(isQuotaError(e)).toBe(true);
    expect(errorText(e, 'fallback')).toBe('The Free plan covers 2 events, and you have 2.');
  });

  it('prefers a plain error message', () => {
    expect(errorText(rejected({ error: 'Only the host can do that' }), 'fallback'))
      .toBe('Only the host can do that');
  });

  it('flattens validation errors buried inside meetings and sessions', () => {
    const e = rejected({ meetings: [{ sessions: [{ speaker_email: ['Enter a valid email address.'] }] }] });
    expect(errorText(e, 'fallback')).toBe('Enter a valid email address.');
  });

  it('falls back when there is nothing to read', () => {
    expect(errorText(rejected(null), 'fallback')).toBe('fallback');
    expect(errorText(rejected('gateway timeout'), 'fallback')).toBe('fallback');
    expect(errorText({}, 'fallback')).toBe('fallback');
    expect(errorText(rejected({}), 'fallback')).toBe('fallback');
  });
});

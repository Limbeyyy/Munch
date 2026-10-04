import { getApiBaseUrl } from '../apiConfig';

describe('API base URL', () => {
  it('uses the current browser host when no API override is configured', () => {
    expect(
      getApiBaseUrl({ protocol: 'http:', hostname: '192.168.1.8' }, '')
    ).toBe('http://192.168.1.8:8000/api/v1');
  });

  it('keeps an explicitly configured API URL', () => {
    expect(
      getApiBaseUrl(
        { protocol: 'http:', hostname: '192.168.1.8' },
        'https://api.example.com/api/v1'
      )
    ).toBe('https://api.example.com/api/v1');
  });

  it('uses localhost when there is no browser location', () => {
    expect(getApiBaseUrl(undefined, '')).toBe('http://localhost:8000/api/v1');
  });
});

export const getApiBaseUrl = (
  location: Pick<Location, 'protocol' | 'hostname'> | undefined =
    typeof window === 'undefined' ? undefined : window.location,
  configuredUrl = process.env.REACT_APP_API_URL,
): string => {
  if (configuredUrl) return configuredUrl;
  if (!location?.hostname) return 'http://localhost:8000/api/v1';

  return `${location.protocol}//${location.hostname}:8000/api/v1`;
};

export const API_BASE_URL = getApiBaseUrl();

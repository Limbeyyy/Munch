/**
 * Turning a rejected request into a line a person can act on.
 *
 * A plan ceiling is not a validation failure, and it should not read like
 * one: the server sends a written sentence and a link to the pricing page,
 * and that sentence is what the organizer needs to see.
 */

export const isQuotaError = (e: any): boolean =>
  e?.response?.data?.code === 'quota_reached';

const strings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
};

export const errorText = (e: any, fallback: string): string => {
  const data = e?.response?.data;
  if (!data || typeof data !== 'object') return fallback;
  if (isQuotaError(e)) return String(data.detail);
  if (typeof data.error === 'string') return data.error;
  const found = strings(data);
  return found.length ? found.join(' ') : fallback;
};

import { apiClient } from '../services/api';
import { Event } from '../types';

/** Stop a second host-owned live room before asking the server to start one. */
export const ensureSingleLiveEvent = async (
  targetEventId: string,
  hostId: string
): Promise<void> => {
  const active = await apiClient.getActiveEvents();
  const other: Event | undefined = active.find(
    (event) => event.id !== targetEventId
      && String(event.host?.id ?? '') === String(hostId)
  );
  if (other) {
    throw new Error(
      `You are already hosting "${other.title}". End it before starting another event.`
    );
  }
};

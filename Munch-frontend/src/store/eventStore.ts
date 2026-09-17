import { create } from 'zustand';
import { Event, EventParticipant, TranscriptionSegment } from '../types';
import { apiClient } from '../services/api';

interface EventState {
  currentEvent: Event | null;
  participants: EventParticipant[];
  transcript: TranscriptionSegment[];
  isLoading: boolean;
  error: string | null;

  // Actions
  setCurrentEvent: (event: Event | null) => void;
  setParticipants: (participants: EventParticipant[]) => void;
  addTranscriptSegment: (segment: TranscriptionSegment) => void;
  clearTranscript: () => void;
  clearEvent: () => void;

  // API calls
  createEvent: (data: any) => Promise<Event>;
  joinEvent: (eventCode: string) => Promise<void>;
  endEvent: () => Promise<void>;
  fetchParticipants: () => Promise<void>;
}

export const useEventStore = create<EventState>((set, get) => ({
  currentEvent: null,
  participants: [],
  transcript: [],
  isLoading: false,
  error: null,

  setCurrentEvent: (event) => set({ currentEvent: event }),
  setParticipants: (participants) => set({ participants }),
  addTranscriptSegment: (segment) => set((state) => ({
    transcript: [...state.transcript, segment],
  })),
  clearTranscript: () => set({ transcript: [] }),
  clearEvent: () => set({ currentEvent: null, participants: [], transcript: [] }),

  createEvent: async (data) => {
    try {
      set({ isLoading: true, error: null });
      const event = await apiClient.createEvent(data);
      set({ currentEvent: event });
      return event;
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  joinEvent: async (eventCode) => {
    try {
      set({ isLoading: true, error: null });
      const data = await apiClient.joinEvent(eventCode);
      set({ currentEvent: data.event });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  endEvent: async () => {
    try {
      const event = get().currentEvent;
      if (!event) return;
      await apiClient.endEvent(event.id);
      set({ currentEvent: null });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  fetchParticipants: async () => {
    try {
      const event = get().currentEvent;
      if (!event) return;
      const participants = await apiClient.getParticipants(event.id);
      set({ participants });
    } catch (error: any) {
      set({ error: error.message });
    }
  },
}));

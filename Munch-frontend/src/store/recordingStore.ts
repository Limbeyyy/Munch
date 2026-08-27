import { create } from 'zustand';
import { Recording } from '../types';

interface RecordingState {
  recordings: Recording[];
  selectedRecording: Recording | null;
  loading: boolean;
  error: string | null;

  setRecordings: (recordings: Recording[]) => void;
  setSelectedRecording: (recording: Recording | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  fetchRecordings: (meetingId?: string) => Promise<void>;
  fetchRecording: (id: string) => Promise<void>;
  deleteRecording: (id: string) => Promise<void>;
  downloadRecording: (id: string) => Promise<void>;
  shareRecording: (id: string, recipients: string[]) => Promise<void>;
  resetError: () => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  recordings: [],
  selectedRecording: null,
  loading: false,
  error: null,

  setRecordings: (recordings) => set({ recordings }),
  setSelectedRecording: (recording) => set({ selectedRecording: recording }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  fetchRecordings: async (meetingId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  fetchRecording: async (id) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  deleteRecording: async (id) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  downloadRecording: async (id) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  shareRecording: async (id, recipients) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  resetError: () => set({ error: null }),
}));

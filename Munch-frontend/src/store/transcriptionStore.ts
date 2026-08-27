import { create } from 'zustand';
import { Transcript, TranscriptSummary, TranscriptEdit, TranscriptionSegment } from '../types';

interface TranscriptionState {
  transcript: Transcript | null;
  summary: TranscriptSummary | null;
  segments: TranscriptionSegment[];
  edits: TranscriptEdit[];
  loading: boolean;
  error: string | null;
  editMode: boolean;

  setTranscript: (transcript: Transcript | null) => void;
  setSummary: (summary: TranscriptSummary | null) => void;
  setSegments: (segments: TranscriptionSegment[]) => void;
  setEdits: (edits: TranscriptEdit[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setEditMode: (editMode: boolean) => void;

  fetchTranscript: (meetingId: string) => Promise<void>;
  fetchSummary: (meetingId: string) => Promise<void>;
  editSegment: (index: number, newText: string) => Promise<void>;
  exportTranscript: (format: 'pdf' | 'docx' | 'txt') => Promise<void>;
  searchTranscript: (query: string) => Promise<TranscriptionSegment[]>;
  generateSummary: (meetingId: string) => Promise<void>;
  resetError: () => void;
}

export const useTranscriptionStore = create<TranscriptionState>((set) => ({
  transcript: null,
  summary: null,
  segments: [],
  edits: [],
  loading: false,
  error: null,
  editMode: false,

  setTranscript: (transcript) => set({ transcript }),
  setSummary: (summary) => set({ summary }),
  setSegments: (segments) => set({ segments }),
  setEdits: (edits) => set({ edits }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setEditMode: (editMode) => set({ editMode }),

  fetchTranscript: async (meetingId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  fetchSummary: async (meetingId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  editSegment: async (index, newText) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  exportTranscript: async (format) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  searchTranscript: async (query) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
      return [];
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
      return [];
    }
  },

  generateSummary: async (meetingId) => {
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

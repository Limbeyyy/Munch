import { create } from 'zustand';
import { Artifact } from '../types';

interface ArtifactState {
  artifacts: Artifact[];
  selectedArtifact: Artifact | null;
  loading: boolean;
  error: string | null;

  setArtifacts: (artifacts: Artifact[]) => void;
  setSelectedArtifact: (artifact: Artifact | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  fetchArtifacts: (meetingId: string) => Promise<void>;
  fetchArtifact: (id: string) => Promise<void>;
  createArtifact: (data: Partial<Artifact>) => Promise<void>;
  deleteArtifact: (id: string) => Promise<void>;
  downloadArtifact: (id: string) => Promise<void>;
  resetError: () => void;
}

export const useArtifactStore = create<ArtifactState>((set) => ({
  artifacts: [],
  selectedArtifact: null,
  loading: false,
  error: null,

  setArtifacts: (artifacts) => set({ artifacts }),
  setSelectedArtifact: (artifact) => set({ selectedArtifact: artifact }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  fetchArtifacts: async (meetingId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  fetchArtifact: async (id) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  createArtifact: async (data) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  deleteArtifact: async (id) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  downloadArtifact: async (id) => {
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

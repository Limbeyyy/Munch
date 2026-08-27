import { create } from 'zustand';
import { DriveFile, DriveSyncStatus } from '../types';

interface DriveState {
  files: DriveFile[];
  syncStatus: DriveSyncStatus | null;
  loading: boolean;
  error: string | null;
  isConnected: boolean;

  setFiles: (files: DriveFile[]) => void;
  setSyncStatus: (status: DriveSyncStatus | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setIsConnected: (connected: boolean) => void;

  connectDrive: () => Promise<void>;
  disconnectDrive: () => Promise<void>;
  fetchFiles: (folderId?: string) => Promise<void>;
  createFolder: (folderName: string) => Promise<DriveFile>;
  uploadFile: (file: File, folderId?: string) => Promise<DriveFile>;
  deleteFile: (fileId: string) => Promise<void>;
  syncMeetingArtifacts: (meetingId: string, folderId: string) => Promise<void>;
  setSyncEnabled: (meetingId: string, enabled: boolean) => Promise<void>;
  resetError: () => void;
}

export const useDriveStore = create<DriveState>((set) => ({
  files: [],
  syncStatus: null,
  loading: false,
  error: null,
  isConnected: false,

  setFiles: (files) => set({ files }),
  setSyncStatus: (status) => set({ syncStatus: status }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setIsConnected: (connected) => set({ isConnected: connected }),

  connectDrive: async () => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ isConnected: true, loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  disconnectDrive: async () => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ isConnected: false, loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  fetchFiles: async (folderId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  createFolder: async (folderName) => {
    set({ loading: true, error: null });
    try {
      // API call here
      return {} as DriveFile;
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
      throw error;
    }
  },

  uploadFile: async (file, folderId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      return {} as DriveFile;
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
      throw error;
    }
  },

  deleteFile: async (fileId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  syncMeetingArtifacts: async (meetingId, folderId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  setSyncEnabled: async (meetingId, enabled) => {
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

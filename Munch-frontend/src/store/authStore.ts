import { create } from 'zustand';
import { User } from '../types';
import { apiClient } from '../services/api';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;

  // Actions
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Auth flow
  googleLogin: (code: string, redirectUri: string) => Promise<void>;
  getCurrentUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  error: null,
  isAuthenticated: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  googleLogin: async (code, redirectUri) => {
    try {
      set({ isLoading: true, error: null });
      const response = await apiClient.googleCallback(code, redirectUri);
      apiClient.setTokens(response.access, response.refresh);
      set({ user: response.user, isAuthenticated: true });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  getCurrentUser: async () => {
    try {
      set({ isLoading: true });
      const user = await apiClient.getCurrentUser();
      set({ user, isAuthenticated: true });
    } catch (error: any) {
      set({ error: error.message, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    try {
      set({ isLoading: true });
      await apiClient.logout();
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },
}));

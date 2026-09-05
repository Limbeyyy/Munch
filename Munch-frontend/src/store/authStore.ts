import { create } from 'zustand';
import { User } from '../types';
import { apiClient } from '../services/api';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  /**
   * Whether the stored session has been looked at yet.
   *
   * Until it has, "not authenticated" only means "not asked" - and route
   * guards must not act on it, or a refresh bounces a signed-in person to
   * the login page before their own token has been read.
   */
  ready: boolean;

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
  // A stored session means there is something to restore, so the app
  // starts out busy rather than starting out logged out.
  isLoading: apiClient.hasSession(),
  error: null,
  isAuthenticated: false,
  ready: !apiClient.hasSession(),

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  googleLogin: async (code, redirectUri) => {
    try {
      set({ isLoading: true, error: null });
      const response = await apiClient.googleCallback(code, redirectUri);
      apiClient.setTokens(response.access, response.refresh);
      set({ user: response.user, isAuthenticated: true, ready: true });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  getCurrentUser: async () => {
    if (!apiClient.hasSession()) {
      // Nothing stored, so nothing to restore. Saying so is what lets the
      // route guards stop waiting.
      set({ user: null, isAuthenticated: false, isLoading: false, ready: true });
      return;
    }
    try {
      set({ isLoading: true });
      const user = await apiClient.getCurrentUser();
      set({ user, isAuthenticated: true });
    } catch (error: any) {
      // The client renews behind this call, so reaching here means the
      // session could not be restored at all.
      set({ error: error.message, isAuthenticated: false });
    } finally {
      set({ isLoading: false, ready: true });
    }
  },

  logout: async () => {
    try {
      set({ isLoading: true });
      await apiClient.logout();
      set({ user: null, isAuthenticated: false, ready: true });
    } finally {
      set({ isLoading: false });
    }
  },
}));

import { create } from 'zustand';
import { OrganizationAnalytics, EventAnalytics } from '../types';

interface AnalyticsState {
  orgAnalytics: OrganizationAnalytics | null;
  eventAnalytics: EventAnalytics | null;
  dateRange: { from: string; to: string };
  loading: boolean;
  error: string | null;

  setOrgAnalytics: (analytics: OrganizationAnalytics | null) => void;
  setEventAnalytics: (analytics: EventAnalytics | null) => void;
  setDateRange: (from: string, to: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  fetchOrgAnalytics: (orgId: string, from?: string, to?: string) => Promise<void>;
  fetchEventAnalytics: (eventId: string) => Promise<void>;
  exportAnalytics: (format: 'csv' | 'pdf') => Promise<void>;
  resetError: () => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  orgAnalytics: null,
  eventAnalytics: null,
  dateRange: { from: '', to: '' },
  loading: false,
  error: null,

  setOrgAnalytics: (analytics) => set({ orgAnalytics: analytics }),
  setEventAnalytics: (analytics) => set({ eventAnalytics: analytics }),
  setDateRange: (from, to) => set({ dateRange: { from, to } }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  fetchOrgAnalytics: async (orgId, from, to) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  fetchEventAnalytics: async (eventId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  exportAnalytics: async (format) => {
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

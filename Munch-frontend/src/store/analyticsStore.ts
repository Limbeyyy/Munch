import { create } from 'zustand';
import { OrganizationAnalytics, MeetingAnalytics } from '../types';

interface AnalyticsState {
  orgAnalytics: OrganizationAnalytics | null;
  meetingAnalytics: MeetingAnalytics | null;
  dateRange: { from: string; to: string };
  loading: boolean;
  error: string | null;

  setOrgAnalytics: (analytics: OrganizationAnalytics | null) => void;
  setMeetingAnalytics: (analytics: MeetingAnalytics | null) => void;
  setDateRange: (from: string, to: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  fetchOrgAnalytics: (orgId: string, from?: string, to?: string) => Promise<void>;
  fetchMeetingAnalytics: (meetingId: string) => Promise<void>;
  exportAnalytics: (format: 'csv' | 'pdf') => Promise<void>;
  resetError: () => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  orgAnalytics: null,
  meetingAnalytics: null,
  dateRange: { from: '', to: '' },
  loading: false,
  error: null,

  setOrgAnalytics: (analytics) => set({ orgAnalytics: analytics }),
  setMeetingAnalytics: (analytics) => set({ meetingAnalytics: analytics }),
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

  fetchMeetingAnalytics: async (meetingId) => {
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

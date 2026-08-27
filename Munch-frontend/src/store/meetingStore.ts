import { create } from 'zustand';
import { Meeting, MeetingParticipant, TranscriptionSegment } from '../types';
import { apiClient } from '../services/api';

interface MeetingState {
  currentMeeting: Meeting | null;
  participants: MeetingParticipant[];
  transcript: TranscriptionSegment[];
  isLoading: boolean;
  error: string | null;

  // Actions
  setMeeting: (meeting: Meeting | null) => void;
  setParticipants: (participants: MeetingParticipant[]) => void;
  addTranscriptSegment: (segment: TranscriptionSegment) => void;
  clearTranscript: () => void;
  clearMeeting: () => void;

  // API calls
  createMeeting: (data: any) => Promise<Meeting>;
  joinMeeting: (meetingCode: string) => Promise<void>;
  endMeeting: () => Promise<void>;
  fetchParticipants: () => Promise<void>;
}

export const useMeetingStore = create<MeetingState>((set, get) => ({
  currentMeeting: null,
  participants: [],
  transcript: [],
  isLoading: false,
  error: null,

  setMeeting: (meeting) => set({ currentMeeting: meeting }),
  setParticipants: (participants) => set({ participants }),
  addTranscriptSegment: (segment) => set((state) => ({
    transcript: [...state.transcript, segment],
  })),
  clearTranscript: () => set({ transcript: [] }),
  clearMeeting: () => set({ currentMeeting: null, participants: [], transcript: [] }),

  createMeeting: async (data) => {
    try {
      set({ isLoading: true, error: null });
      const meeting = await apiClient.createMeeting(data);
      set({ currentMeeting: meeting });
      return meeting;
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  joinMeeting: async (meetingCode) => {
    try {
      set({ isLoading: true, error: null });
      const data = await apiClient.joinMeeting(meetingCode);
      set({ currentMeeting: data.meeting });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  endMeeting: async () => {
    try {
      const meeting = get().currentMeeting;
      if (!meeting) return;
      await apiClient.endMeeting(meeting.id);
      set({ currentMeeting: null });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  fetchParticipants: async () => {
    try {
      const meeting = get().currentMeeting;
      if (!meeting) return;
      const participants = await apiClient.getParticipants(meeting.id);
      set({ participants });
    } catch (error: any) {
      set({ error: error.message });
    }
  },
}));

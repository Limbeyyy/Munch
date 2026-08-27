import { create } from 'zustand';
import { Organization, Team, OrganizationMember, OrganizationInvite, SubscriptionData } from '../types';

interface OrganizationState {
  // Organization
  currentOrganization: Organization | null;
  organizations: Organization[];

  // Teams
  teams: Team[];

  // Members
  members: OrganizationMember[];

  // Invites
  invites: OrganizationInvite[];

  // Subscription
  subscription: SubscriptionData | null;

  // Loading
  loading: boolean;
  error: string | null;

  // Actions
  setCurrentOrganization: (org: Organization) => void;
  setOrganizations: (orgs: Organization[]) => void;
  setTeams: (teams: Team[]) => void;
  setMembers: (members: OrganizationMember[]) => void;
  setInvites: (invites: OrganizationInvite[]) => void;
  setSubscription: (subscription: SubscriptionData) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Mutations
  createOrganization: (data: Partial<Organization>) => Promise<void>;
  updateOrganization: (id: string, data: Partial<Organization>) => Promise<void>;
  deleteOrganization: (id: string) => Promise<void>;
  createTeam: (data: Partial<Team>) => Promise<void>;
  addMember: (email: string, role: string) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  inviteMember: (email: string, role: string) => Promise<void>;
  acceptInvite: (inviteId: string) => Promise<void>;
  rejectInvite: (inviteId: string) => Promise<void>;
  resetError: () => void;
}

export const useOrganizationStore = create<OrganizationState>((set) => ({
  currentOrganization: null,
  organizations: [],
  teams: [],
  members: [],
  invites: [],
  subscription: null,
  loading: false,
  error: null,

  setCurrentOrganization: (org) => set({ currentOrganization: org }),
  setOrganizations: (orgs) => set({ organizations: orgs }),
  setTeams: (teams) => set({ teams }),
  setMembers: (members) => set({ members }),
  setInvites: (invites) => set({ invites }),
  setSubscription: (subscription) => set({ subscription }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  createOrganization: async (data) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  updateOrganization: async (id, data) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  deleteOrganization: async (id) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  createTeam: async (data) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  addMember: async (email, role) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  removeMember: async (memberId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  inviteMember: async (email, role) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  acceptInvite: async (inviteId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  rejectInvite: async (inviteId) => {
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

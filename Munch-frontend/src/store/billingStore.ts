import { create } from 'zustand';
import { Invoice, PaymentMethod } from '../types';

interface BillingState {
  invoices: Invoice[];
  paymentMethods: PaymentMethod[];
  selectedInvoice: Invoice | null;
  loading: boolean;
  error: string | null;

  setInvoices: (invoices: Invoice[]) => void;
  setPaymentMethods: (methods: PaymentMethod[]) => void;
  setSelectedInvoice: (invoice: Invoice | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  fetchInvoices: (orgId: string) => Promise<void>;
  fetchPaymentMethods: (orgId: string) => Promise<void>;
  addPaymentMethod: (method: Partial<PaymentMethod>) => Promise<void>;
  removePaymentMethod: (methodId: string) => Promise<void>;
  setDefaultPaymentMethod: (methodId: string) => Promise<void>;
  downloadInvoice: (invoiceId: string) => Promise<void>;
  payInvoice: (invoiceId: string, methodId: string) => Promise<void>;
  updateSubscription: (orgId: string, tier: string) => Promise<void>;
  cancelSubscription: (orgId: string) => Promise<void>;
  resetError: () => void;
}

export const useBillingStore = create<BillingState>((set) => ({
  invoices: [],
  paymentMethods: [],
  selectedInvoice: null,
  loading: false,
  error: null,

  setInvoices: (invoices) => set({ invoices }),
  setPaymentMethods: (methods) => set({ paymentMethods: methods }),
  setSelectedInvoice: (invoice) => set({ selectedInvoice: invoice }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  fetchInvoices: async (orgId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  fetchPaymentMethods: async (orgId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  addPaymentMethod: async (method) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  removePaymentMethod: async (methodId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  setDefaultPaymentMethod: async (methodId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  downloadInvoice: async (invoiceId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  payInvoice: async (invoiceId, methodId) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  updateSubscription: async (orgId, tier) => {
    set({ loading: true, error: null });
    try {
      // API call here
      set({ loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  cancelSubscription: async (orgId) => {
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

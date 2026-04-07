/**
 * Zustand store for AI state — conversations, diagnoses, shift reports.
 */

import { create } from 'zustand';
import type { ChatMessage } from '@/types/ai';

interface AiState {
  /** Chat conversations keyed by truck ID */
  conversations: Record<string, ChatMessage[]>;
  /** Latest diagnosis per truck */
  diagnoses: Record<string, { text: string; createdAt: string }>;
  /** Cached shift reports */
  shiftReports: Record<string, { report: string; fetchedAt: string }>;
  /** Count of queued offline AI requests */
  pendingRequests: number;
  /** Whether an AI request is in progress */
  isLoading: boolean;

  addMessage: (truckId: string, message: ChatMessage) => void;
  setConversation: (truckId: string, messages: ChatMessage[]) => void;
  clearConversation: (truckId: string) => void;
  setDiagnosis: (truckId: string, diagnosis: string) => void;
  setShiftReport: (truckId: string, report: string) => void;
  setPendingRequests: (count: number) => void;
  setLoading: (loading: boolean) => void;
}

export const useAiStore = create<AiState>((set) => ({
  conversations: {},
  diagnoses: {},
  shiftReports: {},
  pendingRequests: 0,
  isLoading: false,

  addMessage: (truckId, message) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [truckId]: [...(state.conversations[truckId] || []), message],
      },
    })),

  setConversation: (truckId, messages) =>
    set((state) => ({
      conversations: { ...state.conversations, [truckId]: messages },
    })),

  clearConversation: (truckId) =>
    set((state) => ({
      conversations: { ...state.conversations, [truckId]: [] },
    })),

  setDiagnosis: (truckId, diagnosis) =>
    set((state) => ({
      diagnoses: {
        ...state.diagnoses,
        [truckId]: { text: diagnosis, createdAt: new Date().toISOString() },
      },
    })),

  setShiftReport: (truckId, report) =>
    set((state) => ({
      shiftReports: {
        ...state.shiftReports,
        [truckId]: { report, fetchedAt: new Date().toISOString() },
      },
    })),

  setPendingRequests: (count) => set({ pendingRequests: count }),
  setLoading: (loading) => set({ isLoading: loading }),
}));

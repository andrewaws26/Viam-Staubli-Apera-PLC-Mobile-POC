/**
 * Zustand store for sync state.
 * Displayed in the StatusBanner on every screen.
 */

import { create } from 'zustand';

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  failedCount: number;
  pendingAiRequests: number;

  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setPendingCount: (count: number) => void;
  setLastSyncAt: (time: string) => void;
  setFailedCount: (count: number) => void;
  setPendingAiRequests: (count: number) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncAt: null,
  failedCount: 0,
  pendingAiRequests: 0,

  setOnline: (online) => set({ isOnline: online }),
  setSyncing: (syncing) => set({ isSyncing: syncing }),
  setPendingCount: (count) => set({ pendingCount: count }),
  setLastSyncAt: (time) => set({ lastSyncAt: time }),
  setFailedCount: (count) => set({ failedCount: count }),
  setPendingAiRequests: (count) => set({ pendingAiRequests: count }),
}));

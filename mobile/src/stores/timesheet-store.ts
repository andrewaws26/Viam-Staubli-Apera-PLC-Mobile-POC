/**
 * Zustand store for timesheets — list, CRUD, status transitions.
 */

import { create } from 'zustand';
import { fetchTimesheets, fetchTimesheet, createTimesheet, updateTimesheet } from '@/services/api-client';
import type { Timesheet, TimesheetStatus, CreateTimesheetPayload } from '@ironsight/shared/timesheet';

interface TimesheetState {
  timesheets: Timesheet[];
  current: Timesheet | null;
  isLoading: boolean;
  error: string | null;

  loadTimesheets: () => Promise<void>;
  loadTimesheet: (id: string) => Promise<void>;
  create: (payload: CreateTimesheetPayload) => Promise<string | null>;
  submit: (id: string) => Promise<boolean>;
  updateStatus: (id: string, status: TimesheetStatus, reason?: string) => Promise<boolean>;
}

export const useTimesheetStore = create<TimesheetState>((set, get) => ({
  timesheets: [],
  current: null,
  isLoading: false,
  error: null,

  loadTimesheets: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await fetchTimesheets();
      if (result.error) {
        set({ error: result.error, isLoading: false });
        return;
      }
      set({ timesheets: (result.data ?? []) as unknown as Timesheet[], isLoading: false });
    } catch (err) {
      set({ error: 'Failed to load timesheets', isLoading: false });
    }
  },

  loadTimesheet: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await fetchTimesheet(id);
      if (result.error) {
        set({ error: result.error, isLoading: false });
        return;
      }
      set({ current: result.data as unknown as Timesheet, isLoading: false });
    } catch (err) {
      set({ error: 'Failed to load timesheet', isLoading: false });
    }
  },

  create: async (payload) => {
    set({ isLoading: true, error: null });
    try {
      const result = await createTimesheet(payload as unknown as Record<string, unknown>);
      if (result.error || !result.data) {
        set({ error: result.error || 'Failed to create', isLoading: false });
        return null;
      }
      await get().loadTimesheets();
      set({ isLoading: false });
      return (result.data as any).id as string;
    } catch {
      set({ error: 'Failed to create timesheet', isLoading: false });
      return null;
    }
  },

  submit: async (id: string) => {
    return get().updateStatus(id, 'submitted');
  },

  updateStatus: async (id, status, reason?) => {
    try {
      const body: Record<string, unknown> = { status };
      if (reason) body.rejection_reason = reason;
      const result = await updateTimesheet(id, body);
      if (result.error) return false;
      await get().loadTimesheets();
      if (get().current?.id === id) {
        await get().loadTimesheet(id);
      }
      return true;
    } catch {
      return false;
    }
  },
}));

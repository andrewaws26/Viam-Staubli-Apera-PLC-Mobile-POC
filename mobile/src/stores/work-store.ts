/**
 * Zustand store for work orders — board state, filters, CRUD.
 */

import { create } from 'zustand';
import { fetchWorkOrders, createWorkOrder, updateWorkOrder } from '@/services/api-client';
import type { WorkOrder, WorkOrderStatus, CreateWorkOrderPayload, UpdateWorkOrderPayload } from '@/types/work-order';

interface WorkState {
  workOrders: WorkOrder[];
  isLoading: boolean;
  error: string | null;
  /** 'board' shows all grouped by status, 'my_work' shows only work assigned to current user */
  viewMode: 'board' | 'my_work';

  setViewMode: (mode: 'board' | 'my_work') => void;
  loadWorkOrders: () => Promise<void>;
  addWorkOrder: (payload: CreateWorkOrderPayload) => Promise<WorkOrder | null>;
  patchWorkOrder: (id: string, payload: UpdateWorkOrderPayload) => Promise<boolean>;
}

export const useWorkStore = create<WorkState>((set, get) => ({
  workOrders: [],
  isLoading: false,
  error: null,
  viewMode: 'board',

  setViewMode: (mode) => set({ viewMode: mode }),

  loadWorkOrders: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await fetchWorkOrders();
      if (result.error) {
        set({ error: result.error, isLoading: false });
        return;
      }
      const orders = (result.data ?? []) as unknown as WorkOrder[];
      set({ workOrders: orders, isLoading: false });
    } catch (err) {
      set({ error: 'Failed to load work orders', isLoading: false });
    }
  },

  addWorkOrder: async (payload) => {
    try {
      const result = await createWorkOrder(payload as unknown as Record<string, unknown>);
      if (result.error || !result.data) return null;
      // Reload full list to get embedded subtasks/note_count
      await get().loadWorkOrders();
      return result.data as unknown as WorkOrder;
    } catch {
      return null;
    }
  },

  patchWorkOrder: async (id, payload) => {
    // Optimistic update for status and subtask toggles
    const prev = get().workOrders;
    if (payload.status || payload.toggle_subtask_id || payload.assigned_to !== undefined) {
      set({
        workOrders: prev.map((wo) => {
          if (wo.id !== id) return wo;
          const updates: Partial<WorkOrder> = { updated_at: new Date().toISOString() };
          if (payload.status) updates.status = payload.status;
          if (payload.assigned_to !== undefined) {
            updates.assigned_to = payload.assigned_to as string | null;
            updates.assigned_to_name = (payload.assigned_to_name as string | null) ?? null;
          }
          if (payload.toggle_subtask_id && wo.subtasks) {
            updates.subtasks = wo.subtasks.map((s) =>
              s.id === payload.toggle_subtask_id ? { ...s, is_done: !s.is_done } : s,
            );
          }
          return { ...wo, ...updates };
        }),
      });
    }

    try {
      const result = await updateWorkOrder(id, payload as Record<string, unknown>);
      if (result.error) {
        // Revert optimistic update
        set({ workOrders: prev });
        return false;
      }
      // Reload to get fresh data
      await get().loadWorkOrders();
      return true;
    } catch {
      set({ workOrders: prev });
      return false;
    }
  },
}));

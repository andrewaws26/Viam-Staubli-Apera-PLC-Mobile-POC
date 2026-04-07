/**
 * Tests for the work order Zustand store.
 * Validates optimistic updates, view mode switching, and state management.
 */

import { useWorkStore } from '../../src/stores/work-store';
import type { WorkOrder } from '../../src/types/work-order';

// Mock the API client
jest.mock('../../src/services/api-client', () => ({
  fetchWorkOrders: jest.fn(),
  createWorkOrder: jest.fn(),
  updateWorkOrder: jest.fn(),
}));

const { fetchWorkOrders, createWorkOrder, updateWorkOrder } =
  jest.requireMock('../../src/services/api-client');

const MOCK_WORK_ORDERS: WorkOrder[] = [
  {
    id: 'wo-1',
    truck_id: null,
    title: 'Check coolant leak',
    description: 'Puddle under engine',
    priority: 'urgent',
    status: 'open',
    assigned_to: null,
    assigned_to_name: null,
    created_by: 'user-1',
    created_by_name: 'Andrew',
    due_date: null,
    truck_snapshot: null,
    linked_dtcs: [],
    blocker_reason: null,
    note_count: 0,
    subtasks: [
      { id: 'st-1', work_order_id: 'wo-1', title: 'Inspect hoses', sort_order: 0, is_done: false, created_at: '2026-04-01T00:00:00Z' },
      { id: 'st-2', work_order_id: 'wo-1', title: 'Pressure test', sort_order: 1, is_done: true, created_at: '2026-04-01T00:00:00Z' },
    ],
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    completed_at: null,
  },
  {
    id: 'wo-2',
    truck_id: null,
    title: 'Oil change',
    description: null,
    priority: 'low',
    status: 'done',
    assigned_to: 'user-1',
    assigned_to_name: 'Andrew',
    created_by: 'user-1',
    created_by_name: 'Andrew',
    due_date: null,
    truck_snapshot: null,
    linked_dtcs: [],
    blocker_reason: null,
    note_count: 1,
    subtasks: [],
    created_at: '2026-03-25T00:00:00Z',
    updated_at: '2026-03-30T00:00:00Z',
    completed_at: '2026-03-30T00:00:00Z',
  },
];

describe('Work Store', () => {
  beforeEach(() => {
    // Reset store state
    useWorkStore.setState({
      workOrders: [],
      isLoading: false,
      error: null,
      viewMode: 'board',
    });
    jest.clearAllMocks();
  });

  describe('setViewMode', () => {
    it('switches between board and my_work', () => {
      useWorkStore.getState().setViewMode('my_work');
      expect(useWorkStore.getState().viewMode).toBe('my_work');

      useWorkStore.getState().setViewMode('board');
      expect(useWorkStore.getState().viewMode).toBe('board');
    });
  });

  describe('loadWorkOrders', () => {
    it('sets isLoading then clears it', async () => {
      fetchWorkOrders.mockResolvedValue({ data: MOCK_WORK_ORDERS, error: null });

      const promise = useWorkStore.getState().loadWorkOrders();
      expect(useWorkStore.getState().isLoading).toBe(true);

      await promise;
      expect(useWorkStore.getState().isLoading).toBe(false);
      expect(useWorkStore.getState().workOrders).toHaveLength(2);
    });

    it('sets error on failure', async () => {
      fetchWorkOrders.mockResolvedValue({ data: null, error: 'Network error' });

      await useWorkStore.getState().loadWorkOrders();
      expect(useWorkStore.getState().error).toBe('Network error');
    });
  });

  describe('patchWorkOrder (optimistic updates)', () => {
    beforeEach(() => {
      useWorkStore.setState({ workOrders: [...MOCK_WORK_ORDERS] });
    });

    it('optimistically updates status', async () => {
      fetchWorkOrders.mockResolvedValue({ data: MOCK_WORK_ORDERS, error: null });
      updateWorkOrder.mockResolvedValue({ data: {}, error: null });

      // Start the patch
      const promise = useWorkStore.getState().patchWorkOrder('wo-1', { status: 'in_progress' });

      // Check optimistic state immediately
      const updated = useWorkStore.getState().workOrders.find((wo) => wo.id === 'wo-1');
      expect(updated?.status).toBe('in_progress');

      await promise;
    });

    it('optimistically toggles subtask', async () => {
      fetchWorkOrders.mockResolvedValue({ data: MOCK_WORK_ORDERS, error: null });
      updateWorkOrder.mockResolvedValue({ data: {}, error: null });

      const promise = useWorkStore.getState().patchWorkOrder('wo-1', {
        toggle_subtask_id: 'st-1',
      });

      // Subtask should be toggled optimistically
      const updated = useWorkStore.getState().workOrders.find((wo) => wo.id === 'wo-1');
      expect(updated?.subtasks?.[0].is_done).toBe(true);

      await promise;
    });

    it('optimistically updates assignment', async () => {
      fetchWorkOrders.mockResolvedValue({ data: MOCK_WORK_ORDERS, error: null });
      updateWorkOrder.mockResolvedValue({ data: {}, error: null });

      const promise = useWorkStore.getState().patchWorkOrder('wo-1', {
        assigned_to: 'user-2',
        assigned_to_name: 'Mike',
      });

      const updated = useWorkStore.getState().workOrders.find((wo) => wo.id === 'wo-1');
      expect(updated?.assigned_to).toBe('user-2');
      expect(updated?.assigned_to_name).toBe('Mike');

      await promise;
    });

    it('reverts on API failure', async () => {
      fetchWorkOrders.mockResolvedValue({ data: MOCK_WORK_ORDERS, error: null });
      updateWorkOrder.mockResolvedValue({ data: null, error: 'Server error' });

      await useWorkStore.getState().patchWorkOrder('wo-1', { status: 'done' });

      // Should revert to original status
      const reverted = useWorkStore.getState().workOrders.find((wo) => wo.id === 'wo-1');
      expect(reverted?.status).toBe('open');
    });
  });
});

/** Work order types for the shop floor task management system. */

export type WorkOrderStatus = 'open' | 'in_progress' | 'blocked' | 'done';
export type WorkOrderPriority = 'low' | 'normal' | 'urgent';

export interface WorkOrderSubtask {
  id: string;
  work_order_id: string;
  title: string;
  is_done: boolean;
  sort_order: number;
  created_at: string;
}

export interface WorkOrderNote {
  id: string;
  work_order_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface WorkOrder {
  id: string;
  truck_id: string | null;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  blocker_reason: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_by: string;
  created_by_name: string;
  truck_snapshot: Record<string, unknown> | null;
  linked_dtcs: { spn: number; fmi: number; ecuLabel: string }[];
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded from API */
  subtasks: WorkOrderSubtask[];
  note_count: number;
}

export interface CreateWorkOrderPayload {
  truck_id?: string;
  title: string;
  description?: string;
  priority?: WorkOrderPriority;
  assigned_to?: string;
  assigned_to_name?: string;
  due_date?: string;
  truck_snapshot?: Record<string, unknown>;
  linked_dtcs?: { spn: number; fmi: number; ecuLabel: string }[];
  subtasks?: { title: string }[];
}

export interface UpdateWorkOrderPayload {
  title?: string;
  description?: string;
  status?: WorkOrderStatus;
  priority?: WorkOrderPriority;
  blocker_reason?: string;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  due_date?: string | null;
  truck_id?: string | null;
  toggle_subtask_id?: string;
  note?: string;
}

export const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
};

export const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  urgent: 'Urgent',
};

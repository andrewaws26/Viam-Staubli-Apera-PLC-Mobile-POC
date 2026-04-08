/**
 * Inventory & Parts Tracking types for IronSight Company OS.
 *
 * Tracks parts, supplies, and equipment inventory for field operations:
 *   1. Parts catalog with categories, costs, and reorder points
 *   2. Stock level tracking with location awareness
 *   3. Usage logging linked to maintenance time entries
 *   4. Low-stock alerts and reorder suggestions
 */

// ── Enums ────────────────────────────────────────────────────────────

export type PartCategory =
  | 'hydraulic'
  | 'electrical'
  | 'engine'
  | 'transmission'
  | 'brake'
  | 'suspension'
  | 'body'
  | 'safety'
  | 'consumable'
  | 'tool'
  | 'other';

export type PartStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'discontinued';

export type UsageType = 'maintenance' | 'repair' | 'replacement' | 'inspection' | 'other';

export type StockLocation = 'shop' | 'truck' | 'warehouse' | 'field' | 'other';

// ── Parts Catalog ────────────────────────────────────────────────────

export interface Part {
  id: string;
  part_number: string;
  name: string;
  description: string | null;
  category: PartCategory;
  unit_cost: number;
  unit: string;
  quantity_on_hand: number;
  reorder_point: number;
  reorder_quantity: number;
  location: StockLocation;
  supplier: string | null;
  supplier_part_number: string | null;
  status: PartStatus;
  is_active: boolean;
  last_ordered: string | null;
  last_used: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePartPayload {
  part_number: string;
  name: string;
  description?: string;
  category: PartCategory;
  unit_cost: number;
  unit?: string;
  quantity_on_hand?: number;
  reorder_point?: number;
  reorder_quantity?: number;
  location?: StockLocation;
  supplier?: string;
  supplier_part_number?: string;
  notes?: string;
}

export interface UpdatePartPayload {
  name?: string;
  description?: string;
  category?: PartCategory;
  unit_cost?: number;
  unit?: string;
  quantity_on_hand?: number;
  reorder_point?: number;
  reorder_quantity?: number;
  location?: StockLocation;
  supplier?: string;
  supplier_part_number?: string;
  is_active?: boolean;
  notes?: string;
}

// ── Usage Log ────────────────────────────────────────────────────────

export interface PartUsage {
  id: string;
  part_id: string;
  part_number?: string;
  part_name?: string;
  quantity_used: number;
  usage_type: UsageType;
  truck_id: string | null;
  truck_name: string | null;
  maintenance_entry_id: string | null;
  used_by: string;
  used_by_name: string;
  usage_date: string;
  notes: string | null;
  created_at: string;
}

export interface CreatePartUsagePayload {
  part_id: string;
  quantity_used: number;
  usage_type: UsageType;
  truck_id?: string;
  truck_name?: string;
  maintenance_entry_id?: string;
  usage_date: string;
  notes?: string;
}

// ── Constants ────────────────────────────────────────────────────────

export const PART_CATEGORY_LABELS: Record<PartCategory, string> = {
  hydraulic: 'Hydraulic',
  electrical: 'Electrical',
  engine: 'Engine',
  transmission: 'Transmission',
  brake: 'Brake',
  suspension: 'Suspension',
  body: 'Body & Frame',
  safety: 'Safety',
  consumable: 'Consumable',
  tool: 'Tool',
  other: 'Other',
};

export const PART_CATEGORY_COLORS: Record<PartCategory, string> = {
  hydraulic: '#3b82f6',
  electrical: '#f59e0b',
  engine: '#ef4444',
  transmission: '#8b5cf6',
  brake: '#ec4899',
  suspension: '#14b8a6',
  body: '#6b7280',
  safety: '#22c55e',
  consumable: '#f97316',
  tool: '#06b6d4',
  other: '#9ca3af',
};

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  in_stock: 'In Stock',
  low_stock: 'Low Stock',
  out_of_stock: 'Out of Stock',
  discontinued: 'Discontinued',
};

export const PART_STATUS_COLORS: Record<PartStatus, string> = {
  in_stock: '#22c55e',
  low_stock: '#f59e0b',
  out_of_stock: '#ef4444',
  discontinued: '#6b7280',
};

export const USAGE_TYPE_LABELS: Record<UsageType, string> = {
  maintenance: 'Maintenance',
  repair: 'Repair',
  replacement: 'Replacement',
  inspection: 'Inspection',
  other: 'Other',
};

export const STOCK_LOCATION_LABELS: Record<StockLocation, string> = {
  shop: 'Shop',
  truck: 'On Truck',
  warehouse: 'Warehouse',
  field: 'Field',
  other: 'Other',
};

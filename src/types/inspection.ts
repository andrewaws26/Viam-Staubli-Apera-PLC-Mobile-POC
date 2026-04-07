/** Inspection checklist types for pre/post shift inspections. */

export type InspectionType = 'pre_shift' | 'post_shift';
export type CheckResult = 'pass' | 'fail' | 'na' | null;
export type OverallStatus = 'pass' | 'fail' | 'incomplete';

export interface InspectionCategory {
  name: string;
  items: InspectionItem[];
}

export interface InspectionItem {
  id: string;
  label: string;
  category: string;
  result: CheckResult;
  note?: string;
  photoUri?: string;
}

export interface InspectionRecord {
  id: string;
  truckId: string;
  inspectorId: string;
  inspectorName: string;
  inspectorRole: string;
  type: InspectionType;
  items: InspectionItem[];
  overallStatus: OverallStatus;
  notes?: string;
  createdAt: string;
  syncStatus: 'synced' | 'pending' | 'failed';
  localId?: number;
}

/** Default checklist template */
export const INSPECTION_CHECKLIST: InspectionCategory[] = [
  {
    name: 'Exterior',
    items: [
      { id: 'ext-tires', label: 'Tires — condition & pressure', category: 'Exterior', result: null },
      { id: 'ext-lights', label: 'Lights — headlights, taillights, signals', category: 'Exterior', result: null },
      { id: 'ext-mirrors', label: 'Mirrors — intact & adjusted', category: 'Exterior', result: null },
      { id: 'ext-body', label: 'Body — no visible damage', category: 'Exterior', result: null },
      { id: 'ext-leaks', label: 'Fluid leaks — none visible', category: 'Exterior', result: null },
    ],
  },
  {
    name: 'Engine',
    items: [
      { id: 'eng-oil', label: 'Oil level — within range', category: 'Engine', result: null },
      { id: 'eng-coolant', label: 'Coolant level — within range', category: 'Engine', result: null },
      { id: 'eng-belts', label: 'Belts — no cracks or wear', category: 'Engine', result: null },
      { id: 'eng-battery', label: 'Battery terminals — clean & tight', category: 'Engine', result: null },
      { id: 'eng-filter', label: 'Air filter — not clogged', category: 'Engine', result: null },
    ],
  },
  {
    name: 'Cab',
    items: [
      { id: 'cab-gauges', label: 'Gauges — all working', category: 'Cab', result: null },
      { id: 'cab-horn', label: 'Horn — functional', category: 'Cab', result: null },
      { id: 'cab-wipers', label: 'Wipers — operational', category: 'Cab', result: null },
      { id: 'cab-seatbelt', label: 'Seatbelt — functional', category: 'Cab', result: null },
      { id: 'cab-extinguisher', label: 'Fire extinguisher — present & charged', category: 'Cab', result: null },
    ],
  },
  {
    name: 'Safety',
    items: [
      { id: 'saf-triangles', label: 'Reflective triangles — present', category: 'Safety', result: null },
      { id: 'saf-firstaid', label: 'First aid kit — stocked', category: 'Safety', result: null },
      { id: 'saf-chocks', label: 'Wheel chocks — present', category: 'Safety', result: null },
    ],
  },
];

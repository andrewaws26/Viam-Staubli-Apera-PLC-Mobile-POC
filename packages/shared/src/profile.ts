/**
 * Employee profile types for IronSight Company OS.
 *
 * Extends Clerk auth user data with company-specific HR fields:
 * phone, emergency contact, hire date, job title, department, and
 * a profile picture stored in Supabase Storage.
 */

export interface EmployeeProfile {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  hire_date: string | null;
  job_title: string | null;
  department: string | null;
  profile_picture_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload for creating or updating an employee profile. */
export interface UpdateProfilePayload {
  phone?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  hire_date?: string;
  job_title?: string;
  department?: string;
  profile_picture_url?: string;
}

/** Departments within B&B Metals / IronSight operations. */
export const DEPARTMENT_OPTIONS = [
  'Field Operations',
  'Maintenance',
  'Management',
  'Administration',
  'Safety',
  'Logistics',
] as const;

/** Preset avatar options for employee profiles. */
export const PRESET_AVATARS = [
  { label: 'Train', path: '/avatars/train.svg' },
  { label: 'Robot', path: '/avatars/robot.svg' },
  { label: 'Wrench', path: '/avatars/wrench.svg' },
  { label: 'Hard Hat', path: '/avatars/hard-hat.svg' },
  { label: 'Truck', path: '/avatars/truck.svg' },
  { label: 'Gear', path: '/avatars/gear.svg' },
  { label: 'Railroad', path: '/avatars/railroad.svg' },
  { label: 'Safety Vest', path: '/avatars/safety-vest.svg' },
] as const;

/** Common job titles for railroad/industrial field operations. */
export const JOB_TITLE_OPTIONS = [
  'Field Technician',
  'Lead Technician',
  'Mechanic',
  'Heavy Equipment Operator',
  'CDL Driver',
  'Foreman',
  'Project Manager',
  'Safety Officer',
  'Dispatcher',
  'Administrator',
] as const;

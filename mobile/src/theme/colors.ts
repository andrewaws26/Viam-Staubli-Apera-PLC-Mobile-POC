/**
 * IronSight dark theme colors.
 * Matches the web dashboard's Tailwind palette for visual consistency.
 * Optimized for outdoor visibility on mobile screens.
 */
export const colors = {
  background: '#030712',        // gray-950
  card: '#1f2937',              // gray-800
  cardElevated: '#374151',      // gray-700 (modals, overlays)
  border: '#374151',            // gray-700
  primary: '#7c3aed',           // purple-600
  primaryLight: '#8b5cf6',      // purple-500 (active/pressed)
  primaryDark: '#6d28d9',       // purple-700 (borders)
  text: '#f3f4f6',              // gray-100
  textSecondary: '#9ca3af',     // gray-400
  textMuted: '#6b7280',         // gray-500
  success: '#16a34a',           // green-600
  successLight: '#22c55e',      // green-500
  danger: '#dc2626',            // red-600
  dangerLight: '#ef4444',       // red-500
  warning: '#d97706',           // amber-600
  warningLight: '#f59e0b',      // amber-500
  info: '#2563eb',              // blue-600
  infoLight: '#3b82f6',        // blue-500
  /** Status indicator colors */
  statusRunning: '#16a34a',
  statusIdle: '#d97706',
  statusAlert: '#dc2626',
  statusOffline: '#6b7280',
} as const;

export type ColorKey = keyof typeof colors;

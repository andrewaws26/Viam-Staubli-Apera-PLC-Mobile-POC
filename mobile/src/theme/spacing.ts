/**
 * Consistent spacing scale for the app.
 * Based on a 4px grid for visual rhythm.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
} as const;

/** Minimum touch target size per Apple HIG */
export const MIN_TOUCH_TARGET = 48;

/** Preferred touch target for primary actions (gloved fingers) */
export const PREFERRED_TOUCH_TARGET = 56;

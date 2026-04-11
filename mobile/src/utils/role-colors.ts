/**
 * Centralized role color map — used across chat, work orders, and user displays.
 */

import { colors } from '@/theme/colors';

export const ROLE_COLORS: Record<string, string> = {
  developer: '#a855f7',
  manager: colors.infoLight,
  mechanic: colors.successLight,
  operator: colors.warningLight,
  ai: '#06b6d4',
};

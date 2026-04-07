/**
 * Badge component for status indicators, DTC severity, and role labels.
 */

import React from 'react';
import { View, Text, ViewStyle, TextStyle } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'muted' | 'primary';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  small?: boolean;
}

const VARIANT_COLORS: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: '#16a34a20', text: colors.successLight },
  danger: { bg: '#dc262620', text: colors.dangerLight },
  warning: { bg: '#d9770620', text: colors.warningLight },
  info: { bg: '#2563eb20', text: colors.infoLight },
  muted: { bg: '#6b728020', text: colors.textMuted },
  primary: { bg: '#7c3aed20', text: colors.primaryLight },
};

export default function Badge({ label, variant = 'muted', small = false }: BadgeProps) {
  const v = VARIANT_COLORS[variant];

  const containerStyle: ViewStyle = {
    backgroundColor: v.bg,
    paddingHorizontal: small ? spacing.sm : spacing.md,
    paddingVertical: small ? 2 : 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  };

  const textStyle: TextStyle = {
    color: v.text,
    fontSize: small ? typography.sizes.xs : typography.sizes.sm,
    fontWeight: typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };

  return (
    <View style={containerStyle}>
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

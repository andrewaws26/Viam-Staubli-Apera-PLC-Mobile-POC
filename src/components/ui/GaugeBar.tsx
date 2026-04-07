/**
 * Horizontal bar gauge for fuel level, DEF level, etc.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { getGaugeStatus, getGaugeColor } from '@/utils/gauge-thresholds';

interface GaugeBarProps {
  label: string;
  value: number | null | undefined;
  unit?: string;
  max?: number;
  gaugeKey?: string;
}

export default function GaugeBar({ label, value, unit = '%', max = 100, gaugeKey }: GaugeBarProps) {
  const status = gaugeKey ? getGaugeStatus(gaugeKey, value) : 'normal';
  const barColor = getGaugeColor(status);
  const displayValue = value !== null && value !== undefined && !isNaN(value) ? value : null;
  const percentage = displayValue !== null ? Math.min(Math.max(displayValue / max, 0), 1) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color: barColor }]}>
          {displayValue !== null ? `${Math.round(displayValue)}${unit}` : '--'}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percentage * 100}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
  },
  value: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.bold,
  },
  track: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
});

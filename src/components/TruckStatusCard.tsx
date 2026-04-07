/**
 * Status card for a truck in the fleet overview.
 * Shows name, status indicator, key readings, active DTC count, and last updated.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Badge from './ui/Badge';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { formatValue, timeAgo } from '@/utils/format';
import type { TruckSensorReadings } from '@/types/sensor';

interface TruckStatusCardProps {
  name: string;
  truckId: string;
  readings: TruckSensorReadings | null;
  updatedAt: number | null;
  onPress: () => void;
}

function getTruckStatus(readings: TruckSensorReadings | null): { label: string; color: string; variant: 'success' | 'warning' | 'danger' | 'muted' } {
  if (!readings) return { label: 'Offline', color: colors.statusOffline, variant: 'muted' };
  const dtcCount = readings.active_dtc_count ?? 0;
  const rpm = readings.engine_rpm;
  if (dtcCount > 0) return { label: 'Alert', color: colors.statusAlert, variant: 'danger' };
  if (rpm && rpm > 0) return { label: 'Running', color: colors.statusRunning, variant: 'success' };
  return { label: 'Idle', color: colors.statusIdle, variant: 'warning' };
}

export default function TruckStatusCard({ name, truckId, readings, updatedAt, onPress }: TruckStatusCardProps) {
  const status = getTruckStatus(readings);
  const dtcCount = readings?.active_dtc_count ?? 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View style={styles.nameRow}>
          <View style={[styles.dot, { backgroundColor: status.color }]} />
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
        </View>
        <Badge label={status.label} variant={status.variant} small />
      </View>

      <View style={styles.readings}>
        <View style={styles.readingItem}>
          <Text style={styles.readingLabel}>RPM</Text>
          <Text style={styles.readingValue}>{formatValue(readings?.engine_rpm, '', 0)}</Text>
        </View>
        <View style={styles.readingItem}>
          <Text style={styles.readingLabel}>Coolant</Text>
          <Text style={styles.readingValue}>{formatValue(readings?.coolant_temp_f, '°F', 0)}</Text>
        </View>
        <View style={styles.readingItem}>
          <Text style={styles.readingLabel}>Speed</Text>
          <Text style={styles.readingValue}>{formatValue(readings?.vehicle_speed_mph, 'mph', 0)}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.updated}>
          {updatedAt ? timeAgo(new Date(updatedAt).toISOString()) : 'No data'}
        </Text>
        {dtcCount > 0 && (
          <View style={styles.dtcBadge}>
            <Text style={styles.dtcCount}>{dtcCount} DTC{dtcCount !== 1 ? 's' : ''}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  name: {
    color: colors.text,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.bold,
    flex: 1,
  },
  readings: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  readingItem: {
    alignItems: 'center',
    gap: 2,
  },
  readingLabel: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
  },
  readingValue: {
    color: colors.text,
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  updated: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
  },
  dtcBadge: {
    backgroundColor: '#dc262630',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  dtcCount: {
    color: colors.dangerLight,
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.bold,
  },
});

/**
 * Lamp indicators for Protect, Amber Warning, Red Stop, and MIL.
 * Matches the web dashboard's TruckPanel lamp display.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { TruckSensorReadings } from '@/types/sensor';

interface LampIndicatorsProps {
  readings: TruckSensorReadings;
}

interface LampDef {
  label: string;
  key: keyof TruckSensorReadings;
  onColor: string;
}

const LAMPS: LampDef[] = [
  { label: 'Protect', key: 'protect_lamp', onColor: colors.danger },
  { label: 'Amber', key: 'amber_warning_lamp', onColor: colors.warning },
  { label: 'Red Stop', key: 'red_stop_lamp', onColor: colors.danger },
  { label: 'MIL', key: 'malfunction_lamp', onColor: colors.warning },
];

export default function LampIndicators({ readings }: LampIndicatorsProps) {
  return (
    <View style={styles.container}>
      {LAMPS.map(({ label, key, onColor }) => {
        const value = readings[key] as number | undefined;
        const isOn = value === 1;
        return (
          <View key={label} style={styles.lamp}>
            <View style={[styles.indicator, { backgroundColor: isOn ? onColor : colors.border }]} />
            <Text style={[styles.label, isOn && { color: onColor }]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
  },
  lamp: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  indicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.label,
  },
});

/**
 * Horizontal scrollable pill bar for truck selection.
 * Not a dropdown — faster for field use with gloved fingers.
 */

import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme/colors';
import { spacing, MIN_TOUCH_TARGET } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { FleetTruck } from '@/types/supabase';

interface TruckSelectorProps {
  trucks: FleetTruck[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function TruckSelector({ trucks, selectedId, onSelect }: TruckSelectorProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {trucks.map((truck) => {
        const isSelected = truck.id === selectedId;
        return (
          <TouchableOpacity
            key={truck.id}
            style={[styles.pill, isSelected && styles.pillSelected]}
            onPress={() => {
              Haptics.selectionAsync();
              onSelect(truck.id);
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>
              {truck.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  pill: {
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.heading,
  },
  labelSelected: {
    color: '#ffffff',
  },
});

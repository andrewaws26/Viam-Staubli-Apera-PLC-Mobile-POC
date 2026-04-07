/**
 * Segmented control for switching between modes (AI modes, pre/post shift).
 */

import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme/colors';
import { spacing, MIN_TOUCH_TARGET } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface SegmentedControlProps {
  options: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

export default function SegmentedControl({ options, selectedIndex, onChange }: SegmentedControlProps) {
  const handlePress = (index: number) => {
    if (index !== selectedIndex) {
      Haptics.selectionAsync();
      onChange(index);
    }
  };

  return (
    <View style={styles.container}>
      {options.map((option, index) => (
        <TouchableOpacity
          key={option}
          style={[styles.segment, index === selectedIndex && styles.segmentActive]}
          onPress={() => handlePress(index)}
          activeOpacity={0.7}
        >
          <Text style={[styles.label, index === selectedIndex && styles.labelActive]}>
            {option}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    height: MIN_TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
  },
  labelActive: {
    color: '#ffffff',
  },
});

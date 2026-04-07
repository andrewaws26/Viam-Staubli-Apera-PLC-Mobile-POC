/**
 * Skeleton loading placeholder — feels faster than spinners.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

interface LoadingStateProps {
  lines?: number;
  height?: number;
  style?: ViewStyle;
}

function SkeletonLine({ width, height }: { width: string; height: number }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: width as unknown as number,
          height,
          backgroundColor: colors.cardElevated,
          borderRadius: 8,
        },
        animatedStyle,
      ]}
    />
  );
}

export default function LoadingState({ lines = 3, height = 16, style }: LoadingStateProps) {
  const widths = ['100%', '85%', '70%', '90%', '60%'];

  return (
    <View style={[styles.container, style]}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={widths[i % widths.length]} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    padding: spacing.lg,
  },
});

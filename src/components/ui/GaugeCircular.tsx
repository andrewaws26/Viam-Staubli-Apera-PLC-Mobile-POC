/**
 * SVG-based circular gauge for RPM, temperature, pressure.
 * Animated value transitions using react-native-reanimated.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { getGaugeStatus, getGaugeColor } from '@/utils/gauge-thresholds';

interface GaugeCircularProps {
  label: string;
  value: number | null | undefined;
  unit: string;
  min?: number;
  max?: number;
  gaugeKey?: string;
  size?: number;
}

export default function GaugeCircular({
  label,
  value,
  unit,
  min = 0,
  max = 100,
  gaugeKey,
  size = 100,
}: GaugeCircularProps) {
  const status = gaugeKey ? getGaugeStatus(gaugeKey, value) : 'normal';
  const gaugeColor = getGaugeColor(status);
  const displayValue = value !== null && value !== undefined && !isNaN(value) ? value : null;
  const percentage = displayValue !== null ? Math.min(Math.max((displayValue - min) / (max - min), 0), 1) : 0;

  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - percentage * 0.75); // 270-degree arc

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* Background arc */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
          strokeLinecap="round"
          rotation={135}
          origin={`${size / 2}, ${size / 2}`}
        />
        {/* Value arc */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={gaugeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation={135}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.valueContainer}>
        <Text style={[styles.value, { color: gaugeColor }]}>
          {displayValue !== null ? Math.round(displayValue) : '--'}
        </Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueContainer: {
    position: 'absolute',
    alignItems: 'center',
    top: '25%',
  },
  value: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.black,
  },
  unit: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
  },
  label: {
    position: 'absolute',
    bottom: 4,
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
  },
});

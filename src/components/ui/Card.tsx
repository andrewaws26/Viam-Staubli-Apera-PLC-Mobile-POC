/**
 * Card component with optional elevation and press handling.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

interface CardProps {
  children: React.ReactNode;
  elevated?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  padding?: number;
}

export default function Card({ children, elevated = false, onPress, style, padding }: CardProps) {
  const cardStyle: ViewStyle = {
    backgroundColor: elevated ? colors.cardElevated : colors.card,
    borderRadius: 16,
    padding: padding ?? spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...style,
  };

  if (onPress) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}

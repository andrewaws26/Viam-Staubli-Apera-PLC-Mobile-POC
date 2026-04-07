/**
 * Primary button component with variants, sizes, and haptic feedback.
 */

import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme/colors';
import { spacing, PREFERRED_TOUCH_TARGET } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, { bg: string; text: string; border?: string }> = {
  primary: { bg: colors.primary, text: '#ffffff' },
  secondary: { bg: colors.card, text: colors.text, border: colors.border },
  danger: { bg: colors.danger, text: '#ffffff' },
  ghost: { bg: 'transparent', text: colors.primaryLight, border: colors.primaryDark },
};

const SIZE_STYLES: Record<ButtonSize, { height: number; paddingH: number; fontSize: number }> = {
  sm: { height: 40, paddingH: spacing.md, fontSize: typography.sizes.sm },
  md: { height: 48, paddingH: spacing.lg, fontSize: typography.sizes.base },
  lg: { height: PREFERRED_TOUCH_TARGET, paddingH: spacing.xl, fontSize: typography.sizes.lg },
};

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
}: ButtonProps) {
  const v = VARIANT_STYLES[variant];
  const s = SIZE_STYLES[size];

  const handlePress = () => {
    if (loading || disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const containerStyle: ViewStyle = {
    backgroundColor: disabled ? colors.cardElevated : v.bg,
    height: s.height,
    paddingHorizontal: s.paddingH,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    opacity: disabled ? 0.5 : 1,
    borderWidth: v.border ? 1 : 0,
    borderColor: v.border,
    ...(fullWidth ? { width: '100%' as unknown as number } : {}),
  };

  const textStyle: TextStyle = {
    color: disabled ? colors.textMuted : v.text,
    fontSize: s.fontSize,
    fontWeight: typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={v.text} size="small" />
      ) : (
        <>
          {icon}
          <Text style={textStyle}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

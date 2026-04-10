/**
 * Inline network error banner with retry button.
 * Shows when API calls fail — replaces silent error swallowing.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface NetworkErrorProps {
  message?: string;
  onRetry?: () => void;
}

export default function NetworkError({ message = 'Failed to load data', onRetry }: NetworkErrorProps) {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>{'⚡'}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
      {onRetry && (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.7}>
          <Text style={styles.retryText}>RETRY</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dangerGlow,
    borderWidth: 1,
    borderColor: colors.danger + '40',
    borderRadius: 10,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  icon: {
    fontSize: 16,
  },
  message: {
    color: colors.dangerLight,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
    flex: 1,
  },
  retryButton: {
    backgroundColor: colors.danger + '30',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 6,
    marginLeft: spacing.sm,
  },
  retryText: {
    color: colors.dangerLight,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.heading,
    letterSpacing: 1,
  },
});

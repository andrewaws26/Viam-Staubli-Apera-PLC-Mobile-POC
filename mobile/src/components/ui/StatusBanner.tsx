/**
 * Online/offline/syncing status banner, shown at the top of every screen.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSyncStore } from '@/sync/sync-status';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { timeAgo } from '@/utils/format';

export default function StatusBanner() {
  const { isOnline, isSyncing, pendingCount, lastSyncAt, failedCount } = useSyncStore();

  // Don't show banner when everything is normal
  if (isOnline && !isSyncing && pendingCount === 0 && failedCount === 0) return null;

  let backgroundColor = colors.card;
  let text = '';
  let textColor = colors.textSecondary;

  if (!isOnline) {
    backgroundColor = '#d9770620';
    text = `Offline${lastSyncAt ? ` · Last sync ${timeAgo(lastSyncAt)}` : ''}`;
    textColor = colors.warningLight;
  } else if (isSyncing) {
    backgroundColor = '#7c3aed20';
    text = `Syncing ${pendingCount} item${pendingCount !== 1 ? 's' : ''}...`;
    textColor = colors.primaryLight;
  } else if (failedCount > 0) {
    backgroundColor = '#dc262620';
    text = `${failedCount} item${failedCount !== 1 ? 's' : ''} failed to sync`;
    textColor = colors.dangerLight;
  } else if (pendingCount > 0) {
    backgroundColor = '#d9770620';
    text = `${pendingCount} item${pendingCount !== 1 ? 's' : ''} pending sync`;
    textColor = colors.warningLight;
  }

  if (!text) return null;

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <Text style={[styles.text, { color: textColor }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  text: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
  },
});

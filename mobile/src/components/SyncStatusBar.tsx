/**
 * Detailed sync status display for the More tab.
 * Shows pending item breakdown and sync controls.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSyncStore } from '@/sync/sync-status';
import Button from './ui/Button';
import Card from './ui/Card';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { formatTimestamp } from '@/utils/format';
import { runSync } from '@/sync/sync-engine';

export default function SyncStatusBar() {
  const { isOnline, isSyncing, pendingCount, lastSyncAt, failedCount, pendingAiRequests } = useSyncStore();

  return (
    <Card>
      <Text style={styles.title}>Sync Status</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Connection</Text>
        <Text style={[styles.value, { color: isOnline ? colors.success : colors.warning }]}>
          {isOnline ? 'Online' : 'Offline'}
        </Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Last Sync</Text>
        <Text style={styles.value}>{lastSyncAt ? formatTimestamp(lastSyncAt) : 'Never'}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Pending Items</Text>
        <Text style={styles.value}>{pendingCount}</Text>
      </View>

      {pendingAiRequests > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>AI Requests Queued</Text>
          <Text style={[styles.value, { color: colors.primaryLight }]}>{pendingAiRequests}</Text>
        </View>
      )}

      {failedCount > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>Failed Items</Text>
          <Text style={[styles.value, { color: colors.danger }]}>{failedCount}</Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        <Button
          title={isSyncing ? 'Syncing...' : 'Sync Now'}
          onPress={() => runSync()}
          variant="secondary"
          size="sm"
          loading={isSyncing}
          disabled={!isOnline || isSyncing}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: typography.sizes.base,
    fontFamily: typography.fonts.heading,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
  },
  value: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.heading,
  },
  buttonRow: {
    marginTop: spacing.md,
  },
});

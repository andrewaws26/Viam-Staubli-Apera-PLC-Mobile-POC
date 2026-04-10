/**
 * My Timesheets — weekly timesheet list with status badges.
 * Create new, pull-to-refresh, navigate to detail.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { View, FlatList, Text, RefreshControl, StyleSheet, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTimesheetStore } from '@/stores/timesheet-store';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import NetworkError from '@/components/ui/NetworkError';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { colors } from '@/theme/colors';
import { spacing, radii } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { Timesheet, TimesheetStatus } from '@ironsight/shared/timesheet';

const STATUS_COLORS: Record<TimesheetStatus, string> = {
  draft: colors.textMuted,
  submitted: colors.infoLight,
  approved: colors.successLight,
  rejected: colors.dangerLight,
};

const STATUS_BG: Record<TimesheetStatus, string> = {
  draft: colors.surface2 + '40',
  submitted: '#2563eb20',
  approved: '#16a34a20',
  rejected: '#dc262620',
};

function formatWeekEnding(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function TimesheetRow({ item, onPress }: { item: Timesheet; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <Text style={styles.weekLabel}>Week ending</Text>
        <Text style={styles.weekDate}>{formatWeekEnding(item.week_ending)}</Text>
        {item.railroad_working_on && (
          <Text style={styles.railroad}>{item.railroad_working_on}</Text>
        )}
      </View>
      <View style={styles.rowRight}>
        <Badge
          label={item.status.toUpperCase()}
          color={STATUS_COLORS[item.status]}
          backgroundColor={STATUS_BG[item.status]}
        />
        <Text style={styles.hours}>{item.total_hours || 0}h</Text>
      </View>
    </TouchableOpacity>
  );
}

function TimesheetListInner() {
  const router = useRouter();
  const { timesheets, isLoading, error, loadTimesheets } = useTimesheetStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadTimesheets();
  }, [loadTimesheets]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTimesheets();
    setRefreshing(false);
  }, [loadTimesheets]);

  if (isLoading && timesheets.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'My Timesheets' }} />
        <LoadingState lines={5} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'My Timesheets' }} />

      {error && <NetworkError message={error} onRetry={loadTimesheets} />}

      <View style={styles.header}>
        <Button
          title="+ New Timesheet"
          onPress={() => router.push('/me/timesheets/new' as any)}
          variant="primary"
          size="md"
          fullWidth
        />
      </View>

      <FlatList
        data={timesheets}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TimesheetRow
            item={item}
            onPress={() => router.push(`/me/timesheets/${item.id}` as any)}
          />
        )}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={
          <EmptyState
            title="No timesheets yet"
            message="Tap '+ New Timesheet' to create your first weekly timesheet."
            icon="📋"
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primaryLight}
          />
        }
      />
    </View>
  );
}

export default function TimesheetListScreen() {
  return (
    <ErrorBoundary fallbackTitle="Timesheets crashed">
      <TimesheetListInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  list: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing['6xl'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  rowLeft: { flex: 1 },
  weekLabel: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.label,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
  },
  weekDate: {
    color: colors.text,
    fontSize: typography.sizes.base,
    fontFamily: typography.fonts.heading,
    marginTop: 2,
  },
  railroad: {
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.body,
    marginTop: 4,
  },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  hours: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.mono,
  },
});

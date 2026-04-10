/**
 * Timesheet Detail — view/edit a single timesheet.
 * Shows header with status + week info, daily logs, and action buttons.
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Alert,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTimesheetStore } from '@/stores/timesheet-store';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import NetworkError from '@/components/ui/NetworkError';
import LoadingState from '@/components/ui/LoadingState';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { colors } from '@/theme/colors';
import { spacing, radii } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { TimesheetStatus, TimesheetDailyLog } from '@ironsight/shared/timesheet';

const STATUS_VARIANT: Record<TimesheetStatus, 'muted' | 'info' | 'success' | 'danger'> = {
  draft: 'muted',
  submitted: 'info',
  approved: 'success',
  rejected: 'danger',
};

function formatWeekEnding(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatLogDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function DailyLogRow({ log }: { log: TimesheetDailyLog }) {
  return (
    <View style={styles.logRow}>
      <View style={styles.logLeft}>
        <Text style={styles.logDate}>{formatLogDate(log.log_date)}</Text>
        {log.description && (
          <Text style={styles.logDesc} numberOfLines={2}>{log.description}</Text>
        )}
      </View>
      <View style={styles.logRight}>
        <Text style={styles.logHours}>{log.hours_worked || 0}h</Text>
        {(log.travel_hours ?? 0) > 0 && (
          <Text style={styles.logTravel}>+{log.travel_hours}h travel</Text>
        )}
      </View>
    </View>
  );
}

function TimesheetDetailInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current, isLoading, error, loadTimesheet, submit } = useTimesheetStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (id) loadTimesheet(id);
  }, [id, loadTimesheet]);

  const onRefresh = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    await loadTimesheet(id);
    setRefreshing(false);
  }, [id, loadTimesheet]);

  const handleSubmit = () => {
    if (!current) return;
    Alert.alert(
      'Submit Timesheet',
      'Once submitted, you cannot edit until a manager reviews it. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            const ok = await submit(current.id);
            if (ok) {
              Alert.alert('Submitted', 'Your timesheet has been sent for approval.');
            }
          },
        },
      ],
    );
  };

  if (isLoading && !current) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Timesheet' }} />
        <LoadingState lines={6} />
      </View>
    );
  }

  if (!current) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Timesheet' }} />
        {error && <NetworkError message={error} onRetry={() => id && loadTimesheet(id)} />}
      </View>
    );
  }

  const dailyLogs = (current.daily_logs || []) as TimesheetDailyLog[];
  const isDraft = current.status === 'draft';
  const isRejected = current.status === 'rejected';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryLight} />
      }
    >
      <Stack.Screen options={{ title: `Week of ${formatWeekEnding(current.week_ending)}` }} />

      {error && <NetworkError message={error} onRetry={onRefresh} />}

      {/* Header Card */}
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Badge label={current.status} variant={STATUS_VARIANT[current.status]} />
          <Text style={styles.totalHours}>{current.total_hours || 0}h total</Text>
        </View>

        {current.railroad_working_on && (
          <Text style={styles.infoText}>Railroad: {current.railroad_working_on}</Text>
        )}
        {current.work_location && (
          <Text style={styles.infoText}>Location: {current.work_location}</Text>
        )}
        {(current.nights_out ?? 0) > 0 && (
          <Text style={styles.infoText}>Nights out: {current.nights_out}</Text>
        )}

        {isRejected && current.rejection_reason && (
          <View style={styles.rejectionBanner}>
            <Text style={styles.rejectionLabel}>Rejection reason:</Text>
            <Text style={styles.rejectionText}>{current.rejection_reason}</Text>
          </View>
        )}
      </View>

      {/* Daily Logs */}
      <Text style={styles.sectionTitle}>Daily Logs</Text>
      {dailyLogs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No daily logs recorded yet.</Text>
          <Text style={styles.emptyHint}>Add logs from the web dashboard to track daily hours.</Text>
        </View>
      ) : (
        <View style={styles.logsContainer}>
          {dailyLogs.map((log) => (
            <DailyLogRow key={log.id} log={log} />
          ))}
        </View>
      )}

      {/* Summary Section */}
      {(current.coworkers || current.notes) && (
        <>
          <Text style={styles.sectionTitle}>Notes</Text>
          <View style={styles.notesCard}>
            {current.coworkers && (
              <Text style={styles.infoText}>
                Co-workers: {Array.isArray(current.coworkers)
                  ? current.coworkers.map((c: any) => c.name || c).join(', ')
                  : String(current.coworkers)}
              </Text>
            )}
            {current.notes && <Text style={styles.notesText}>{current.notes}</Text>}
          </View>
        </>
      )}

      {/* Actions */}
      {(isDraft || isRejected) && (
        <View style={styles.actions}>
          <Button
            title="Submit for Approval"
            onPress={handleSubmit}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      )}
    </ScrollView>
  );
}

export default function TimesheetDetailScreen() {
  return (
    <ErrorBoundary fallbackTitle="Timesheet detail crashed">
      <TimesheetDetailInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing['6xl'] },
  headerCard: {
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalHours: {
    color: colors.text,
    fontSize: typography.sizes.lg,
    fontFamily: typography.fonts.mono,
  },
  infoText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
  },
  rejectionBanner: {
    marginTop: spacing.sm,
    backgroundColor: colors.dangerGlow,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  rejectionLabel: {
    color: colors.dangerLight,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.heading,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
  },
  rejectionText: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.heading,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  logsContainer: {
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  logLeft: { flex: 1, marginRight: spacing.md },
  logDate: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.heading,
  },
  logDesc: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.body,
    marginTop: 2,
  },
  logRight: { alignItems: 'flex-end' },
  logHours: {
    color: colors.text,
    fontSize: typography.sizes.base,
    fontFamily: typography.fonts.mono,
  },
  logTravel: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.body,
  },
  emptyCard: {
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.body,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  notesCard: {
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  notesText: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
    lineHeight: typography.sizes.sm * 1.5,
  },
  actions: { marginTop: spacing['3xl'] },
});

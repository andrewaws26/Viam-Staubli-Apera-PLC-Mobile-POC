/**
 * PTO Requests — view balance, list requests, create new.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { fetchPtoRequests, fetchPtoBalance } from '@/services/api-client';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import NetworkError from '@/components/ui/NetworkError';
import LoadingState from '@/components/ui/LoadingState';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import { colors } from '@/theme/colors';
import { spacing, radii } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface PtoBalance {
  vacation_hours: number;
  sick_hours: number;
  personal_hours: number;
}

interface PtoRequest {
  id: string;
  type: 'vacation' | 'sick' | 'personal';
  start_date: string;
  end_date: string;
  hours: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason?: string;
  created_at: string;
}

const STATUS_VARIANT: Record<string, 'muted' | 'info' | 'success' | 'danger' | 'warning'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'muted',
};

const TYPE_LABELS: Record<string, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  personal: 'Personal',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function BalanceCard({ balance }: { balance: PtoBalance }) {
  return (
    <View style={styles.balanceRow}>
      <BalanceItem label="Vacation" hours={balance.vacation_hours} color={colors.infoLight} />
      <BalanceItem label="Sick" hours={balance.sick_hours} color={colors.warningLight} />
      <BalanceItem label="Personal" hours={balance.personal_hours} color={colors.primaryLight} />
    </View>
  );
}

function BalanceItem({ label, hours, color }: { label: string; hours: number; color: string }) {
  return (
    <View style={styles.balanceItem}>
      <Text style={[styles.balanceHours, { color }]}>{hours}h</Text>
      <Text style={styles.balanceLabel}>{label}</Text>
    </View>
  );
}

function PtoRow({ item }: { item: PtoRequest }) {
  const dateRange = item.start_date === item.end_date
    ? formatDate(item.start_date)
    : `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`;

  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowType}>{TYPE_LABELS[item.type] || item.type}</Text>
        <Text style={styles.rowDates}>{dateRange}</Text>
        {item.reason && <Text style={styles.rowReason} numberOfLines={1}>{item.reason}</Text>}
      </View>
      <View style={styles.rowRight}>
        <Badge label={item.status} variant={STATUS_VARIANT[item.status] || 'muted'} small />
        <Text style={styles.rowHours}>{item.hours}h</Text>
      </View>
    </View>
  );
}

function PtoScreenInner() {
  const [balance, setBalance] = useState<PtoBalance | null>(null);
  const [requests, setRequests] = useState<PtoRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    const [balRes, reqRes] = await Promise.all([fetchPtoBalance(), fetchPtoRequests()]);
    if (balRes.error) {
      setError(balRes.error);
    } else if (balRes.data) {
      setBalance(balRes.data as unknown as PtoBalance);
    }
    if (reqRes.data) {
      setRequests((reqRes.data as unknown as PtoRequest[]) || []);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Time Off' }} />
        <LoadingState lines={4} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Time Off' }} />

      {error && <NetworkError message={error} onRetry={loadData} />}

      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PtoRow item={item} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={
          <>
            {balance && <BalanceCard balance={balance} />}
            <Text style={styles.sectionTitle}>Requests</Text>
          </>
        }
        ListEmptyComponent={
          <EmptyState
            title="No PTO requests"
            message="Your time-off requests will appear here."
            icon="🏖️"
          />
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryLight} />
        }
      />
    </View>
  );
}

export default function PtoScreen() {
  return (
    <ErrorBoundary fallbackTitle="PTO screen crashed">
      <PtoScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg, paddingBottom: spacing['6xl'] },
  balanceRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  balanceItem: { flex: 1, alignItems: 'center' },
  balanceHours: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.fonts.mono,
  },
  balanceLabel: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.label,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.heading,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
    marginBottom: spacing.md,
  },
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
  rowType: {
    color: colors.text,
    fontSize: typography.sizes.base,
    fontFamily: typography.fonts.heading,
  },
  rowDates: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
    marginTop: 2,
  },
  rowReason: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.body,
    marginTop: 2,
  },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  rowHours: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.mono,
  },
});

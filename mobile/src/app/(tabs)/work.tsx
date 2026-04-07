/**
 * Work tab — shop floor task board.
 * Board view: all work orders grouped by status columns.
 * My Work view: assigned to current user + unassigned backlog.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, ScrollView, FlatList, RefreshControl, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppAuth } from '@/auth/auth-provider';
import { useWorkStore } from '@/stores/work-store';
import { useFleetStore } from '@/stores/fleet-store';
import { canManageFleet } from '@/types/auth';
import WorkOrderCard from '@/components/WorkOrderCard';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { WorkOrder, WorkOrderStatus } from '@/types/work-order';

const STATUS_ORDER: WorkOrderStatus[] = ['open', 'in_progress', 'blocked', 'done'];
const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
};
const STATUS_COLORS: Record<WorkOrderStatus, string> = {
  open: colors.textMuted,
  in_progress: colors.warningLight,
  blocked: colors.dangerLight,
  done: colors.successLight,
};

export default function WorkScreen() {
  const router = useRouter();
  const { currentUser } = useAppAuth();
  const { workOrders, isLoading, loadWorkOrders, viewMode, setViewMode } = useWorkStore();
  const [refreshing, setRefreshing] = useState(false);

  const isManager = currentUser && (canManageFleet(currentUser.role) || currentUser.role === 'mechanic');

  useEffect(() => {
    loadWorkOrders();
    const interval = setInterval(loadWorkOrders, 30000);
    return () => clearInterval(interval);
  }, [loadWorkOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadWorkOrders();
    setRefreshing(false);
  }, [loadWorkOrders]);

  const handleViewChange = useCallback((index: number) => {
    setViewMode(index === 0 ? 'board' : 'my_work');
  }, [setViewMode]);

  // Group work orders by status for board view
  const grouped = useMemo(() => {
    const groups: Record<WorkOrderStatus, WorkOrder[]> = {
      open: [], in_progress: [], blocked: [], done: [],
    };
    for (const wo of workOrders) {
      groups[wo.status]?.push(wo);
    }
    return groups;
  }, [workOrders]);

  // Filter for "My Work" — only work explicitly assigned to current user
  const myWork = useMemo(() => {
    if (!currentUser) return [];
    return workOrders.filter(
      (wo) => wo.status !== 'done' && wo.assigned_to === currentUser.id,
    );
  }, [workOrders, currentUser]);

  if (isLoading && workOrders.length === 0) {
    return <LoadingState lines={4} />;
  }

  return (
    <View style={styles.container}>
      {/* Header controls */}
      <View style={styles.topBar}>
        <View style={styles.segmentedWrapper}>
          <SegmentedControl
            options={['Board', 'My Work']}
            selectedIndex={viewMode === 'board' ? 0 : 1}
            onChange={handleViewChange}
          />
        </View>

        {/* Create button — only for mechanic+ roles */}
        {isManager && (
          <View style={styles.createRow}>
            <Button
              title="+ New Work Order"
              onPress={() => router.push('/work-order/create')}
              variant="primary"
              size="md"
              fullWidth
            />
          </View>
        )}
      </View>

      {viewMode === 'board' ? (
        <BoardView
          grouped={grouped}
          onPress={(wo) => router.push(`/work-order/${wo.id}`)}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      ) : (
        <MyWorkView
          workOrders={myWork}
          onPress={(wo) => router.push(`/work-order/${wo.id}`)}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}
    </View>
  );
}

/** Board view: horizontally scrollable status columns */
function BoardView({
  grouped,
  onPress,
  refreshing,
  onRefresh,
}: {
  grouped: Record<WorkOrderStatus, WorkOrder[]>;
  onPress: (wo: WorkOrder) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <ScrollView
      horizontal
      pagingEnabled={false}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.boardContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {STATUS_ORDER.map((status) => (
        <View key={status} style={styles.column}>
          {/* Column header */}
          <View style={styles.columnHeader}>
            <View style={[styles.columnDot, { backgroundColor: STATUS_COLORS[status] }]} />
            <Text style={styles.columnTitle}>{STATUS_LABELS[status]}</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{grouped[status].length}</Text>
            </View>
          </View>

          {/* Cards */}
          <ScrollView style={styles.columnScroll} showsVerticalScrollIndicator={false}>
            {grouped[status].length > 0 ? (
              grouped[status].map((wo) => (
                <View key={wo.id} style={styles.cardWrapper}>
                  <WorkOrderCard workOrder={wo} onPress={() => onPress(wo)} />
                </View>
              ))
            ) : (
              <Text style={styles.emptyColumn}>No items</Text>
            )}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );
}

/** My Work view: flat list of assigned + backlog items */
function MyWorkView({
  workOrders,
  onPress,
  refreshing,
  onRefresh,
}: {
  workOrders: WorkOrder[];
  onPress: (wo: WorkOrder) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <FlatList
      data={workOrders}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <WorkOrderCard workOrder={item} onPress={() => onPress(item)} showStatus />
      )}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      ListEmptyComponent={
        <EmptyState
          title="No work assigned"
          message="Work orders assigned to you or available to pick up will appear here."
          icon="📋"
        />
      }
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  segmentedWrapper: {
    paddingHorizontal: spacing.lg,
  },
  createRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  // Board view
  boardContainer: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing['5xl'],
    gap: spacing.sm,
  },
  column: {
    width: 280,
    flex: 1,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  columnDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  columnTitle: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.bold as any,
  },
  countBadge: {
    backgroundColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: typography.weights.bold as any,
  },
  columnScroll: {
    flex: 1,
  },
  cardWrapper: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  emptyColumn: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  // My Work view
  list: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
});

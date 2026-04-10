/**
 * Fleet Overview — Industrial Command Center home screen.
 * Shows fleet status summary header + truck cards with staggered animations.
 * Operators see only assigned trucks. Pull-to-refresh for live data.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, FlatList, RefreshControl, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAppAuth } from '@/auth/auth-provider';
import { useFleetStore } from '@/stores/fleet-store';
import { fetchFleetTrucks, fetchFleetStatus } from '@/services/api-client';
import TruckStatusCard from '@/components/TruckStatusCard';
import FleetMapView from '@/components/FleetMapView';
import SegmentedControl from '@/components/ui/SegmentedControl';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import NetworkError from '@/components/ui/NetworkError';
import { colors } from '@/theme/colors';
import { spacing, radii } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { canSeeAllTrucks } from '@/types/auth';
import type { TruckSensorReadings } from '@/types/sensor';

/** Fleet status summary pill */
function StatusPill({
  count,
  label,
  color,
  glowBg,
}: {
  count: number;
  label: string;
  color: string;
  glowBg: string;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: glowBg }]}>
      <Text style={[styles.pillCount, { color }]}>{count}</Text>
      <Text style={[styles.pillLabel, { color }]}>{label}</Text>
    </View>
  );
}

function FleetScreenInner() {
  const router = useRouter();
  const { currentUser } = useAppAuth();
  const { trucks, setTrucks, readings, readingsUpdatedAt, updateReadings, isLoading, setLoading } = useFleetStore();
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadFleet = useCallback(async () => {
    setLoading(true);
    try {
      const [trucksResult, statusResult] = await Promise.all([
        fetchFleetTrucks(),
        fetchFleetStatus(),
      ]);

      if (Array.isArray(trucksResult.data)) {
        setTrucks(trucksResult.data as any[]);
      }

      if (statusResult.data?.trucks) {
        for (const t of statusResult.data.trucks as any[]) {
          if (t.id) {
            const { id, name, lastSeen, connected, assignedPersonnel, ...rest } = t;
            updateReadings(t.id, rest as TruckSensorReadings);
          }
        }
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fleet data');
    } finally {
      setLoading(false);
    }
  }, [setTrucks, updateReadings, setLoading]);

  useEffect(() => {
    loadFleet();
    const interval = setInterval(loadFleet, 30000);
    return () => clearInterval(interval);
  }, [loadFleet]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFleet();
    setRefreshing(false);
  }, [loadFleet]);

  // Filter trucks by role
  const visibleTrucks = currentUser && !canSeeAllTrucks(currentUser.role)
    ? trucks.filter((t) => currentUser.assignedTruckIds.includes(t.id))
    : trucks;

  // Fleet summary counts
  const runningCount = visibleTrucks.filter((t) => {
    const r = readings[t.id];
    return r?.engine_rpm && r.engine_rpm > 0;
  }).length;
  const alertCount = visibleTrucks.filter((t) => {
    const r = readings[t.id];
    return r?.active_dtc_count && r.active_dtc_count > 0;
  }).length;
  const idleCount = visibleTrucks.length - runningCount - alertCount;

  const handleTruckPress = useCallback((truckId: string) => {
    useFleetStore.getState().selectTruck(truckId);
    router.push(`/truck/${truckId}`);
  }, [router]);

  if (isLoading && trucks.length === 0) {
    return <LoadingState lines={6} />;
  }

  return (
    <View style={styles.container}>
      {error && <NetworkError message={error} onRetry={loadFleet} />}
      {/* Summary header with gradient */}
      <Animated.View entering={FadeInDown.duration(400)}>
        <LinearGradient
          colors={[colors.surface0, colors.background]}
          style={styles.summaryHeader}
        >
          {/* View mode toggle */}
          <View style={styles.segmentRow}>
            <SegmentedControl options={['List', 'Map']} selectedIndex={viewMode} onChange={setViewMode} />
          </View>

          {/* Status pills */}
          <View style={styles.pillRow}>
            <StatusPill count={runningCount} label="Running" color={colors.successLight} glowBg={colors.successGlow} />
            <StatusPill count={idleCount} label="Idle" color={colors.warningLight} glowBg={colors.warningGlow} />
            {alertCount > 0 && (
              <StatusPill count={alertCount} label="Alert" color={colors.dangerLight} glowBg={colors.dangerGlow} />
            )}
            <StatusPill count={visibleTrucks.length} label="Total" color={colors.textMuted} glowBg={colors.surface1 + '80'} />
          </View>
        </LinearGradient>
      </Animated.View>

      {viewMode === 0 ? (
        <FlatList
          data={visibleTrucks}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <TruckStatusCard
              name={item.name}
              truckId={item.id}
              readings={readings[item.id] || null}
              updatedAt={readingsUpdatedAt[item.id] || null}
              onPress={() => handleTruckPress(item.id)}
              index={index}
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListEmptyComponent={
            <EmptyState
              title="No trucks found"
              message="Check your connection or contact your fleet manager."
              icon="🚛"
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primaryLight}
              colors={[colors.primaryLight]}
            />
          }
        />
      ) : (
        <FleetMapView
          trucks={visibleTrucks}
          readings={readings}
          onTruckPress={handleTruckPress}
        />
      )}
    </View>
  );
}

export default function FleetScreen() {
  return (
    <ErrorBoundary fallbackTitle="Fleet screen crashed">
      <FleetScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  summaryHeader: {
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  segmentRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.full,
  },
  pillCount: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.monoBold,
  },
  pillLabel: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.label,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing['6xl'],
  },
});

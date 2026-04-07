/**
 * Fleet Overview — home screen showing all trucks at a glance.
 * Operators see only assigned trucks. Pull-to-refresh updates all readings.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, FlatList, RefreshControl, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppAuth } from '@/auth/auth-provider';
import { useFleetStore } from '@/stores/fleet-store';
import { fetchFleetTrucks, fetchFleetStatus } from '@/services/api-client';
import TruckStatusCard from '@/components/TruckStatusCard';
import FleetMapView from '@/components/FleetMapView';
import SegmentedControl from '@/components/ui/SegmentedControl';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { canSeeAllTrucks } from '@/types/auth';
import type { TruckSensorReadings } from '@/types/sensor';

export default function FleetScreen() {
  const router = useRouter();
  const { currentUser } = useAppAuth();
  const { trucks, setTrucks, readings, readingsUpdatedAt, updateReadings, isLoading, setLoading } = useFleetStore();
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState(0); // 0 = List, 1 = Map

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
            // Status endpoint returns readings inline (engineRpm, coolantTempF, etc.)
            const { id, name, lastSeen, connected, assignedPersonnel, ...readings } = t;
            updateReadings(t.id, readings as TruckSensorReadings);
          }
        }
      }
    } catch (err) {
      console.error('[Fleet]', err);
    } finally {
      setLoading(false);
    }
  }, [setTrucks, updateReadings, setLoading]);

  useEffect(() => {
    loadFleet();
    // Refresh every 30 seconds
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

  if (isLoading && trucks.length === 0) {
    return <LoadingState lines={6} />;
  }

  const handleTruckPress = useCallback((truckId: string) => {
    useFleetStore.getState().selectTruck(truckId);
    router.push(`/truck/${truckId}`);
  }, [router]);

  return (
    <View style={styles.container}>
      {/* View mode toggle + summary bar */}
      <View style={styles.topBar}>
        <View style={styles.segmentedWrapper}>
          <SegmentedControl options={['List', 'Map']} selectedIndex={viewMode} onChange={setViewMode} />
        </View>
        <View style={styles.summaryBar}>
          <View style={[styles.pill, { backgroundColor: '#16a34a20' }]}>
            <Text style={[styles.pillText, { color: colors.successLight }]}>{runningCount} Running</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: '#d9770620' }]}>
            <Text style={[styles.pillText, { color: colors.warningLight }]}>{visibleTrucks.length - runningCount - alertCount} Idle</Text>
          </View>
          {alertCount > 0 && (
            <View style={[styles.pill, { backgroundColor: '#dc262620' }]}>
              <Text style={[styles.pillText, { color: colors.dangerLight }]}>{alertCount} Alert</Text>
            </View>
          )}
          <View style={[styles.pill, { backgroundColor: '#6b728020' }]}>
            <Text style={[styles.pillText, { color: colors.textMuted }]}>{visibleTrucks.length} Total</Text>
          </View>
        </View>
      </View>

      {viewMode === 0 ? (
        <FlatList
          data={visibleTrucks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TruckStatusCard
              name={item.name}
              truckId={item.id}
              readings={readings[item.id] || null}
              updatedAt={readingsUpdatedAt[item.id] || null}
              onPress={() => handleTruckPress(item.id)}
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
              tintColor={colors.primary}
              colors={[colors.primary]}
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
  summaryBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 20,
  },
  pillText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.bold,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
});

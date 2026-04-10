/**
 * Truck Detail tab — live gauges, DTCs, lamp indicators, quick actions.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, RefreshControl, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFleetStore } from '@/stores/fleet-store';
import { fetchTruckReadings } from '@/services/api-client';
import TruckSelector from '@/components/TruckSelector';
import GaugeCircular from '@/components/ui/GaugeCircular';
import GaugeBar from '@/components/ui/GaugeBar';
import LampIndicators from '@/components/LampIndicators';
import DTCBadge from '@/components/DTCBadge';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import NetworkError from '@/components/ui/NetworkError';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { formatValue, timeAgo } from '@/utils/format';
import type { TruckSensorReadings } from '@/types/sensor';

function TruckScreenInner() {
  const router = useRouter();
  const { trucks, selectedTruckId, selectTruck, readings, readingsUpdatedAt, updateReadings } = useFleetStore();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const truckId = selectedTruckId || trucks[0]?.id;
  const truckReadings = truckId ? readings[truckId] : null;
  const updatedAt = truckId ? readingsUpdatedAt[truckId] : null;

  const loadReadings = useCallback(async () => {
    if (!truckId) return;
    try {
      const result = await fetchTruckReadings(truckId);
      if (result.data?.readings) {
        updateReadings(truckId, result.data.readings as TruckSensorReadings);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load truck data');
    }
  }, [truckId, updateReadings]);

  useEffect(() => {
    loadReadings();
    const interval = setInterval(loadReadings, 30000);
    return () => clearInterval(interval);
  }, [loadReadings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadReadings();
    setRefreshing(false);
  }, [loadReadings]);

  // Extract DTCs
  const dtcs: { spn: number; fmi: number; ecuLabel: string }[] = [];
  if (truckReadings) {
    const ecus = ['engine', 'trans', 'abs', 'acm', 'body', 'inst'];
    const ecuLabels: Record<string, string> = { engine: 'Engine', trans: 'Trans', abs: 'ABS', acm: 'ACM', body: 'Body', inst: 'Inst' };
    for (const ecu of ecus) {
      const count = (truckReadings as any)[`dtc_${ecu}_count`] || 0;
      for (let i = 0; i < count; i++) {
        const spn = (truckReadings as any)[`dtc_${ecu}_${i}_spn`];
        const fmi = (truckReadings as any)[`dtc_${ecu}_${i}_fmi`];
        if (spn !== undefined) {
          dtcs.push({ spn, fmi: fmi ?? 0, ecuLabel: ecuLabels[ecu] || ecu });
        }
      }
    }
  }

  if (!truckId) {
    return <EmptyState title="No truck selected" message="Select a truck from the Fleet tab." icon="🚛" />;
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <TruckSelector trucks={trucks} selectedId={truckId} onSelect={selectTruck} />
      {error && <NetworkError message={error} onRetry={loadReadings} />}

      {updatedAt && (
        <Text style={styles.updated}>Updated {timeAgo(new Date(updatedAt).toISOString())}</Text>
      )}

      {/* Gauges */}
      <View style={styles.gaugeRow}>
        <GaugeCircular label="RPM" value={truckReadings?.engine_rpm} unit="" min={0} max={2500} gaugeKey="engine_rpm" size={110} />
        <GaugeCircular label="Coolant" value={truckReadings?.coolant_temp_f} unit="°F" min={100} max={260} gaugeKey="coolant_temp_f" size={110} />
        <GaugeCircular label="Oil PSI" value={truckReadings?.oil_pressure_psi} unit="psi" min={0} max={80} gaugeKey="oil_pressure_psi" size={110} />
      </View>

      {/* Status grid */}
      <View style={styles.grid}>
        <Card style={styles.gridItem}>
          <Text style={styles.gridLabel}>Speed</Text>
          <Text style={styles.gridValue}>{formatValue(truckReadings?.vehicle_speed_mph, 'mph')}</Text>
        </Card>
        <Card style={styles.gridItem}>
          <Text style={styles.gridLabel}>Battery</Text>
          <Text style={styles.gridValue}>{formatValue(truckReadings?.battery_voltage_v, 'V', 1)}</Text>
        </Card>
        <Card style={styles.gridItem}>
          <Text style={styles.gridLabel}>Engine Hrs</Text>
          <Text style={styles.gridValue}>{formatValue(truckReadings?.engine_hours, '', 0)}</Text>
        </Card>
        <Card style={styles.gridItem}>
          <Text style={styles.gridLabel}>Boost</Text>
          <Text style={styles.gridValue}>{formatValue(truckReadings?.boost_pressure_psi, 'psi')}</Text>
        </Card>
      </View>

      {/* Fuel and DEF bars */}
      <Card>
        <GaugeBar label="Fuel Level" value={truckReadings?.fuel_level_pct} gaugeKey="fuel_level_pct" />
        <View style={{ height: spacing.md }} />
        <GaugeBar label="DEF Level" value={truckReadings?.def_level_pct} gaugeKey="def_level_pct" />
        <View style={{ height: spacing.md }} />
        <GaugeBar label="DPF Soot" value={truckReadings?.dpf_soot_load_pct} gaugeKey="dpf_soot_load_pct" />
      </Card>

      {/* Lamp indicators */}
      {truckReadings && (
        <Card>
          <Text style={styles.sectionTitle}>Lamp Status</Text>
          <LampIndicators readings={truckReadings} />
        </Card>
      )}

      {/* Active DTCs */}
      {dtcs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active DTCs ({dtcs.length})</Text>
          {dtcs.map((dtc, i) => (
            <DTCBadge
              key={`${dtc.spn}-${dtc.fmi}-${i}`}
              spn={dtc.spn}
              fmi={dtc.fmi}
              ecuLabel={dtc.ecuLabel}
              onAskAI={() => router.push(`/ai/chat/${truckId}`)}
            />
          ))}
        </View>
      )}

      {/* Quick actions */}
      <View style={styles.actions}>
        <Button title="Add Note" onPress={() => router.push('/(tabs)/more')} variant="secondary" size="md" />
        <Button title="Start Inspection" onPress={() => router.push('/(tabs)/inspect')} variant="secondary" size="md" />
        <Button title="Ask AI" onPress={() => router.push('/(tabs)/ai')} variant="primary" size="md" />
      </View>

      <View style={{ height: spacing['5xl'] }} />
    </ScrollView>
  );
}

export default function TruckScreen() {
  return (
    <ErrorBoundary fallbackTitle="Truck screen crashed">
      <TruckScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  updated: { color: colors.textMuted, fontSize: typography.sizes.xs, textAlign: 'center', paddingVertical: spacing.xs },
  gaugeRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.lg, gap: spacing.md },
  gridItem: { width: '47%' as any, alignItems: 'center' as any, padding: spacing.md },
  gridLabel: { color: colors.textMuted, fontSize: typography.sizes.xs },
  gridValue: { color: colors.text, fontSize: typography.sizes.lg, fontWeight: typography.weights.bold as any, marginTop: 4 },
  section: { padding: spacing.lg, gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: typography.sizes.base, fontWeight: typography.weights.bold as any, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', padding: spacing.lg, gap: spacing.md },
});

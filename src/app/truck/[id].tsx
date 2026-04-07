/**
 * Truck detail screen — navigated from fleet overview.
 * Same content as the Truck tab but for a specific truck.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { ScrollView, RefreshControl, View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useFleetStore } from '@/stores/fleet-store';
import { fetchTruckReadings } from '@/services/api-client';
import GaugeCircular from '@/components/ui/GaugeCircular';
import GaugeBar from '@/components/ui/GaugeBar';
import LampIndicators from '@/components/LampIndicators';
import DTCBadge from '@/components/DTCBadge';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { formatValue, timeAgo } from '@/utils/format';
import type { TruckSensorReadings } from '@/types/sensor';

export default function TruckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { trucks, readings, readingsUpdatedAt, updateReadings } = useFleetStore();
  const [refreshing, setRefreshing] = useState(false);

  const truck = trucks.find((t) => t.id === id);
  const truckReadings = id ? readings[id] : null;
  const updatedAt = id ? readingsUpdatedAt[id] : null;

  const loadReadings = useCallback(async () => {
    if (!id) return;
    const result = await fetchTruckReadings(id);
    if (result.data?.readings) {
      updateReadings(id, result.data.readings as TruckSensorReadings);
    }
  }, [id, updateReadings]);

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
    const ecus = ['engine', 'trans', 'abs', 'acm', 'body', 'inst'] as const;
    const ecuLabels: Record<string, string> = { engine: 'Engine', trans: 'Trans', abs: 'ABS', acm: 'ACM', body: 'Body', inst: 'Inst' };
    for (const ecu of ecus) {
      const count = (truckReadings as Record<string, unknown>)[`dtc_${ecu}_count`] as number || 0;
      for (let i = 0; i < count; i++) {
        const spn = (truckReadings as Record<string, unknown>)[`dtc_${ecu}_${i}_spn`] as number;
        const fmi = (truckReadings as Record<string, unknown>)[`dtc_${ecu}_${i}_fmi`] as number;
        if (spn !== undefined) {
          dtcs.push({ spn, fmi: fmi ?? 0, ecuLabel: ecuLabels[ecu] });
        }
      }
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerTitle: truck?.name || `Truck ${id}`, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {updatedAt && (
          <Text style={styles.updated}>Updated {timeAgo(new Date(updatedAt).toISOString())}</Text>
        )}

        <View style={styles.gaugeRow}>
          <GaugeCircular label="RPM" value={truckReadings?.engine_rpm} unit="" min={0} max={2500} gaugeKey="engine_rpm" size={110} />
          <GaugeCircular label="Coolant" value={truckReadings?.coolant_temp_f} unit="°F" min={100} max={260} gaugeKey="coolant_temp_f" size={110} />
          <GaugeCircular label="Oil PSI" value={truckReadings?.oil_pressure_psi} unit="psi" min={0} max={80} gaugeKey="oil_pressure_psi" size={110} />
        </View>

        <Card style={{ marginHorizontal: spacing.lg }}>
          <GaugeBar label="Fuel Level" value={truckReadings?.fuel_level_pct} gaugeKey="fuel_level_pct" />
          <View style={{ height: spacing.md }} />
          <GaugeBar label="DEF Level" value={truckReadings?.def_level_pct} gaugeKey="def_level_pct" />
          <View style={{ height: spacing.md }} />
          <GaugeBar label="DPF Soot" value={truckReadings?.dpf_soot_load_pct} gaugeKey="dpf_soot_load_pct" />
        </Card>

        {truckReadings && (
          <Card style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }}>
            <Text style={styles.sectionTitle}>Lamp Status</Text>
            <LampIndicators readings={truckReadings} />
          </Card>
        )}

        {dtcs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active DTCs ({dtcs.length})</Text>
            {dtcs.map((dtc, i) => (
              <DTCBadge key={`${dtc.spn}-${dtc.fmi}-${i}`} spn={dtc.spn} fmi={dtc.fmi} ecuLabel={dtc.ecuLabel}
                onAskAI={() => router.push(`/ai/chat/${id}`)} />
            ))}
          </View>
        )}

        <View style={styles.actions}>
          <Button title="Ask AI" onPress={() => router.push(`/ai/chat/${id}`)} variant="primary" size="lg" fullWidth />
        </View>

        <View style={{ height: spacing['5xl'] }} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  updated: { color: colors.textMuted, fontSize: typography.sizes.xs, textAlign: 'center', paddingVertical: spacing.xs },
  gaugeRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.lg },
  section: { padding: spacing.lg, gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: typography.sizes.base, fontWeight: typography.weights.bold as any, marginBottom: spacing.sm },
  actions: { padding: spacing.lg },
});

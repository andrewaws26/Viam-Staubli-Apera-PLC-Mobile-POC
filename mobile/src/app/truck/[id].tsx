/**
 * Truck detail screen — navigated from fleet overview.
 * Same content as the Truck tab but for a specific truck.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { ScrollView, RefreshControl, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useFleetStore } from '@/stores/fleet-store';
import { apiRequest, fetchTruckReadings } from '@/services/api-client';
import GaugeCircular from '@/components/ui/GaugeCircular';
import GaugeBar from '@/components/ui/GaugeBar';
import LampIndicators from '@/components/LampIndicators';
import DTCBadge from '@/components/DTCBadge';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { formatValue, timeAgo } from '@/utils/format';
import type { TruckSensorReadings } from '@/types/sensor';
import type { WorkOrder } from '@/types/work-order';

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

        {/* Work Orders for this truck */}
        {id && <TruckWorkOrdersSection truckId={id} router={router} />}

        <View style={styles.actions}>
          <Button title="Ask AI" onPress={() => router.push(`/ai/chat/${id}`)} variant="primary" size="lg" fullWidth />
        </View>

        <View style={{ height: spacing['5xl'] }} />
      </ScrollView>
    </>
  );
}

// ── Work Orders Section ─────────────────────────────────────────────

const WO_STATUS_COLORS: Record<string, string> = {
  open: colors.textMuted,
  in_progress: '#f59e0b',
  blocked: colors.danger,
  done: colors.success,
};

function TruckWorkOrdersSection({ truckId, router }: { truckId: string; router: ReturnType<typeof useRouter> }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await apiRequest<WorkOrder[]>(`/api/work-orders?truck_id=${encodeURIComponent(truckId)}`);
      if (data) setWorkOrders(data as unknown as WorkOrder[]);
      setLoading(false);
    })();
  }, [truckId]);

  if (loading) {
    return (
      <View style={woStyles.container}>
        <Text style={woStyles.title}>Work Orders</Text>
        <ActivityIndicator size="small" color={colors.textMuted} />
      </View>
    );
  }

  const active = workOrders.filter((wo) => wo.status !== 'done');
  const completed = workOrders.filter((wo) => wo.status === 'done');

  if (workOrders.length === 0) {
    return (
      <View style={woStyles.container}>
        <Text style={woStyles.title}>Work Orders</Text>
        <Text style={woStyles.empty}>No work orders for this truck.</Text>
      </View>
    );
  }

  return (
    <View style={woStyles.container}>
      <Text style={woStyles.title}>
        Work Orders{active.length > 0 ? ` (${active.length} active)` : ''}
      </Text>

      {active.map((wo) => (
        <TouchableOpacity
          key={wo.id}
          style={woStyles.card}
          onPress={() => router.push(`/work-order/${wo.id}`)}
          activeOpacity={0.7}
        >
          <View style={woStyles.cardHeader}>
            <View style={[woStyles.dot, { backgroundColor: WO_STATUS_COLORS[wo.status] }]} />
            <Text style={woStyles.cardTitle} numberOfLines={1}>{wo.title}</Text>
          </View>
          <View style={woStyles.cardMeta}>
            <Text style={woStyles.metaText}>
              {wo.status === 'in_progress' ? 'In Progress' : wo.status === 'blocked' ? 'Blocked' : 'Open'}
            </Text>
            {wo.assigned_to_name && (
              <Text style={woStyles.metaText}>→ {wo.assigned_to_name}</Text>
            )}
            {wo.priority === 'urgent' && (
              <Badge label="URGENT" variant="danger" small />
            )}
          </View>
          {wo.status === 'blocked' && wo.blocker_reason && (
            <Text style={woStyles.blocker}>{wo.blocker_reason}</Text>
          )}
        </TouchableOpacity>
      ))}

      {completed.length > 0 && (
        <>
          <TouchableOpacity onPress={() => setShowCompleted(!showCompleted)}>
            <Text style={woStyles.historyToggle}>
              {showCompleted ? '▼' : '▶'} Completed ({completed.length})
            </Text>
          </TouchableOpacity>
          {showCompleted && completed.map((wo) => (
            <TouchableOpacity
              key={wo.id}
              style={[woStyles.card, { opacity: 0.6 }]}
              onPress={() => router.push(`/work-order/${wo.id}`)}
              activeOpacity={0.7}
            >
              <View style={woStyles.cardHeader}>
                <View style={[woStyles.dot, { backgroundColor: colors.success }]} />
                <Text style={[woStyles.cardTitle, { textDecorationLine: 'line-through', color: colors.textMuted }]} numberOfLines={1}>
                  {wo.title}
                </Text>
              </View>
              <View style={woStyles.cardMeta}>
                <Text style={woStyles.metaText}>Done</Text>
                {wo.assigned_to_name && (
                  <Text style={woStyles.metaText}>by {wo.assigned_to_name}</Text>
                )}
                {wo.completed_at && (
                  <Text style={woStyles.metaText}>{new Date(wo.completed_at).toLocaleDateString()}</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}
    </View>
  );
}

const woStyles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  title: { color: colors.text, fontSize: typography.sizes.base, fontWeight: typography.weights.bold as any, marginBottom: spacing.xs },
  empty: { color: colors.textMuted, fontSize: typography.sizes.sm },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { color: colors.text, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold as any, flex: 1 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4, marginLeft: 16 },
  metaText: { color: colors.textMuted, fontSize: typography.sizes.xs },
  blocker: { color: colors.dangerLight, fontSize: typography.sizes.xs, marginTop: 4, marginLeft: 16, fontStyle: 'italic' },
  historyToggle: { color: colors.textMuted, fontSize: typography.sizes.xs, marginTop: spacing.xs },
});

// ── Main Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  updated: { color: colors.textMuted, fontSize: typography.sizes.xs, textAlign: 'center', paddingVertical: spacing.xs },
  gaugeRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.lg },
  section: { padding: spacing.lg, gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: typography.sizes.base, fontWeight: typography.weights.bold as any, marginBottom: spacing.sm },
  actions: { padding: spacing.lg },
});

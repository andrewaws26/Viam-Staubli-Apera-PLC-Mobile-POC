/**
 * Cell Monitoring tab — live Staubli robot, Apera vision, and cell watchdog.
 * Polls /api/cell-readings every 3 seconds and displays:
 *   - Overall cell health status with alert counts
 *   - Staubli TX2-140 robot arm temperatures, safety, position, production
 *   - Apera Vue AI vision pipeline, detections, calibration, GPU health
 *   - Cell network device reachability
 *
 * Data source: Pi 5 on cell network polls Staubli REST API + Apera socket,
 * pushes to Viam Cloud. Dashboard API returns latest readings.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, RefreshControl, Text, StyleSheet } from 'react-native';
import { fetchCellReadings } from '@/services/api-client';
import Card from '@/components/ui/Card';
import GaugeBar from '@/components/ui/GaugeBar';
import Badge from '@/components/ui/Badge';
import LoadingState from '@/components/ui/LoadingState';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

// ---------------------------------------------------------------------------
// Types (mirror CellTypes.ts from dashboard — kept inline to avoid shared pkg dep)
// ---------------------------------------------------------------------------

interface StaubliReadings {
  connected: boolean;
  temp_j1: number; temp_j2: number; temp_j3: number;
  temp_j4: number; temp_j5: number; temp_j6: number;
  temp_dsi: number;
  task_selected: string; task_status: string;
  parts_found: number; part_picked: string; part_desired: string;
  move_id: number; arm_cycles: number; power_on_hours: number;
  urps_errors_24h: number; ethercat_errors_24h: number;
  stop1_active: boolean; stop2_active: boolean; door_open: boolean;
  trajectory_found: boolean;
  tcp_x: number; tcp_y: number; tcp_z: number;
  conveyor_fwd: boolean;
  at_home: boolean; at_capture: boolean;
  [key: string]: unknown;
}

interface AperaReadings {
  connected: boolean;
  pipeline_state: string;
  pipeline_name: string;
  last_cycle_ms: number;
  total_detections: number;
  detection_confidence_avg: number;
  pick_pose_available: boolean;
  trajectory_available: boolean;
  calibration_status: string;
  cal_residual_mm: number;
  camera_1_ok: boolean; camera_2_ok: boolean;
  gpu_temp_c: number; gpu_memory_used_pct: number;
  [key: string]: unknown;
}

interface NetworkDevice {
  name: string;
  ip: string;
  reachable: boolean;
  latency_ms: number;
}

interface CellData {
  staubli: StaubliReadings | null;
  apera: AperaReadings | null;
  network: NetworkDevice[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOTOR_WARN = 65;
const MOTOR_CRIT = 80;
const DSI_WARN = 55;
const DSI_CRIT = 70;
const GPU_WARN = 75;
const GPU_CRIT = 90;

function tempStatusColor(val: number, warn: number, crit: number): string {
  if (val >= crit) return colors.dangerLight;
  if (val >= warn) return colors.warningLight;
  return colors.successLight;
}

function KV({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={kvStyles.container}>
      <Text style={kvStyles.label}>{label}</Text>
      <Text style={[kvStyles.value, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const kvStyles = StyleSheet.create({
  container: { alignItems: 'center' as const, minWidth: 60 },
  label: { color: colors.textMuted, fontSize: 10, textTransform: 'uppercase' as const },
  value: { color: colors.text, fontSize: typography.sizes.sm, fontWeight: typography.weights.bold as any, fontVariant: ['tabular-nums'] },
});

// ---------------------------------------------------------------------------
// Watchdog (simplified for mobile — counts alerts)
// ---------------------------------------------------------------------------

function countAlerts(data: CellData): { critical: number; warning: number } {
  let critical = 0;
  let warning = 0;
  const s = data.staubli;
  const a = data.apera;

  if (s) {
    if (s.stop1_active) critical++;
    if (s.stop2_active) critical++;
    if (s.door_open) warning++;
    const temps = [s.temp_j1, s.temp_j2, s.temp_j3, s.temp_j4, s.temp_j5, s.temp_j6];
    for (const t of temps) {
      if (t >= MOTOR_CRIT) critical++;
      else if (t >= MOTOR_WARN) warning++;
    }
    if (s.temp_dsi >= DSI_CRIT) critical++;
    else if (s.temp_dsi >= DSI_WARN) warning++;
    if (s.urps_errors_24h > 0) warning++;
    if (s.ethercat_errors_24h > 0) warning++;
    if (s.urps_errors_24h > 0 && s.ethercat_errors_24h > 0) critical++;
    if (!s.connected) critical++;
  }

  if (a) {
    if (a.pipeline_state === 'error') critical++;
    if (!a.camera_1_ok || !a.camera_2_ok) critical++;
    if (a.gpu_temp_c >= GPU_CRIT) critical++;
    else if (a.gpu_temp_c >= GPU_WARN) warning++;
    if (a.gpu_memory_used_pct > 95) warning++;
    if (a.calibration_status === 'failed') critical++;
    else if (a.calibration_status === 'drift') warning++;
    if (!a.connected) critical++;
  }

  for (const dev of data.network) {
    if (!dev.reachable) {
      if (dev.name.includes('Staubli') || dev.name.includes('Apera')) critical++;
      else warning++;
    }
  }

  return { critical, warning };
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const POLL_MS = 3000;

export default function CellScreen() {
  const [data, setData] = useState<CellData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const result = await fetchCellReadings(true);
      if (result.data) {
        setData(result.data as unknown as CellData);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cell data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, POLL_MS);
    return () => clearInterval(interval);
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  if (loading && !data) {
    return <LoadingState lines={8} />;
  }

  const alerts = data ? countAlerts(data) : { critical: 0, warning: 0 };
  const s = data?.staubli;
  const a = data?.apera;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* ── Watchdog Status ── */}
      <Card style={styles.watchdogCard}>
        <View style={styles.watchdogRow}>
          <View style={[styles.statusDot, {
            backgroundColor: alerts.critical > 0 ? colors.danger : alerts.warning > 0 ? colors.warning : colors.success,
          }]} />
          <Text style={styles.watchdogTitle}>Cell Watchdog</Text>
          <View style={{ flex: 1 }} />
          {alerts.critical > 0 && (
            <Badge label={`${alerts.critical} CRITICAL`} color={colors.dangerLight} backgroundColor="#dc262620" />
          )}
          {alerts.warning > 0 && (
            <Badge label={`${alerts.warning} WARN`} color={colors.warningLight} backgroundColor="#d9770620" />
          )}
          {alerts.critical === 0 && alerts.warning === 0 && (
            <Badge label="ALL CLEAR" color={colors.successLight} backgroundColor="#16a34a20" />
          )}
        </View>
      </Card>

      {/* ── Staubli Robot ── */}
      <Card>
        <View style={styles.sectionHeader}>
          <View style={[styles.statusDot, {
            backgroundColor: s?.connected ? colors.success : colors.statusOffline,
          }]} />
          <Text style={styles.sectionTitle}>Staubli TX2-140</Text>
        </View>

        {!s ? (
          <Text style={styles.waiting}>Waiting for robot connection...</Text>
        ) : (
          <>
            {/* Safety */}
            <Text style={styles.subHeader}>Safety</Text>
            <View style={styles.badgeRow}>
              <Badge
                label={s.stop1_active ? 'STOP 1' : 'Stop 1 OK'}
                color={s.stop1_active ? colors.dangerLight : colors.successLight}
                backgroundColor={s.stop1_active ? '#dc262620' : '#16a34a15'}
              />
              <Badge
                label={s.stop2_active ? 'STOP 2' : 'Stop 2 OK'}
                color={s.stop2_active ? colors.dangerLight : colors.successLight}
                backgroundColor={s.stop2_active ? '#dc262620' : '#16a34a15'}
              />
              <Badge
                label={s.door_open ? 'DOOR OPEN' : 'Door Closed'}
                color={s.door_open ? colors.warningLight : colors.successLight}
                backgroundColor={s.door_open ? '#d9770620' : '#16a34a15'}
              />
            </View>

            {/* Motor Temperatures */}
            <Text style={styles.subHeader}>Motor Temperatures</Text>
            <View style={styles.tempGrid}>
              {(['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] as const).map((j, i) => {
                const val = [s.temp_j1, s.temp_j2, s.temp_j3, s.temp_j4, s.temp_j5, s.temp_j6][i];
                return (
                  <KV key={j} label={j} value={`${val.toFixed(0)}°C`} color={tempStatusColor(val, MOTOR_WARN, MOTOR_CRIT)} />
                );
              })}
              <KV label="DSI" value={`${s.temp_dsi.toFixed(0)}°C`} color={tempStatusColor(s.temp_dsi, DSI_WARN, DSI_CRIT)} />
            </View>

            {/* Production */}
            <Text style={styles.subHeader}>Production</Text>
            <View style={styles.kvRow}>
              <KV label="Task" value={s.task_selected || '--'} />
              <KV label="Parts" value={String(s.parts_found)} />
              <KV label="Picked" value={s.part_picked || '--'} />
              <KV label="Cycles" value={s.arm_cycles.toLocaleString()} />
            </View>

            {/* System Health */}
            <Text style={styles.subHeader}>System Health</Text>
            <View style={styles.kvRow}>
              <KV label="Hours" value={s.power_on_hours.toFixed(1)} />
              <KV label="URPS Err" value={String(s.urps_errors_24h)} color={s.urps_errors_24h > 0 ? colors.dangerLight : undefined} />
              <KV label="EtherCAT" value={String(s.ethercat_errors_24h)} color={s.ethercat_errors_24h > 0 ? colors.warningLight : undefined} />
            </View>

            {/* Position */}
            <Text style={styles.subHeader}>TCP Position</Text>
            <View style={styles.kvRow}>
              <KV label="X" value={`${s.tcp_x.toFixed(0)}mm`} />
              <KV label="Y" value={`${s.tcp_y.toFixed(0)}mm`} />
              <KV label="Z" value={`${s.tcp_z.toFixed(0)}mm`} />
            </View>
          </>
        )}
      </Card>

      {/* ── Apera Vision ── */}
      <Card>
        <View style={styles.sectionHeader}>
          <View style={[styles.statusDot, {
            backgroundColor: a?.connected ? colors.success : colors.statusOffline,
          }]} />
          <Text style={styles.sectionTitle}>Apera Vue AI Vision</Text>
        </View>

        {!a ? (
          <Text style={styles.waiting}>Waiting for vision system...</Text>
        ) : (
          <>
            {/* Pipeline */}
            <Text style={styles.subHeader}>Pipeline</Text>
            <View style={styles.kvRow}>
              <Badge
                label={a.pipeline_state.toUpperCase()}
                color={a.pipeline_state === 'error' ? colors.dangerLight : a.pipeline_state === 'idle' ? colors.textMuted : colors.infoLight}
                backgroundColor={a.pipeline_state === 'error' ? '#dc262620' : '#2563eb15'}
              />
              <KV label="Cycle" value={a.last_cycle_ms > 0 ? `${a.last_cycle_ms}ms` : '--'} />
              <KV label="Pose" value={a.pick_pose_available ? 'Ready' : 'None'} color={a.pick_pose_available ? colors.successLight : undefined} />
            </View>

            {/* Detections */}
            <Text style={styles.subHeader}>Detections</Text>
            <View style={styles.kvRow}>
              <KV label="Found" value={String(a.total_detections)} />
              <KV
                label="Confidence"
                value={a.detection_confidence_avg > 0 ? `${(a.detection_confidence_avg * 100).toFixed(0)}%` : '--'}
                color={a.detection_confidence_avg < 0.5 ? colors.warningLight : colors.successLight}
              />
            </View>

            {/* Calibration */}
            <Text style={styles.subHeader}>Calibration</Text>
            <View style={styles.kvRow}>
              <Badge
                label={a.calibration_status.toUpperCase()}
                color={a.calibration_status === 'ok' ? colors.successLight : a.calibration_status === 'failed' ? colors.dangerLight : colors.warningLight}
                backgroundColor={a.calibration_status === 'ok' ? '#16a34a15' : a.calibration_status === 'failed' ? '#dc262620' : '#d9770620'}
              />
              <KV label="Residual" value={a.cal_residual_mm > 0 ? `${a.cal_residual_mm.toFixed(2)}mm` : '--'} />
            </View>

            {/* Hardware */}
            <Text style={styles.subHeader}>Hardware</Text>
            <View style={styles.kvRow}>
              <KV label="Cam 1" value={a.camera_1_ok ? 'OK' : 'ERR'} color={a.camera_1_ok ? colors.successLight : colors.dangerLight} />
              <KV label="Cam 2" value={a.camera_2_ok ? 'OK' : 'ERR'} color={a.camera_2_ok ? colors.successLight : colors.dangerLight} />
              <KV label="GPU" value={`${a.gpu_temp_c.toFixed(0)}°C`} color={tempStatusColor(a.gpu_temp_c, GPU_WARN, GPU_CRIT)} />
              <KV label="VRAM" value={`${a.gpu_memory_used_pct.toFixed(0)}%`} color={a.gpu_memory_used_pct > 90 ? colors.dangerLight : undefined} />
            </View>
          </>
        )}
      </Card>

      {/* ── Network Devices ── */}
      {data?.network && data.network.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>Cell Network</Text>
          {data.network.map((dev) => (
            <View key={dev.ip} style={styles.networkRow}>
              <View style={[styles.statusDot, {
                backgroundColor: dev.reachable ? colors.success : colors.danger,
              }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{dev.name}</Text>
                <Text style={styles.deviceIp}>{dev.ip}</Text>
              </View>
              {dev.reachable && (
                <Text style={styles.latency}>{dev.latency_ms}ms</Text>
              )}
            </View>
          ))}
        </Card>
      )}

      <View style={{ height: spacing['5xl'] }} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  errorBanner: {
    margin: spacing.md,
    padding: spacing.md,
    backgroundColor: '#dc262620',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dc262640',
  },
  errorText: { color: colors.dangerLight, fontSize: typography.sizes.xs },
  watchdogCard: { marginBottom: spacing.sm },
  watchdogRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  watchdogTitle: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: typography.weights.bold as any,
    textTransform: 'uppercase' as any,
    letterSpacing: 1.5,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: typography.weights.bold as any,
    textTransform: 'uppercase' as any,
    letterSpacing: 1.5,
  },
  subHeader: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: typography.weights.semibold as any,
    textTransform: 'uppercase' as any,
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border + '40',
    paddingTop: spacing.sm,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tempGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'space-around' },
  kvRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'center' },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border + '30',
  },
  deviceName: { color: colors.text, fontSize: typography.sizes.sm },
  deviceIp: { color: colors.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
  latency: { color: colors.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
  waiting: { color: colors.textMuted, fontSize: typography.sizes.sm, fontStyle: 'italic' },
});

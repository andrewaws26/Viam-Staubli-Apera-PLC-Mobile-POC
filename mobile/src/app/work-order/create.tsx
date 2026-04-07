/**
 * Create Work Order screen.
 * Pick a truck (optional), enter title + description, set priority, assign to someone.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, ScrollView, Text, Alert, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppAuth } from '@/auth/auth-provider';
import { useFleetStore } from '@/stores/fleet-store';
import { useWorkStore } from '@/stores/work-store';
import { fetchTeamMembers, suggestWorkOrderSteps } from '@/services/api-client';
import TruckSelector from '@/components/TruckSelector';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Button from '@/components/ui/Button';
import TextInput from '@/components/ui/TextInput';
import Card from '@/components/ui/Card';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { WorkOrderPriority } from '@/types/work-order';

interface TeamMember {
  id: string;
  name: string;
  role: string;
}

const PRIORITIES: WorkOrderPriority[] = ['low', 'normal', 'urgent'];
const PRIORITY_LABELS = ['Low', 'Normal', 'Urgent'];

export default function CreateWorkOrderScreen() {
  const router = useRouter();
  const { currentUser } = useAppAuth();
  const { trucks, selectedTruckId, readings } = useFleetStore();
  const { addWorkOrder } = useWorkStore();

  const [truckId, setTruckId] = useState<string | null>(selectedTruckId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priorityIndex, setPriorityIndex] = useState(1); // default: normal
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [assignedToName, setAssignedToName] = useState<string | null>(null);
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await fetchTeamMembers();
      if (result.data) setTeamMembers(result.data as unknown as TeamMember[]);
    })();
  }, []);

  const handleSuggestSteps = useCallback(async () => {
    if (!title.trim()) return;
    setSuggesting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await suggestWorkOrderSteps(title.trim(), description.trim() || undefined);
    if (result.data && Array.isArray((result.data as any).steps)) {
      setSubtasks((result.data as any).steps);
    } else {
      Alert.alert('Error', 'Failed to generate steps. Try again.');
    }
    setSuggesting(false);
  }, [title, description]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) {
      Alert.alert('Required', 'Enter a title for the work order.');
      return;
    }

    setSubmitting(true);

    // Snapshot truck readings if a truck is selected
    let truckSnapshot: Record<string, unknown> | undefined;
    let linkedDtcs: { spn: number; fmi: number; ecuLabel: string }[] | undefined;

    if (truckId) {
      const r = readings[truckId];
      if (r) {
        truckSnapshot = {
          engine_rpm: r.engine_rpm,
          coolant_temp_f: r.coolant_temp_f,
          oil_pressure_psi: r.oil_pressure_psi,
          vehicle_speed_mph: r.vehicle_speed_mph,
          fuel_level_pct: r.fuel_level_pct,
          def_level_pct: r.def_level_pct,
          battery_voltage_v: r.battery_voltage_v,
          vehicle_distance_mi: r.vehicle_distance_mi,
          engine_hours: r.engine_hours,
        };

        // Capture active DTCs
        const dtcs: { spn: number; fmi: number; ecuLabel: string }[] = [];
        const ecus = ['engine', 'trans', 'abs', 'acm', 'body', 'inst'];
        const ecuLabels: Record<string, string> = { engine: 'Engine', trans: 'Trans', abs: 'ABS', acm: 'ACM', body: 'Body', inst: 'Inst' };
        for (const ecu of ecus) {
          const count = (r as Record<string, unknown>)[`dtc_${ecu}_count`] as number || 0;
          for (let i = 0; i < count; i++) {
            const spn = (r as Record<string, unknown>)[`dtc_${ecu}_${i}_spn`] as number;
            const fmi = (r as Record<string, unknown>)[`dtc_${ecu}_${i}_fmi`] as number;
            if (spn !== undefined) {
              dtcs.push({ spn, fmi: fmi ?? 0, ecuLabel: ecuLabels[ecu] || ecu });
            }
          }
        }
        if (dtcs.length > 0) linkedDtcs = dtcs;
      }
    }

    const result = await addWorkOrder({
      truck_id: truckId || undefined,
      title: title.trim(),
      description: description.trim() || undefined,
      priority: PRIORITIES[priorityIndex],
      truck_snapshot: truckSnapshot,
      linked_dtcs: linkedDtcs,
      assigned_to: assignedTo || undefined,
      assigned_to_name: assignedToName || undefined,
      subtasks: subtasks.filter((s) => s.trim()).map((s) => ({ title: s.trim() })),
    } as any);

    setSubmitting(false);

    if (result) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } else {
      Alert.alert('Error', 'Failed to create work order. Check your connection.');
    }
  }, [title, description, priorityIndex, truckId, readings, addWorkOrder, router]);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.form}>
        {/* Truck selector (optional) */}
        <View style={styles.field}>
          <Text style={styles.label}>Truck (optional)</Text>
          <TruckSelector
            trucks={[{ id: '', name: 'No truck — general work' } as any, ...trucks]}
            selectedId={truckId}
            onSelect={(id) => setTruckId(id || null)}
          />
        </View>

        {/* Title */}
        <View style={styles.field}>
          <Text style={styles.label}>What needs to be done?</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g., Check coolant leak"
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={styles.label}>Details (optional)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Any additional context..."
            multiline
            numberOfLines={4}
          />
        </View>

        {/* Priority */}
        <View style={styles.field}>
          <Text style={styles.label}>Priority</Text>
          <SegmentedControl
            options={PRIORITY_LABELS}
            selectedIndex={priorityIndex}
            onChange={setPriorityIndex}
          />
        </View>

        {/* Assign To */}
        <View style={styles.field}>
          <Text style={styles.label}>Assign To</Text>
          <TouchableOpacity
            style={styles.assignTrigger}
            onPress={() => setShowAssignPicker(!showAssignPicker)}
          >
            <Text style={assignedTo ? styles.assignSelected : styles.assignPlaceholder}>
              {assignedToName || 'Unassigned'}
            </Text>
            <Text style={styles.assignChevron}>{showAssignPicker ? '\u25B2' : '\u25BC'}</Text>
          </TouchableOpacity>

          {showAssignPicker && (
            <View style={styles.assignList}>
              <TouchableOpacity
                style={styles.assignItem}
                onPress={() => { setAssignedTo(null); setAssignedToName(null); setShowAssignPicker(false); }}
              >
                <Text style={styles.assignItemMuted}>Unassigned</Text>
              </TouchableOpacity>
              {teamMembers.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.assignItem}
                  onPress={() => { setAssignedTo(m.id); setAssignedToName(m.name); setShowAssignPicker(false); }}
                >
                  <View style={styles.assignAvatar}>
                    <Text style={styles.assignAvatarText}>{m.name.charAt(0)}</Text>
                  </View>
                  <Text style={[styles.assignItemName, m.id === assignedTo && { color: colors.primaryLight }]}>
                    {m.name}
                  </Text>
                  <Text style={styles.assignItemRole}>{m.role}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Steps / Subtasks */}
        <View style={styles.field}>
          <View style={styles.stepsHeader}>
            <Text style={styles.label}>
              Steps{subtasks.length > 0 ? ` (${subtasks.length})` : ''}
            </Text>
            <TouchableOpacity
              style={[styles.suggestBtn, (!title.trim() || suggesting) && styles.suggestBtnDisabled]}
              onPress={handleSuggestSteps}
              disabled={!title.trim() || suggesting}
            >
              {suggesting ? (
                <ActivityIndicator size="small" color={colors.infoLight} />
              ) : (
                <Text style={styles.suggestBtnText}>Suggest Steps</Text>
              )}
            </TouchableOpacity>
          </View>

          {subtasks.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <Text style={styles.stepNumber}>{i + 1}.</Text>
              <TextInput
                value={step}
                onChangeText={(text) => {
                  const next = [...subtasks];
                  next[i] = text;
                  setSubtasks(next);
                }}
                placeholder="Step description..."
              />
              <TouchableOpacity
                onPress={() => setSubtasks(subtasks.filter((_, j) => j !== i))}
                style={styles.stepRemove}
              >
                <Text style={styles.stepRemoveText}>X</Text>
              </TouchableOpacity>
            </View>
          ))}

          {subtasks.length > 0 && (
            <TouchableOpacity
              style={styles.addStepBtn}
              onPress={() => setSubtasks([...subtasks, ''])}
            >
              <Text style={styles.addStepText}>+ Add step</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Truck snapshot preview */}
        {truckId && readings[truckId] && (
          <Card style={styles.snapshotCard}>
            <Text style={styles.snapshotTitle}>Truck readings will be attached</Text>
            <Text style={styles.snapshotDetail}>
              RPM: {readings[truckId]?.engine_rpm ?? '--'} | Coolant: {readings[truckId]?.coolant_temp_f ?? '--'}°F | Oil: {readings[truckId]?.oil_pressure_psi ?? '--'} psi
            </Text>
            {(readings[truckId]?.active_dtc_count ?? 0) > 0 && (
              <Text style={styles.snapshotDtc}>
                {readings[truckId]?.active_dtc_count} active DTC{(readings[truckId]?.active_dtc_count ?? 0) > 1 ? 's' : ''} will be linked
              </Text>
            )}
          </Card>
        )}

        {/* Submit */}
        <Button
          title={submitting ? 'Creating...' : 'Create Work Order'}
          onPress={handleSubmit}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!title.trim() || submitting}
        />
      </View>

      <View style={{ height: spacing['5xl'] }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  form: { padding: spacing.lg, gap: spacing.lg },
  field: { gap: spacing.xs },
  label: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold as any,
  },
  // Assignment
  assignTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  assignSelected: { color: colors.text, fontSize: typography.sizes.sm },
  assignPlaceholder: { color: colors.textMuted, fontSize: typography.sizes.sm },
  assignChevron: { color: colors.textMuted, fontSize: 10 },
  assignList: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginTop: spacing.xs },
  assignItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  assignItemMuted: { color: colors.textMuted, fontSize: typography.sizes.sm },
  assignItemName: { color: colors.text, fontSize: typography.sizes.sm, flex: 1 },
  assignItemRole: { color: colors.textMuted, fontSize: typography.sizes.xs },
  assignAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  assignAvatarText: { color: colors.textSecondary, fontSize: typography.sizes.xs, fontWeight: typography.weights.bold as any },
  // Steps
  stepsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suggestBtn: { backgroundColor: colors.info + '20', borderWidth: 1, borderColor: colors.info + '40', borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  suggestBtnDisabled: { opacity: 0.4 },
  suggestBtnText: { color: colors.infoLight, fontSize: typography.sizes.xs, fontWeight: typography.weights.semibold as any },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepNumber: { color: colors.textMuted, fontSize: typography.sizes.xs, width: 20, textAlign: 'right' },
  stepRemove: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  stepRemoveText: { color: colors.textMuted, fontSize: typography.sizes.sm, fontWeight: typography.weights.bold as any },
  addStepBtn: { paddingVertical: spacing.xs, paddingLeft: 28 },
  addStepText: { color: colors.textMuted, fontSize: typography.sizes.xs },
  snapshotCard: { gap: spacing.xs },
  snapshotTitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold as any,
  },
  snapshotDetail: {
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
  },
  snapshotDtc: {
    color: colors.warningLight,
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold as any,
  },
});

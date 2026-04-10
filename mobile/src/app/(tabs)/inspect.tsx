/**
 * Inspection screen — pre/post-shift checklists with pass/fail/na buttons.
 * Works 100% offline. Large touch targets for gloved fingers.
 */

import React, { useState, useCallback } from 'react';
import { View, ScrollView, Text, StyleSheet, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { useAppAuth } from '@/auth/auth-provider';
import { useFleetStore } from '@/stores/fleet-store';
import { insertInspection } from '@/db/queries';
import TruckSelector from '@/components/TruckSelector';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { colors } from '@/theme/colors';
import { spacing, PREFERRED_TOUCH_TARGET } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { INSPECTION_CHECKLIST, type InspectionItem, type CheckResult } from '@/types/inspection';

function InspectScreenInner() {
  const { currentUser } = useAppAuth();
  const { trucks, selectedTruckId, selectTruck } = useFleetStore();
  const [shiftType, setShiftType] = useState(0); // 0=pre, 1=post
  const [items, setItems] = useState<InspectionItem[]>(
    INSPECTION_CHECKLIST.flatMap((cat) => cat.items.map((i) => ({ ...i })))
  );
  const [submitted, setSubmitted] = useState(false);

  const truckId = selectedTruckId || trucks[0]?.id;

  const setResult = useCallback((itemId: string, result: CheckResult) => {
    if (result === 'fail') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, result } : i)));
  }, []);

  const completedCount = items.filter((i) => i.result !== null).length;
  const failCount = items.filter((i) => i.result === 'fail').length;
  const progress = items.length > 0 ? completedCount / items.length : 0;
  const overallStatus = completedCount < items.length ? 'incomplete' as const : failCount > 0 ? 'fail' as const : 'pass' as const;

  const handleSubmit = useCallback(async () => {
    if (!truckId || !currentUser) return;
    try {
      insertInspection({
        id: Crypto.randomUUID(),
        truckId,
        inspectorId: currentUser.id,
        inspectorName: currentUser.name,
        inspectorRole: currentUser.role,
        type: shiftType === 0 ? 'pre_shift' : 'post_shift',
        itemsJson: JSON.stringify(items),
        overallStatus,
        createdAt: new Date().toISOString(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch (err) {
      Alert.alert('Error', 'Failed to save inspection. Please try again.');
    }
  }, [truckId, currentUser, shiftType, items, overallStatus]);

  const resetForm = () => {
    setItems(INSPECTION_CHECKLIST.flatMap((cat) => cat.items.map((i) => ({ ...i }))));
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successIcon}>✅</Text>
        <Text style={styles.successTitle}>Inspection Submitted</Text>
        <Text style={styles.successSub}>{overallStatus === 'pass' ? 'All items passed' : `${failCount} item${failCount !== 1 ? 's' : ''} failed`}</Text>
        <Button title="New Inspection" onPress={resetForm} size="lg" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <TruckSelector trucks={trucks} selectedId={truckId || null} onSelect={selectTruck} />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <SegmentedControl options={['Pre-Shift', 'Post-Shift']} selectedIndex={shiftType} onChange={setShiftType} />
      </View>

      {/* Progress */}
      <View style={styles.progressRow}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>{completedCount}/{items.length}</Text>
      </View>

      {/* Checklist by category */}
      {INSPECTION_CHECKLIST.map((cat) => (
        <Card key={cat.name} style={styles.categoryCard}>
          <Text style={styles.categoryTitle}>{cat.name}</Text>
          {cat.items.map((item) => {
            const current = items.find((i) => i.id === item.id);
            return (
              <View key={item.id} style={styles.checkRow}>
                <Text style={styles.checkLabel}>{item.label}</Text>
                <View style={styles.checkButtons}>
                  {(['pass', 'fail', 'na'] as CheckResult[]).map((r) => (
                    <Button
                      key={r}
                      title={r === 'na' ? 'N/A' : r === 'pass' ? 'PASS' : 'FAIL'}
                      variant={current?.result === r ? (r === 'fail' ? 'danger' : r === 'pass' ? 'primary' : 'ghost') : 'secondary'}
                      size="sm"
                      onPress={() => setResult(item.id, r)}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </Card>
      ))}

      <View style={styles.submitArea}>
        <Button title="Submit Inspection" onPress={handleSubmit} size="lg" fullWidth disabled={completedCount < items.length} />
      </View>

      <View style={{ height: spacing['5xl'] }} />
    </ScrollView>
  );
}

export default function InspectScreen() {
  return (
    <ErrorBoundary fallbackTitle="Inspection screen crashed">
      <InspectScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  progressRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  progressTrack: { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3 },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  progressText: { color: colors.textSecondary, fontSize: typography.sizes.sm, fontWeight: typography.weights.bold as any },
  categoryCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  categoryTitle: { color: colors.text, fontSize: typography.sizes.base, fontWeight: typography.weights.bold as any, marginBottom: spacing.md },
  checkRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  checkLabel: { color: colors.textSecondary, fontSize: typography.sizes.sm, marginBottom: spacing.sm },
  checkButtons: { flexDirection: 'row', gap: spacing.sm },
  submitArea: { padding: spacing.lg },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg, padding: spacing['3xl'] },
  successIcon: { fontSize: 64 },
  successTitle: { color: colors.text, fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold as any },
  successSub: { color: colors.textSecondary, fontSize: typography.sizes.base },
});

/**
 * Create New Timesheet — select week ending date and railroad.
 * Creates a draft timesheet and navigates to detail for editing.
 */

import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTimesheetStore } from '@/stores/timesheet-store';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import Button from '@/components/ui/Button';
import { colors } from '@/theme/colors';
import { spacing, radii } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { RAILROAD_OPTIONS } from '@ironsight/shared/timesheet';

/** Get the next 4 upcoming Saturday dates (week endings). */
function getUpcomingSaturdays(count = 4): string[] {
  const results: string[] = [];
  const today = new Date();
  const d = new Date(today);
  // Advance to next Saturday
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  // But also include this Saturday if today is Sat
  if (today.getDay() === 6) {
    d.setDate(today.getDate());
  }
  for (let i = 0; i < count; i++) {
    results.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return results;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function NewTimesheetInner() {
  const router = useRouter();
  const { create, isLoading } = useTimesheetStore();
  const [weekEnding, setWeekEnding] = useState<string | null>(null);
  const [railroad, setRailroad] = useState<string | null>(null);

  const saturdays = useMemo(() => getUpcomingSaturdays(4), []);

  const handleCreate = async () => {
    if (!weekEnding) return;
    const id = await create({
      week_ending: weekEnding,
      railroad_working_on: railroad || undefined,
    } as any);
    if (id) {
      router.replace(`/me/timesheets/${id}` as any);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Timesheet' }} />

      {/* Week Ending Selection */}
      <Text style={styles.sectionTitle}>Week Ending (Saturday)</Text>
      <View style={styles.optionGrid}>
        {saturdays.map((date) => (
          <TouchableOpacity
            key={date}
            style={[styles.optionCard, weekEnding === date && styles.optionCardSelected]}
            onPress={() => setWeekEnding(date)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionText, weekEnding === date && styles.optionTextSelected]}>
              {formatDate(date)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Railroad Selection */}
      <Text style={styles.sectionTitle}>Railroad (optional)</Text>
      <View style={styles.optionGrid}>
        {RAILROAD_OPTIONS.map((rr) => (
          <TouchableOpacity
            key={rr}
            style={[styles.optionCard, railroad === rr && styles.optionCardSelected]}
            onPress={() => setRailroad(railroad === rr ? null : rr)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionText, railroad === rr && styles.optionTextSelected]}>
              {rr}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Create Button */}
      <View style={styles.footer}>
        <Button
          title="Create Draft"
          onPress={handleCreate}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!weekEnding}
          loading={isLoading}
        />
      </View>
    </ScrollView>
  );
}

export default function NewTimesheetScreen() {
  return (
    <ErrorBoundary fallbackTitle="Create timesheet failed">
      <NewTimesheetInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing['6xl'] },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.heading,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  optionGrid: { gap: spacing.sm },
  optionCard: {
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryGlow,
  },
  optionText: {
    color: colors.text,
    fontSize: typography.sizes.base,
    fontFamily: typography.fonts.body,
  },
  optionTextSelected: {
    color: colors.primaryLight,
    fontFamily: typography.fonts.heading,
  },
  footer: { marginTop: spacing['3xl'] },
});

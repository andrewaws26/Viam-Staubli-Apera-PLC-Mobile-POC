/**
 * Home tab — role-based dashboard with quick action cards.
 * First screen users see. Shows relevant info based on role.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { View, ScrollView, Text, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useAppAuth } from '@/auth/auth-provider';
import { useFleetStore } from '@/stores/fleet-store';
import { useWorkStore } from '@/stores/work-store';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import Card from '@/components/ui/Card';
import { colors } from '@/theme/colors';
import { spacing, radii } from '@/theme/spacing';
import { typography } from '@/theme/typography';

function QuickCard({
  title,
  value,
  subtitle,
  color,
  icon,
  onPress,
  index,
}: {
  title: string;
  value: string;
  subtitle?: string;
  color: string;
  icon: string;
  onPress?: () => void;
  index: number;
}) {
  return (
    <Animated.View entering={FadeInDown.delay(index * 80).duration(300).springify()} style={styles.quickCardWrapper}>
      <TouchableOpacity style={styles.quickCard} onPress={onPress} activeOpacity={onPress ? 0.7 : 1}>
        <Text style={styles.quickIcon}>{icon}</Text>
        <Text style={[styles.quickValue, { color }]}>{value}</Text>
        <Text style={styles.quickTitle}>{title}</Text>
        {subtitle && <Text style={styles.quickSubtitle}>{subtitle}</Text>}
      </TouchableOpacity>
    </Animated.View>
  );
}

function HomeScreenInner() {
  const router = useRouter();
  const { currentUser } = useAppAuth();
  const { trucks, readings } = useFleetStore();
  const { workOrders, loadWorkOrders } = useWorkStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadWorkOrders();
  }, [loadWorkOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadWorkOrders();
    setRefreshing(false);
  }, [loadWorkOrders]);

  const runningCount = trucks.filter((t) => {
    const r = readings[t.id];
    return r?.engine_rpm && r.engine_rpm > 0;
  }).length;

  const alertCount = trucks.filter((t) => {
    const r = readings[t.id];
    return r?.active_dtc_count && r.active_dtc_count > 0;
  }).length;

  const myWorkOrders = workOrders.filter(
    (wo) => wo.status !== 'done' && wo.assigned_to === currentUser?.id,
  );

  const role = currentUser?.role || 'operator';
  const greeting = getGreeting();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryLight} />}
    >
      {/* Greeting */}
      <Animated.View entering={FadeInDown.duration(400)}>
        <Text style={styles.greeting}>{greeting}</Text>
        <Text style={styles.name}>{currentUser?.name || 'Operator'}</Text>
        <Text style={styles.role}>{role.toUpperCase()}</Text>
      </Animated.View>

      {/* Quick Stats Grid */}
      <View style={styles.grid}>
        <QuickCard
          title="Fleet"
          value={`${trucks.length}`}
          subtitle={`${runningCount} running`}
          color={colors.primaryLight}
          icon="🚛"
          onPress={() => router.push('/(tabs)/fleet' as any)}
          index={0}
        />
        <QuickCard
          title="Alerts"
          value={`${alertCount}`}
          subtitle={alertCount > 0 ? 'Active DTCs' : 'All clear'}
          color={alertCount > 0 ? colors.dangerLight : colors.successLight}
          icon={alertCount > 0 ? '⚠️' : '✅'}
          onPress={() => router.push('/(tabs)/fleet' as any)}
          index={1}
        />
        <QuickCard
          title="My Work"
          value={`${myWorkOrders.length}`}
          subtitle="Open orders"
          color={colors.warningLight}
          icon="📋"
          onPress={() => router.push('/(tabs)/work' as any)}
          index={2}
        />
        <QuickCard
          title="Chat"
          value=""
          subtitle="Team messages"
          color={colors.infoLight}
          icon="💬"
          onPress={() => router.push('/(tabs)/chat' as any)}
          index={3}
        />
      </View>

      {/* Assigned Work Orders */}
      {myWorkOrders.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assigned to You</Text>
          {myWorkOrders.slice(0, 3).map((wo) => (
            <Card key={wo.id} onPress={() => router.push(`/work-order/${wo.id}`)}>
              <View style={styles.woRow}>
                <View style={[styles.statusDot, { backgroundColor: wo.status === 'blocked' ? colors.danger : colors.warning }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.woTitle} numberOfLines={1}>{wo.title}</Text>
                  <Text style={styles.woMeta}>{wo.truck_id || 'No truck'}</Text>
                </View>
                <Text style={styles.woPriority}>{wo.priority}</Text>
              </View>
            </Card>
          ))}
          {myWorkOrders.length > 3 && (
            <TouchableOpacity onPress={() => router.push('/(tabs)/work' as any)}>
              <Text style={styles.viewAll}>View all {myWorkOrders.length} orders →</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

export default function HomeScreen() {
  return (
    <ErrorBoundary fallbackTitle="Home screen crashed">
      <HomeScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing['6xl'] },
  greeting: {
    color: colors.textSecondary,
    fontSize: typography.sizes.base,
    fontFamily: typography.fonts.body,
  },
  name: {
    color: colors.text,
    fontSize: typography.sizes['2xl'],
    fontFamily: typography.fonts.display,
    marginTop: spacing['2xs'],
  },
  role: {
    color: colors.primaryLight,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.mono,
    letterSpacing: typography.letterSpacing.widest,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  quickCardWrapper: {
    width: '47%' as any,
  },
  quickCard: {
    backgroundColor: colors.surface0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  quickIcon: { fontSize: 28 },
  quickValue: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.fonts.monoBold,
  },
  quickTitle: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.heading,
  },
  quickSubtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.body,
  },
  section: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.sizes.base,
    fontFamily: typography.fonts.heading,
    marginBottom: spacing.xs,
  },
  woRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  woTitle: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
  },
  woMeta: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.body,
    marginTop: 2,
  },
  woPriority: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.mono,
    textTransform: 'uppercase',
  },
  viewAll: {
    color: colors.primaryLight,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.label,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});

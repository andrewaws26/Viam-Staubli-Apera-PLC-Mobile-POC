/**
 * Compact work order card for board/list views.
 * Shows title, truck, assignee, priority, subtask progress, blocker.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Badge from '@/components/ui/Badge';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { timeAgo } from '@/utils/format';
import type { WorkOrder } from '@/types/work-order';

interface WorkOrderCardProps {
  workOrder: WorkOrder;
  onPress: () => void;
  showStatus?: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: colors.danger,
  normal: colors.primaryLight,
  low: colors.textMuted,
};

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  open: 'muted',
  in_progress: 'warning',
  blocked: 'danger',
  done: 'success',
};

function WorkOrderCard({ workOrder: wo, onPress, showStatus = false }: WorkOrderCardProps) {
  const subtasksDone = wo.subtasks?.filter((s) => s.is_done).length ?? 0;
  const subtasksTotal = wo.subtasks?.length ?? 0;
  const truckName = wo.truck_id
    ? `Truck ${wo.truck_id.substring(0, 8)}`
    : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      {/* Priority stripe */}
      <View style={[styles.priorityStripe, { backgroundColor: PRIORITY_COLORS[wo.priority] }]} />

      <View style={styles.content}>
        {/* Header: title + optional status badge */}
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {wo.title}
          </Text>
          {showStatus && (
            <Badge
              label={wo.status.replace('_', ' ')}
              variant={STATUS_VARIANTS[wo.status]}
              small
            />
          )}
        </View>

        {/* Truck + assignee row */}
        <View style={styles.metaRow}>
          {truckName && (
            <View style={styles.metaPill}>
              <Text style={styles.metaText}>{truckName}</Text>
            </View>
          )}
          <Text style={styles.assignee}>
            {wo.assigned_to_name || 'Unassigned'}
          </Text>
        </View>

        {/* Blocker banner */}
        {wo.status === 'blocked' && wo.blocker_reason && (
          <View style={styles.blockerBanner}>
            <Text style={styles.blockerText} numberOfLines={1}>
              Blocked: {wo.blocker_reason}
            </Text>
          </View>
        )}

        {/* Footer: subtask progress + time */}
        <View style={styles.footer}>
          {subtasksTotal > 0 && (
            <Text style={styles.subtaskText}>
              {subtasksDone}/{subtasksTotal} tasks
            </Text>
          )}
          {wo.note_count > 0 && (
            <Text style={styles.noteCount}>
              {wo.note_count} note{wo.note_count !== 1 ? 's' : ''}
            </Text>
          )}
          <Text style={styles.time}>{timeAgo(wo.updated_at)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(WorkOrderCard);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  priorityStripe: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.heading,
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaPill: {
    backgroundColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  metaText: {
    color: colors.textSecondary,
    fontSize: 10,
  },
  assignee: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
  },
  blockerBanner: {
    backgroundColor: '#dc262620',
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  blockerText: {
    color: colors.dangerLight,
    fontSize: 10,
    fontFamily: typography.fonts.heading,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  subtaskText: {
    color: colors.textMuted,
    fontSize: 10,
  },
  noteCount: {
    color: colors.textMuted,
    fontSize: 10,
  },
  time: {
    color: colors.textMuted,
    fontSize: 10,
    marginLeft: 'auto',
  },
});

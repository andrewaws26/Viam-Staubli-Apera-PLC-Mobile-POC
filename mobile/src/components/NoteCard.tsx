/**
 * Displays a single truck note with author, role badge, timestamp, and body.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Badge from './ui/Badge';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { timeAgo } from '@/utils/format';

interface NoteCardProps {
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
  syncStatus?: string;
}

const ROLE_VARIANTS: Record<string, 'primary' | 'info' | 'success' | 'muted'> = {
  developer: 'primary',
  manager: 'info',
  mechanic: 'success',
  operator: 'muted',
};

export default function NoteCard({ authorName, authorRole, body, createdAt, syncStatus }: NoteCardProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.author}>{authorName}</Text>
        <Badge label={authorRole} variant={ROLE_VARIANTS[authorRole] || 'muted'} small />
        <Text style={styles.time}>{timeAgo(createdAt)}</Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      {syncStatus === 'pending' && (
        <Text style={styles.pending}>Pending sync</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  author: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
  },
  time: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
    marginLeft: 'auto',
  },
  body: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    lineHeight: 20,
  },
  pending: {
    color: colors.warningLight,
    fontSize: typography.sizes.xs,
    fontStyle: 'italic',
  },
});

/**
 * DTC (Diagnostic Trouble Code) badge showing SPN, FMI, ECU source, and description.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Badge from './ui/Badge';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { lookupSPN, lookupFMI } from '@/utils/spn-lookup';

interface DTCBadgeProps {
  spn: number;
  fmi: number;
  ecuLabel: string;
  onAskAI?: () => void;
}

export default function DTCBadge({ spn, fmi, ecuLabel, onAskAI }: DTCBadgeProps) {
  const spnInfo = lookupSPN(spn);
  const fmiDesc = lookupFMI(fmi);
  const severityVariant = spnInfo.severity === 'critical' ? 'danger' : spnInfo.severity === 'warning' ? 'warning' : 'info';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.codes}>
          <Text style={styles.spn}>SPN {spn}</Text>
          <Text style={styles.fmi}>FMI {fmi}</Text>
          <Badge label={ecuLabel} variant="muted" small />
        </View>
        <Badge label={spnInfo.severity} variant={severityVariant} small />
      </View>
      <Text style={styles.name}>{spnInfo.name}</Text>
      <Text style={styles.description}>{spnInfo.description}</Text>
      <Text style={styles.fmiDesc}>Failure: {fmiDesc}</Text>
      {onAskAI && (
        <TouchableOpacity style={styles.askButton} onPress={onAskAI} activeOpacity={0.7}>
          <Text style={styles.askText}>Ask AI</Text>
        </TouchableOpacity>
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
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  codes: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  spn: {
    color: colors.primaryLight,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.heading,
  },
  fmi: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.label,
  },
  name: {
    color: colors.text,
    fontSize: typography.sizes.base,
    fontFamily: typography.fonts.heading,
  },
  description: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
  },
  fmiDesc: {
    color: colors.textMuted,
    fontSize: typography.sizes.xs,
  },
  askButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
  askText: {
    color: '#ffffff',
    fontSize: typography.sizes.xs,
    fontFamily: typography.fonts.heading,
    textTransform: 'uppercase',
  },
});

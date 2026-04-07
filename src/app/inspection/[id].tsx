/**
 * Read-only view of a completed inspection.
 */

import React from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export default function InspectionDetailScreen() {
  // In production, load from SQLite by ID
  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerTitle: 'Inspection Detail', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
      <ScrollView style={styles.container}>
        <EmptyState title="Inspection Detail" message="Select an inspection from the list to view details." icon="✅" />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});

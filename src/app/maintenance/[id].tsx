/**
 * Read-only view of a maintenance record.
 */

import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import EmptyState from '@/components/ui/EmptyState';
import { colors } from '@/theme/colors';

export default function MaintenanceDetailScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerTitle: 'Maintenance Detail', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
      <ScrollView style={styles.container}>
        <EmptyState title="Maintenance Detail" message="Select a maintenance record to view details." icon="🔧" />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});

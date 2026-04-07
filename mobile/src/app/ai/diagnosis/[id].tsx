/**
 * Full-screen view of a cached AI diagnosis.
 */

import React from 'react';
import { ScrollView, Text, StyleSheet, Share } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useAiStore } from '@/stores/ai-store';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export default function DiagnosisDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { diagnoses } = useAiStore();
  const diagnosis = id ? diagnoses[id] : null;

  const handleShare = async () => {
    if (!diagnosis) return;
    await Share.share({ message: `IronSight AI Diagnosis\n\n${diagnosis.text}` });
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerTitle: 'AI Diagnosis', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {diagnosis ? (
          <>
            <Text style={styles.text}>{diagnosis.text}</Text>
            <Text style={styles.time}>Generated {diagnosis.createdAt}</Text>
            <Button title="Share Diagnosis" onPress={handleShare} variant="secondary" size="md" />
          </>
        ) : (
          <EmptyState title="Diagnosis not found" icon="🔍" />
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  text: { color: colors.text, fontSize: typography.sizes.sm, lineHeight: 22 },
  time: { color: colors.textMuted, fontSize: typography.sizes.xs },
});

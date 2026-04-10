/**
 * More tab — notes, maintenance, GPS tracking, sync status, settings.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, ScrollView, Text, StyleSheet, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useAppAuth } from '@/auth/auth-provider';
import { useFleetStore } from '@/stores/fleet-store';
import { insertNote, getNotesForTruck } from '@/db/queries';
import { createTruckNote, fetchTruckNotes } from '@/services/api-client';
import { startTracking, stopTracking, isTrackingActive } from '@/services/gps-tracker';
import TruckSelector from '@/components/TruckSelector';
import NoteCard from '@/components/NoteCard';
import SyncStatusBar from '@/components/SyncStatusBar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import TextInput from '@/components/ui/TextInput';
import EmptyState from '@/components/ui/EmptyState';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

function MoreScreenInner() {
  const router = useRouter();
  const { currentUser, signOut } = useAppAuth();
  const { trucks, selectedTruckId, selectTruck } = useFleetStore();
  const truckId = selectedTruckId || trucks[0]?.id;

  const [noteText, setNoteText] = useState('');
  const [notes, setNotes] = useState<any[]>([]);
  const [tracking, setTracking] = useState(isTrackingActive());

  const loadNotes = useCallback(async () => {
    if (!truckId) return;
    try {
      // Try local DB first
      const result = getNotesForTruck(truckId);
      setNotes(result);
    } catch {
      // DB unavailable (Expo Go) — fetch from API
      try {
        const result = await fetchTruckNotes(truckId);
        if (result.data && Array.isArray(result.data)) {
          setNotes(result.data.map((n: Record<string, unknown>) => ({
            localId: 0,
            id: n.id,
            truckId: n.truck_id,
            authorName: n.author_name || 'Unknown',
            authorRole: n.author_role || '',
            body: n.body,
            createdAt: n.created_at,
            syncStatus: 'synced',
          })));
        } else {
          setNotes([]);
        }
      } catch {
        setNotes([]);
      }
    }
  }, [truckId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleAddNote = useCallback(async () => {
    if (!noteText.trim() || !truckId || !currentUser) return;
    try {
      // Try local DB first
      insertNote({
        id: Crypto.randomUUID(),
        truckId,
        authorId: currentUser.id,
        authorName: currentUser.name,
        authorRole: currentUser.role,
        body: noteText.trim(),
        createdAt: new Date().toISOString(),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setNoteText('');
      loadNotes();
    } catch {
      // DB unavailable — save directly via API
      try {
        const result = await createTruckNote({ truck_id: truckId, body: noteText.trim() });
        if (result.error) {
          Alert.alert('Error', result.error);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setNoteText('');
          loadNotes();
        }
      } catch (err) {
        Alert.alert('Error', 'Failed to save note.');
      }
    }
  }, [noteText, truckId, currentUser, loadNotes]);

  const toggleGps = useCallback(async () => {
    if (tracking) {
      await stopTracking();
      setTracking(false);
    } else if (truckId && currentUser) {
      const started = await startTracking(truckId, currentUser.id);
      setTracking(started);
      if (!started) Alert.alert('Permission Required', 'Location permission is needed for GPS tracking.');
    }
  }, [tracking, truckId, currentUser]);

  const onRefresh = useCallback(async () => {
    await loadNotes();
  }, [loadNotes]);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <TruckSelector trucks={trucks} selectedId={truckId || null} onSelect={selectTruck} />

      {/* Notes */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notes</Text>
        <View style={styles.noteInput}>
          <TextInput value={noteText} onChangeText={setNoteText} placeholder="Add a note..." multiline numberOfLines={3} />
          <Button title="Add Note" onPress={handleAddNote} size="md" disabled={!noteText.trim()} />
        </View>
        {notes.length > 0 ? (
          notes.map((note, i) => (
            <NoteCard
              key={note.localId || i}
              authorName={note.authorName}
              authorRole={note.authorRole}
              body={note.body}
              createdAt={note.createdAt}
              syncStatus={note.syncStatus}
            />
          ))
        ) : (
          <EmptyState title="No notes yet" message="Add a note about this truck." icon="📝" />
        )}
      </View>

      {/* GPS Tracking */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>GPS Tracking</Text>
        <Card>
          <View style={styles.gpsRow}>
            <View>
              <Text style={[styles.gpsStatus, { color: tracking ? colors.success : colors.textMuted }]}>
                {tracking ? 'Tracking Active' : 'Not Tracking'}
              </Text>
              {tracking && <Text style={styles.gpsDetail}>Logging every 10 seconds</Text>}
            </View>
            <Button
              title={tracking ? 'Stop' : 'Start'}
              onPress={toggleGps}
              variant={tracking ? 'danger' : 'primary'}
              size="md"
            />
          </View>
        </Card>
      </View>

      {/* Sync Status */}
      <View style={styles.section}>
        <SyncStatusBar />
      </View>

      {/* Inspections */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Inspections</Text>
        <Button title="Pre/Post-Shift Inspection" onPress={() => router.push('/(tabs)/inspect')} variant="secondary" size="md" fullWidth />
      </View>

      {/* Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Settings</Text>
        <Card>
          {currentUser && (
            <>
              <Text style={styles.userName}>{currentUser.name}</Text>
              <Text style={styles.userEmail}>{currentUser.email}</Text>
              <Text style={styles.userRole}>{currentUser.role.toUpperCase()}</Text>
            </>
          )}
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <Button title="Help & FAQ" onPress={() => router.push('/help')} variant="secondary" size="md" fullWidth />
            <Button title="Sign Out" onPress={() => signOut()} variant="danger" size="md" fullWidth />
          </View>
        </Card>
        <Text style={styles.version}>IronSight Mobile v1.0.0</Text>
      </View>

      <View style={{ height: spacing['5xl'] }} />
    </ScrollView>
  );
}

export default function MoreScreen() {
  return (
    <ErrorBoundary fallbackTitle="More screen crashed">
      <MoreScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  section: { padding: spacing.lg, gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: typography.sizes.base, fontFamily: typography.fonts.heading },
  noteInput: { gap: spacing.sm },
  gpsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gpsStatus: { fontSize: typography.sizes.base, fontFamily: typography.fonts.heading },
  gpsDetail: { color: colors.textMuted, fontSize: typography.sizes.xs, marginTop: 2 },
  userName: { color: colors.text, fontSize: typography.sizes.lg, fontFamily: typography.fonts.display },
  userEmail: { color: colors.textSecondary, fontSize: typography.sizes.sm, fontFamily: typography.fonts.body },
  userRole: { color: colors.primaryLight, fontSize: typography.sizes.xs, fontFamily: typography.fonts.mono, letterSpacing: typography.letterSpacing.widest, marginTop: spacing.xs },
  version: { color: colors.textMuted, fontSize: typography.sizes.xs, textAlign: 'center', marginTop: spacing.md },
});

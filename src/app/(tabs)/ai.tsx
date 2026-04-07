/**
 * AI Assistant tab — chat, diagnose, shift reports.
 * Three modes via segmented control at top.
 */

import React, { useState, useRef, useCallback } from 'react';
import { View, ScrollView, Text, StyleSheet, FlatList, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFleetStore } from '@/stores/fleet-store';
import { useAiStore } from '@/stores/ai-store';
import { chat, diagnose } from '@/services/ai-client';
import SegmentedControl from '@/components/ui/SegmentedControl';
import TruckSelector from '@/components/TruckSelector';
import ChatBubble from '@/components/ui/ChatBubble';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import TextInput from '@/components/ui/TextInput';
import EmptyState from '@/components/ui/EmptyState';
import { useSyncStore } from '@/sync/sync-status';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { ChatMessage } from '@/types/ai';

const MODES = ['Chat', 'Diagnose', 'Reports'];
const SUGGESTED = [
  "What's wrong with this truck?",
  "Explain the active DTCs",
  "What should I check first?",
  "Are any readings trending badly?",
  "Prioritize my repairs today",
];

export default function AiScreen() {
  const [mode, setMode] = useState(0);
  const { trucks, selectedTruckId, selectTruck, readings } = useFleetStore();
  const { conversations, addMessage, setConversation, clearConversation, diagnoses, setDiagnosis, isLoading, setLoading } = useAiStore();
  const { isOnline } = useSyncStore();
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const truckId = selectedTruckId || trucks[0]?.id || '';
  const truckReadings = readings[truckId] || {};
  const messages = conversations[truckId] || [];

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || !truckId) return;

    setInput('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: ChatMessage = { role: 'user', content: msg };
    const updatedMessages = [...messages, userMsg];
    setConversation(truckId, updatedMessages);
    setLoading(true);

    try {
      const result = await chat(updatedMessages, truckReadings);
      if (result.success && result.reply) {
        setConversation(truckId, [...updatedMessages, { role: 'assistant', content: result.reply }]);
      } else {
        setConversation(truckId, [...updatedMessages, { role: 'assistant', content: `Error: ${result.error || 'Unknown error'}` }]);
      }
    } catch (err) {
      setConversation(truckId, [...updatedMessages, { role: 'assistant', content: `Failed: ${err instanceof Error ? err.message : 'Unknown'}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, messages, truckId, truckReadings, setConversation, setLoading]);

  const runDiagnosis = useCallback(async () => {
    if (!truckId) return;
    setLoading(true);
    try {
      const result = await diagnose(truckReadings);
      if (result.success && result.diagnosis) {
        setDiagnosis(truckId, result.diagnosis);
      }
    } catch (err) {
      console.error('[AI Diagnose]', err);
    } finally {
      setLoading(false);
    }
  }, [truckId, truckReadings, setDiagnosis, setLoading]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <TruckSelector trucks={trucks} selectedId={truckId} onSelect={selectTruck} />
      <SegmentedControl options={MODES} selectedIndex={mode} onChange={setMode} />

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>AI responses require connectivity. Messages will be sent when online.</Text>
        </View>
      )}

      {/* Chat Mode */}
      {mode === 0 && (
        <View style={styles.chatContainer}>
          <ScrollView ref={scrollRef} style={styles.chatScroll} contentContainerStyle={styles.chatContent}>
            {messages.length === 0 ? (
              <View style={styles.suggestions}>
                {SUGGESTED.map((q) => (
                  <TouchableOpacity key={q} style={styles.chip} onPress={() => sendMessage(q)}>
                    <Text style={styles.chipText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              messages.map((msg, i) => <ChatBubble key={i} role={msg.role} content={msg.content} />)
            )}
            {isLoading && (
              <View style={styles.thinking}>
                <Text style={styles.thinkingText}>AI Mechanic is thinking...</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput value={input} onChangeText={setInput} placeholder="Ask about this truck..." onSubmitEditing={() => sendMessage()} />
            <Button title="Send" onPress={() => sendMessage()} size="md" disabled={!input.trim() || isLoading} loading={isLoading} />
          </View>

          {messages.length > 0 && (
            <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); clearConversation(truckId); }}>
              <Text style={styles.clearText}>Clear conversation</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Diagnose Mode */}
      {mode === 1 && (
        <ScrollView style={styles.diagnoseContainer} contentContainerStyle={styles.diagnoseContent}>
          <Button title={isLoading ? 'Analyzing...' : 'Diagnose All'} onPress={runDiagnosis} size="lg" loading={isLoading} fullWidth />
          {diagnoses[truckId] && (
            <Card style={{ marginTop: spacing.lg }}>
              <Text style={styles.diagnosisText}>{diagnoses[truckId].text}</Text>
              <Text style={styles.diagnosisTime}>Generated {diagnoses[truckId].createdAt}</Text>
            </Card>
          )}
          {!diagnoses[truckId] && !isLoading && (
            <EmptyState title="No diagnosis yet" message="Tap Diagnose All to analyze current truck readings with AI." icon="🔍" />
          )}
        </ScrollView>
      )}

      {/* Reports Mode */}
      {mode === 2 && (
        <ScrollView contentContainerStyle={styles.diagnoseContent}>
          <EmptyState title="Shift Reports" message="Select a truck and date range to generate an AI-powered shift report." icon="📊" />
          <Button title="Generate Report" onPress={() => {}} size="lg" fullWidth disabled />
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  offlineBanner: { backgroundColor: '#d9770620', padding: spacing.sm, alignItems: 'center' },
  offlineText: { color: colors.warningLight, fontSize: typography.sizes.xs },
  chatContainer: { flex: 1, padding: spacing.lg },
  chatScroll: { flex: 1 },
  chatContent: { paddingBottom: spacing.lg },
  suggestions: { gap: spacing.sm },
  chip: { backgroundColor: '#7c3aed15', borderWidth: 1, borderColor: '#7c3aed30', borderRadius: 12, padding: spacing.md },
  chipText: { color: colors.primaryLight, fontSize: typography.sizes.sm },
  thinking: { padding: spacing.md },
  thinkingText: { color: colors.primaryLight, fontSize: typography.sizes.sm },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', paddingTop: spacing.sm },
  clearText: { color: colors.textMuted, fontSize: typography.sizes.xs, textAlign: 'right', paddingTop: spacing.sm },
  diagnoseContainer: { flex: 1 },
  diagnoseContent: { padding: spacing.lg },
  diagnosisText: { color: colors.text, fontSize: typography.sizes.sm, lineHeight: 22 },
  diagnosisTime: { color: colors.textMuted, fontSize: typography.sizes.xs, marginTop: spacing.md },
});

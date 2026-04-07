/**
 * Dedicated AI chat for a specific truck.
 * Navigated from "Ask AI" on DTCs or truck detail.
 */

import React, { useState, useRef, useCallback } from 'react';
import { View, ScrollView, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useFleetStore } from '@/stores/fleet-store';
import { useAiStore } from '@/stores/ai-store';
import { chat } from '@/services/ai-client';
import ChatBubble from '@/components/ui/ChatBubble';
import Button from '@/components/ui/Button';
import TextInput from '@/components/ui/TextInput';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import type { ChatMessage } from '@/types/ai';

export default function TruckChatScreen() {
  const { truckId } = useLocalSearchParams<{ truckId: string }>();
  const { trucks, readings } = useFleetStore();
  const { conversations, setConversation, clearConversation, isLoading, setLoading } = useAiStore();
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const truck = trucks.find((t) => t.id === truckId);
  const truckReadings = truckId ? readings[truckId] || {} : {};
  const messages = truckId ? conversations[truckId] || [] : [];

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || !truckId) return;
    setInput('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: ChatMessage = { role: 'user', content: msg };
    const updated = [...messages, userMsg];
    setConversation(truckId, updated);
    setLoading(true);

    try {
      const result = await chat(updated, truckReadings);
      if (result.success && result.reply) {
        setConversation(truckId, [...updated, { role: 'assistant', content: result.reply }]);
      } else {
        setConversation(truckId, [...updated, { role: 'assistant', content: `Error: ${result.error}` }]);
      }
    } catch (err) {
      setConversation(truckId, [...updated, { role: 'assistant', content: `Failed: ${err instanceof Error ? err.message : 'Unknown'}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, messages, truckId, truckReadings, setConversation, setLoading]);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerTitle: `AI Chat — ${truck?.name || truckId}`, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {messages.map((msg, i) => (
            <ChatBubble key={i} role={msg.role} content={msg.content} />
          ))}
          {isLoading && (
            <Text style={styles.thinking}>AI Mechanic is thinking...</Text>
          )}
        </ScrollView>
        <View style={styles.inputRow}>
          <View style={{ flex: 1 }}>
            <TextInput value={input} onChangeText={setInput} placeholder="Ask about this truck..." onSubmitEditing={() => sendMessage()} />
          </View>
          <Button title="Send" onPress={() => sendMessage()} size="md" disabled={!input.trim() || isLoading} />
        </View>
        {messages.length > 0 && (
          <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); clearConversation(truckId!); }}>
            <Text style={styles.clearText}>Clear conversation</Text>
          </TouchableOpacity>
        )}
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg },
  thinking: { color: colors.primaryLight, fontSize: typography.sizes.sm, padding: spacing.md },
  inputRow: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, alignItems: 'flex-end' },
  clearText: { color: colors.textMuted, fontSize: typography.sizes.xs, textAlign: 'right', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
});

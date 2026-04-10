import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useChatStore } from '@/stores/chat-store';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import type { ChatMessage, ChatReaction } from '@/types/chat';
import { REACTION_LABELS, VALID_REACTIONS } from '@/types/chat';
import { colors } from '@/theme/colors';
import { spacing, radii } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const ROLE_COLORS: Record<string, string> = {
  developer: '#a855f7',
  manager: '#3b82f6',
  mechanic: '#22c55e',
  operator: '#eab308',
  ai: '#06b6d4',
};

function MessageItem({
  message,
  isOwn,
  onReaction,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onReaction: (messageId: string, reaction: ChatReaction) => void;
}) {
  const [showReactions, setShowReactions] = useState(false);

  if (message.messageType === 'system') {
    return (
      <View style={styles.systemMsg}>
        <Text style={styles.systemMsgText}>{message.body}</Text>
      </View>
    );
  }

  if (message.deletedAt) {
    return (
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <Text style={styles.deletedText}>[message deleted]</Text>
      </View>
    );
  }

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
      <TouchableOpacity
        style={[
          styles.bubble,
          isOwn ? styles.bubbleOwn : message.messageType === 'ai' ? styles.bubbleAi : styles.bubbleOther,
        ]}
        onLongPress={() => setShowReactions(!showReactions)}
        activeOpacity={0.8}
      >
        {!isOwn && (
          <View style={styles.senderRow}>
            <Text style={styles.senderName}>{message.senderName}</Text>
            <Text style={[styles.senderRole, { color: ROLE_COLORS[message.senderRole] || '#9ca3af' }]}>
              {message.senderRole}
            </Text>
          </View>
        )}
        <Text style={styles.bodyText}>{message.body}</Text>
        {message.editedAt && <Text style={styles.editedText}>(edited)</Text>}

        {/* Snapshot indicator */}
        {message.snapshot && (
          <View style={styles.snapshotBadge}>
            <Text style={styles.snapshotText}>
              📊 Snapshot: {message.snapshot.engine_rpm ? `${message.snapshot.engine_rpm} RPM` : ''}{' '}
              {message.snapshot.coolant_temp_f ? `${message.snapshot.coolant_temp_f}°F` : ''}
            </Text>
          </View>
        )}

        <Text style={styles.timeText}>{time}</Text>

        {/* Reactions */}
        {message.reactions.length > 0 && (
          <View style={styles.reactionsRow}>
            {message.reactions
              .filter((r) => r.count > 0)
              .map((r) => (
                <TouchableOpacity
                  key={r.reaction}
                  style={[styles.reactionPill, r.reacted && styles.reactionPillActive]}
                  onPress={() => onReaction(message.id, r.reaction)}
                >
                  <Text style={styles.reactionText}>
                    {REACTION_LABELS[r.reaction].emoji} {r.count}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        )}
      </TouchableOpacity>

      {/* Reaction picker on long press */}
      {showReactions && (
        <View style={styles.reactionPicker}>
          {VALID_REACTIONS.map((r) => (
            <TouchableOpacity
              key={r}
              onPress={() => {
                onReaction(message.id, r);
                setShowReactions(false);
              }}
              style={styles.reactionPickerItem}
            >
              <Text style={{ fontSize: 18 }}>{REACTION_LABELS[r].emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function ThreadScreenInner() {
  const { id: threadId } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const {
    messages: allMessages,
    fetchMessages,
    sendMessage,
    toggleReaction,
    setActiveThread,
    pollForUpdates,
  } = useChatStore();

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const messages = allMessages[threadId || ''] || [];

  useEffect(() => {
    if (!threadId) return;
    setActiveThread(threadId);
    fetchMessages(threadId);

    const interval = setInterval(pollForUpdates, 3000);
    return () => {
      clearInterval(interval);
      setActiveThread(null);
    };
  }, [threadId, fetchMessages, setActiveThread, pollForUpdates]);

  const handleSend = useCallback(async () => {
    if (!text.trim() || sending || !threadId) return;
    setSending(true);
    const mentionAi = text.toLowerCase().includes('@ai');
    try {
      await sendMessage({ threadId, body: text.trim(), mentionAi });
      setText('');
    } finally {
      setSending(false);
    }
  }, [text, sending, threadId, sendMessage]);

  const handleReaction = useCallback(
    (messageId: string, reaction: ChatReaction) => {
      if (threadId) toggleReaction(threadId, messageId, reaction);
    },
    [threadId, toggleReaction],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageItem
        message={item}
        isOwn={item.senderId === userId}
        onReaction={handleReaction}
      />
    ),
    [userId, handleReaction],
  );

  const mentionAi = text.toLowerCase().includes('@ai');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />

      <View style={styles.inputContainer}>
        {mentionAi && <Text style={styles.aiIndicator}>AI will respond</Text>}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={setText}
            placeholder="Type a message... (@ai for AI)"
            placeholderTextColor="#6b7280"
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!text.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            <Text style={styles.sendButtonText}>{sending ? '...' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function ThreadScreen() {
  return (
    <ErrorBoundary fallbackTitle="Chat thread crashed">
      <ThreadScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  messageList: { padding: spacing.md, paddingBottom: spacing.xs },
  messageRow: { marginBottom: spacing.sm, alignItems: 'flex-start' },
  messageRowOwn: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  bubbleOwn: { backgroundColor: colors.primaryDark, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface1, borderBottomLeftRadius: 4 },
  bubbleAi: { backgroundColor: '#164e63', borderBottomLeftRadius: 4 },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  senderName: { color: colors.text, fontSize: typography.sizes.xs, fontFamily: typography.fonts.heading },
  senderRole: { fontSize: typography.sizes['2xs'], fontFamily: typography.fonts.label, textTransform: 'uppercase' },
  bodyText: { color: colors.text, fontSize: typography.sizes.sm, fontFamily: typography.fonts.body, lineHeight: 20 },
  editedText: { color: colors.textMuted, fontSize: typography.sizes['2xs'], fontStyle: 'italic', marginTop: 2 },
  deletedText: { color: colors.textMuted, fontSize: typography.sizes.sm, fontStyle: 'italic' },
  timeText: { color: colors.textMuted, fontSize: typography.sizes['2xs'], marginTop: 4, alignSelf: 'flex-end' },
  systemMsg: { alignItems: 'center', paddingVertical: spacing.xs },
  systemMsgText: { color: colors.textMuted, fontSize: typography.sizes['2xs'], fontStyle: 'italic' },
  snapshotBadge: {
    marginTop: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  snapshotText: { color: colors.textSecondary, fontSize: typography.sizes['2xs'] },
  reactionsRow: { flexDirection: 'row', gap: 4, marginTop: spacing.xs, flexWrap: 'wrap' },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.surface2,
  },
  reactionPillActive: { backgroundColor: colors.primaryDark, borderWidth: 1, borderColor: colors.primary },
  reactionText: { color: colors.textSecondary, fontSize: typography.sizes['2xs'] },
  reactionPicker: {
    flexDirection: 'row',
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    padding: 6,
    gap: spacing.sm,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  reactionPickerItem: { padding: spacing.xs },
  inputContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: spacing.sm,
  },
  aiIndicator: { color: '#06b6d4', fontSize: typography.sizes['2xs'], marginBottom: spacing.xs, marginLeft: spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  textInput: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sendButtonDisabled: { backgroundColor: colors.surface2 },
  sendButtonText: { color: '#fff', fontFamily: typography.fonts.heading, fontSize: typography.sizes.sm },
});

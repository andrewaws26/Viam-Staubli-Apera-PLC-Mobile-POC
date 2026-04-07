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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useChatStore } from '@/stores/chat-store';
import type { ChatMessage, ChatReaction } from '@/types/chat';
import { REACTION_LABELS, VALID_REACTIONS } from '@/types/chat';

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

export default function ThreadScreen() {
  const { id: threadId } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const router = useRouter();
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  messageList: { padding: 12, paddingBottom: 4 },
  messageRow: { marginBottom: 8, alignItems: 'flex-start' },
  messageRowOwn: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  bubbleOwn: { backgroundColor: '#4c1d95', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#1f2937', borderBottomLeftRadius: 4 },
  bubbleAi: { backgroundColor: '#164e63', borderBottomLeftRadius: 4 },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  senderName: { color: '#e5e7eb', fontSize: 12, fontWeight: '600' },
  senderRole: { fontSize: 10, fontWeight: '500', textTransform: 'uppercase' },
  bodyText: { color: '#f3f4f6', fontSize: 14, lineHeight: 20 },
  editedText: { color: '#6b7280', fontSize: 10, fontStyle: 'italic', marginTop: 2 },
  deletedText: { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },
  timeText: { color: '#6b7280', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  systemMsg: { alignItems: 'center', paddingVertical: 4 },
  systemMsgText: { color: '#6b7280', fontSize: 11, fontStyle: 'italic' },
  snapshotBadge: {
    marginTop: 4,
    backgroundColor: '#111827',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#374151',
  },
  snapshotText: { color: '#9ca3af', fontSize: 11 },
  reactionsRow: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: '#374151',
  },
  reactionPillActive: { backgroundColor: '#4c1d95', borderWidth: 1, borderColor: '#7c3aed' },
  reactionText: { color: '#d1d5db', fontSize: 11 },
  reactionPicker: {
    flexDirection: 'row',
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 6,
    gap: 8,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#374151',
  },
  reactionPickerItem: { padding: 4 },
  inputContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f2937',
    padding: 8,
  },
  aiIndicator: { color: '#06b6d4', fontSize: 10, marginBottom: 4, marginLeft: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  textInput: {
    flex: 1,
    backgroundColor: '#1f2937',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#f3f4f6',
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendButtonDisabled: { backgroundColor: '#374151' },
  sendButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});

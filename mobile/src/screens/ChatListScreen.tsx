import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useChatStore } from '@/stores/chat-store';
import type { ChatThreadWithPreview, ChatEntityType } from '@/types/chat';
import { colors } from '@/theme/colors';

const ENTITY_ICONS: Record<ChatEntityType, string> = {
  truck: '🚛',
  work_order: '📋',
  dtc: '⚠️',
  direct: '💬',
};

const ENTITY_LABELS: Record<ChatEntityType, string> = {
  truck: 'Trucks',
  work_order: 'Work Orders',
  dtc: 'DTCs',
  direct: 'Direct Messages',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ChatListScreen() {
  const router = useRouter();
  const { threads, totalUnread, isLoading, fetchThreads } = useChatStore();
  const [search, setSearch] = React.useState('');

  useEffect(() => {
    fetchThreads();
    const interval = setInterval(fetchThreads, 5000);
    return () => clearInterval(interval);
  }, [fetchThreads]);

  const filtered = threads.filter((t) =>
    !search || t.title.toLowerCase().includes(search.toLowerCase()),
  );

  // Group into sections
  const groups = new Map<ChatEntityType, ChatThreadWithPreview[]>();
  for (const t of filtered) {
    const list = groups.get(t.entityType) || [];
    list.push(t);
    groups.set(t.entityType, list);
  }

  const sections = Array.from(groups.entries()).map(([type, data]) => ({
    title: `${ENTITY_ICONS[type]} ${ENTITY_LABELS[type]}`,
    data,
  }));

  const renderItem = useCallback(
    ({ item }: { item: ChatThreadWithPreview }) => (
      <TouchableOpacity
        style={styles.threadRow}
        onPress={() => router.push(`/chat/thread?id=${item.id}`)}
      >
        <View style={styles.threadInfo}>
          <Text
            style={[
              styles.threadTitle,
              item.unreadCount > 0 && styles.threadTitleBold,
            ]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          {item.lastMessage && (
            <Text style={styles.threadPreview} numberOfLines={1}>
              {item.lastMessage.senderName}: {item.lastMessage.deletedAt ? '[deleted]' : item.lastMessage.body}
            </Text>
          )}
        </View>
        <View style={styles.threadMeta}>
          {item.lastMessage && (
            <Text style={styles.threadTime}>{timeAgo(item.lastMessage.createdAt)}</Text>
          )}
          {item.unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{item.unreadCount}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    ),
    [router],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          Chat {totalUnread > 0 ? `(${totalUnread})` : ''}
        </Text>
        <TouchableOpacity
          style={styles.newDmButton}
          onPress={() => router.push('/chat/new-dm')}
        >
          <Text style={styles.newDmText}>+ DM</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder="Search threads..."
        placeholderTextColor="#6b7280"
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchThreads}
            tintColor="#a855f7"
          />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>No threads found</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitle: { color: '#f3f4f6', fontSize: 18, fontWeight: '700' },
  newDmButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  newDmText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  searchInput: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#f3f4f6',
    fontSize: 13,
  },
  sectionHeader: {
    backgroundColor: '#0a0f1a',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  sectionTitle: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  threadRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
  },
  threadInfo: { flex: 1, marginRight: 8 },
  threadTitle: { color: '#d1d5db', fontSize: 14 },
  threadTitleBold: { color: '#f3f4f6', fontWeight: '700' },
  threadPreview: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  threadMeta: { alignItems: 'flex-end' },
  threadTime: { color: '#6b7280', fontSize: 11 },
  unreadBadge: {
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 5,
  },
  unreadText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  emptyText: {
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 13,
  },
});

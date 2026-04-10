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
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import type { ChatThreadWithPreview, ChatEntityType } from '@/types/chat';
import { colors } from '@/theme/colors';
import { spacing, radii } from '@/theme/spacing';
import { typography } from '@/theme/typography';

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

function ChatListScreenInner() {
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
        placeholderTextColor={colors.textMuted}
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
            tintColor={colors.primaryLight}
          />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>No threads found</Text>
        }
      />
    </View>
  );
}

export default function ChatListScreen() {
  return (
    <ErrorBoundary fallbackTitle="Chat crashed">
      <ChatListScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerTitle: { color: colors.text, fontSize: typography.sizes.lg, fontFamily: typography.fonts.heading },
  newDmButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.sm,
  },
  newDmText: { color: '#fff', fontSize: typography.sizes.xs, fontFamily: typography.fonts.heading },
  searchInput: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    backgroundColor: colors.surface1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
  },
  sectionHeader: {
    backgroundColor: colors.surface0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: typography.sizes['2xs'],
    fontFamily: typography.fonts.label,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
  },
  threadRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  threadInfo: { flex: 1, marginRight: spacing.sm },
  threadTitle: { color: colors.textSecondary, fontSize: typography.sizes.sm, fontFamily: typography.fonts.body },
  threadTitleBold: { color: colors.text, fontFamily: typography.fonts.heading },
  threadPreview: { color: colors.textMuted, fontSize: typography.sizes.xs, fontFamily: typography.fonts.body, marginTop: 2 },
  threadMeta: { alignItems: 'flex-end' },
  threadTime: { color: colors.textMuted, fontSize: typography.sizes['2xs'] },
  unreadBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: 5,
  },
  unreadText: { color: '#fff', fontSize: typography.sizes['2xs'], fontFamily: typography.fonts.heading },
  emptyText: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing['4xl'],
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
  },
});

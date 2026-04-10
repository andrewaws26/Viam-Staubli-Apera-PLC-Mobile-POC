import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { apiRequest } from '@/services/api-client';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { colors } from '@/theme/colors';
import { spacing, radii } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface OrgUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

const ROLE_COLORS: Record<string, string> = {
  developer: '#a855f7',
  manager: '#3b82f6',
  mechanic: '#22c55e',
  operator: '#eab308',
};

function NewDMScreenInner() {
  const router = useRouter();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<OrgUser[]>('/api/chat/users')
      .then(({ data }) => {
        if (data) setUsers(data as unknown as OrgUser[]);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter(
    (u) =>
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSelect = async (userId: string) => {
    try {
      // Create DM via threads API
      const { data } = await apiRequest<{ id: string }>('/api/chat/threads', {
        method: 'POST',
        body: { entityType: 'direct', memberIds: [userId] },
      });
      if (data) {
        router.replace(`/chat/thread?id=${(data as unknown as { id: string }).id}`);
      }
    } catch {
      // Silent
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
        placeholder="Search users..."
        placeholderTextColor={colors.textMuted}
        autoFocus
      />

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.userRow} onPress={() => handleSelect(item.id)}>
              <View>
                <Text style={styles.userName}>{item.name}</Text>
                <Text style={styles.userEmail}>{item.email}</Text>
              </View>
              <Text style={[styles.userRole, { color: ROLE_COLORS[item.role] || colors.textSecondary }]}>
                {item.role}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No users found</Text>
          }
        />
      )}
    </View>
  );
}

export default function NewDMScreen() {
  return (
    <ErrorBoundary fallbackTitle="New DM screen crashed">
      <NewDMScreenInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchInput: {
    margin: spacing.lg,
    backgroundColor: colors.surface1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fonts.body,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg - 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  userName: { color: colors.text, fontSize: typography.sizes.sm, fontFamily: typography.fonts.heading },
  userEmail: { color: colors.textMuted, fontSize: typography.sizes.xs, fontFamily: typography.fonts.body, marginTop: 2 },
  userRole: { fontSize: typography.sizes['2xs'], fontFamily: typography.fonts.label, textTransform: 'uppercase' },
  emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: spacing['4xl'], fontSize: typography.sizes.sm },
});

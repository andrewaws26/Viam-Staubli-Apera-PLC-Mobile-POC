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
import { useChatStore } from '@/stores/chat-store';

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

export default function NewDMScreen() {
  const router = useRouter();
  const { getOrCreateEntityThread } = useChatStore();
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
        placeholderTextColor="#6b7280"
        autoFocus
      />

      {loading ? (
        <ActivityIndicator color="#7c3aed" style={{ marginTop: 40 }} />
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
              <Text style={[styles.userRole, { color: ROLE_COLORS[item.role] || '#9ca3af' }]}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  searchInput: {
    margin: 16,
    backgroundColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f3f4f6',
    fontSize: 14,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
  },
  userName: { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  userEmail: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  userRole: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  emptyText: { color: '#6b7280', textAlign: 'center', marginTop: 40, fontSize: 13 },
});

/**
 * Zustand store for team chat state.
 */

import { create } from 'zustand';
import { apiRequest } from '@/services/api-client';
import type {
  ChatThread,
  ChatThreadWithPreview,
  ChatMessage,
  ChatReaction,
  SendMessagePayload,
  ChatEntityType,
} from '@/types/chat';

interface ChatState {
  threads: ChatThreadWithPreview[];
  activeThreadId: string | null;
  messages: Record<string, ChatMessage[]>;
  totalUnread: number;
  isLoading: boolean;

  fetchThreads: () => Promise<void>;
  fetchMessages: (threadId: string, before?: string) => Promise<void>;
  sendMessage: (payload: SendMessagePayload) => Promise<void>;
  toggleReaction: (threadId: string, messageId: string, reaction: ChatReaction) => Promise<void>;
  markRead: (threadId: string) => Promise<void>;
  setActiveThread: (threadId: string | null) => void;
  getOrCreateEntityThread: (entityType: ChatEntityType, entityId: string) => Promise<ChatThread>;
  pollForUpdates: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  messages: {},
  totalUnread: 0,
  isLoading: false,

  fetchThreads: async () => {
    set({ isLoading: true });
    const { data } = await apiRequest<ChatThreadWithPreview[]>('/api/chat/threads');
    if (data) {
      const totalUnread = (data as unknown as ChatThreadWithPreview[]).reduce(
        (sum: number, t: ChatThreadWithPreview) => sum + (t.unreadCount || 0),
        0,
      );
      set({ threads: data as unknown as ChatThreadWithPreview[], totalUnread, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  fetchMessages: async (threadId: string, before?: string) => {
    const params = new URLSearchParams({ limit: '50' });
    if (before) params.set('before', before);

    const { data } = await apiRequest<ChatMessage[]>(
      `/api/chat/threads/${threadId}/messages?${params}`,
    );
    if (data) {
      const msgs = data as unknown as ChatMessage[];
      const reversed = [...msgs].reverse();
      set((state) => ({
        messages: {
          ...state.messages,
          [threadId]: before
            ? [...reversed, ...(state.messages[threadId] || [])]
            : reversed,
        },
      }));
    }
  },

  sendMessage: async (payload: SendMessagePayload) => {
    const { data } = await apiRequest<ChatMessage>(
      `/api/chat/threads/${payload.threadId}/messages`,
      { method: 'POST', body: payload as unknown as Record<string, unknown> },
    );
    if (data) {
      const msg = data as unknown as ChatMessage;
      set((state) => ({
        messages: {
          ...state.messages,
          [payload.threadId]: [...(state.messages[payload.threadId] || []), msg],
        },
      }));
    }
  },

  toggleReaction: async (threadId: string, messageId: string, reaction: ChatReaction) => {
    const { data } = await apiRequest<unknown>(
      `/api/chat/threads/${threadId}/reactions`,
      { method: 'POST', body: { messageId, reaction } },
    );
    if (data) {
      set((state) => ({
        messages: {
          ...state.messages,
          [threadId]: (state.messages[threadId] || []).map((m) =>
            m.id === messageId ? { ...m, reactions: data as unknown as ChatMessage['reactions'] } : m,
          ),
        },
      }));
    }
  },

  markRead: async (threadId: string) => {
    await apiRequest(`/api/chat/threads/${threadId}/read`, { method: 'POST' });
  },

  setActiveThread: (threadId: string | null) => {
    set({ activeThreadId: threadId });
    if (threadId) {
      get().markRead(threadId);
    }
  },

  getOrCreateEntityThread: async (entityType: ChatEntityType, entityId: string) => {
    const { data } = await apiRequest<ChatThread>(
      `/api/chat/threads/by-entity?entity_type=${entityType}&entity_id=${encodeURIComponent(entityId)}`,
    );
    if (!data) throw new Error('Failed to get/create thread');
    return data as unknown as ChatThread;
  },

  pollForUpdates: async () => {
    const state = get();
    // Refresh thread list
    await state.fetchThreads();
    // Refresh active thread messages
    if (state.activeThreadId) {
      const msgs = state.messages[state.activeThreadId] || [];
      if (msgs.length > 0) {
        const lastId = msgs[msgs.length - 1].id;
        const params = new URLSearchParams({ after: lastId, limit: '50' });
        const { data } = await apiRequest<ChatMessage[]>(
          `/api/chat/threads/${state.activeThreadId}/messages?${params}`,
        );
        if (data && (data as unknown as ChatMessage[]).length > 0) {
          set((s) => ({
            messages: {
              ...s.messages,
              [state.activeThreadId!]: [
                ...(s.messages[state.activeThreadId!] || []),
                ...(data as unknown as ChatMessage[]),
              ],
            },
          }));
        }
      }
    }
  },
}));

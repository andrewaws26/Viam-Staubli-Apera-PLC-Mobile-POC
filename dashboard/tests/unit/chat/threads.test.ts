import { describe, it, expect } from 'vitest';
import {
  dbRowToThread,
  dbRowToMessage,
  dbRowToMember,
  VALID_REACTIONS,
  REACTION_LABELS,
  type ChatEntityType,
  type ChatReaction,
} from '@/lib/chat';

describe('Chat shared types and helpers', () => {
  describe('dbRowToThread', () => {
    it('maps DB row to ChatThread', () => {
      const row = {
        id: 'abc-123',
        entity_type: 'truck',
        entity_id: 'truck-7',
        title: 'Truck 7',
        created_by: 'user_1',
        pinned_message_id: null,
        deleted_at: null,
        created_at: '2026-04-07T10:00:00Z',
      };
      const thread = dbRowToThread(row);
      expect(thread.id).toBe('abc-123');
      expect(thread.entityType).toBe('truck');
      expect(thread.entityId).toBe('truck-7');
      expect(thread.title).toBe('Truck 7');
      expect(thread.createdBy).toBe('user_1');
      expect(thread.pinnedMessageId).toBeNull();
      expect(thread.deletedAt).toBeNull();
    });

    it('handles null entity_id for DMs', () => {
      const row = {
        id: 'dm-1',
        entity_type: 'direct',
        entity_id: null,
        title: 'DM with John',
        created_by: 'user_1',
        pinned_message_id: null,
        deleted_at: null,
        created_at: '2026-04-07T10:00:00Z',
      };
      const thread = dbRowToThread(row);
      expect(thread.entityId).toBeNull();
      expect(thread.entityType).toBe('direct');
    });
  });

  describe('dbRowToMessage', () => {
    it('maps DB row to ChatMessage with reactions', () => {
      const row = {
        id: 'msg-1',
        thread_id: 'thread-1',
        sender_id: 'user_1',
        sender_name: 'Andrew',
        sender_role: 'developer',
        message_type: 'user',
        body: 'Hello team',
        snapshot: null,
        attachments: [],
        edited_at: null,
        deleted_at: null,
        created_at: '2026-04-07T10:00:00Z',
      };
      const reactions = [
        { reaction: 'wrench' as ChatReaction, count: 2, userIds: ['u1', 'u2'], reacted: true },
      ];
      const msg = dbRowToMessage(row, reactions);
      expect(msg.senderId).toBe('user_1');
      expect(msg.senderName).toBe('Andrew');
      expect(msg.messageType).toBe('user');
      expect(msg.reactions).toHaveLength(1);
      expect(msg.reactions[0].reaction).toBe('wrench');
      expect(msg.reactions[0].count).toBe(2);
    });

    it('handles snapshot data', () => {
      const row = {
        id: 'msg-2',
        thread_id: 'thread-1',
        sender_id: 'user_1',
        sender_name: 'Andrew',
        sender_role: 'mechanic',
        message_type: 'user',
        body: 'Check RPM',
        snapshot: { engine_rpm: 1200, coolant_temp_f: 195, captured_at: '2026-04-07T10:00:00Z' },
        attachments: [{ url: 'https://example.com/photo.jpg', type: 'image', filename: 'photo.jpg' }],
        edited_at: '2026-04-07T10:05:00Z',
        deleted_at: null,
        created_at: '2026-04-07T10:00:00Z',
      };
      const msg = dbRowToMessage(row);
      expect(msg.snapshot).not.toBeNull();
      expect(msg.snapshot!.engine_rpm).toBe(1200);
      expect(msg.attachments).toHaveLength(1);
      expect(msg.editedAt).toBe('2026-04-07T10:05:00Z');
    });

    it('handles deleted messages', () => {
      const row = {
        id: 'msg-3',
        thread_id: 'thread-1',
        sender_id: 'user_1',
        sender_name: 'Andrew',
        sender_role: 'mechanic',
        message_type: 'user',
        body: 'Original text',
        snapshot: null,
        attachments: [],
        edited_at: null,
        deleted_at: '2026-04-07T11:00:00Z',
        created_at: '2026-04-07T10:00:00Z',
      };
      const msg = dbRowToMessage(row);
      expect(msg.deletedAt).toBe('2026-04-07T11:00:00Z');
    });
  });

  describe('dbRowToMember', () => {
    it('maps DB row to ChatThreadMember', () => {
      const row = {
        id: 'mem-1',
        thread_id: 'thread-1',
        user_id: 'user_1',
        role: 'member',
        last_read_at: '2026-04-07T10:00:00Z',
        joined_at: '2026-04-07T09:00:00Z',
      };
      const member = dbRowToMember(row);
      expect(member.threadId).toBe('thread-1');
      expect(member.userId).toBe('user_1');
      expect(member.role).toBe('member');
    });
  });

  describe('VALID_REACTIONS', () => {
    it('contains exactly 4 domain reactions', () => {
      expect(VALID_REACTIONS).toHaveLength(4);
      expect(VALID_REACTIONS).toContain('thumbs_up');
      expect(VALID_REACTIONS).toContain('wrench');
      expect(VALID_REACTIONS).toContain('checkmark');
      expect(VALID_REACTIONS).toContain('eyes');
    });

    it('rejects invalid reactions by type check', () => {
      const invalidReaction = 'heart';
      expect(VALID_REACTIONS.includes(invalidReaction as ChatReaction)).toBe(false);
    });
  });

  describe('REACTION_LABELS', () => {
    it('has emoji and label for each reaction', () => {
      for (const r of VALID_REACTIONS) {
        expect(REACTION_LABELS[r]).toBeDefined();
        expect(REACTION_LABELS[r].emoji).toBeTruthy();
        expect(REACTION_LABELS[r].label).toBeTruthy();
      }
    });

    it('wrench reaction means "On it"', () => {
      expect(REACTION_LABELS.wrench.label).toBe('On it');
    });
  });

  describe('entity types', () => {
    it('supports all four entity types', () => {
      const types: ChatEntityType[] = ['truck', 'work_order', 'dtc', 'direct'];
      for (const t of types) {
        const row = {
          id: 'test',
          entity_type: t,
          entity_id: t === 'direct' ? null : 'some-id',
          title: 'Test',
          created_by: 'user_1',
          pinned_message_id: null,
          deleted_at: null,
          created_at: '2026-04-07T10:00:00Z',
        };
        const thread = dbRowToThread(row);
        expect(thread.entityType).toBe(t);
      }
    });
  });
});

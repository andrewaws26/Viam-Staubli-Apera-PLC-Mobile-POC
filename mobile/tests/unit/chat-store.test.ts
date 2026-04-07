/**
 * Tests for the chat Zustand store.
 * Tests the store's state management logic.
 */

import {
  VALID_REACTIONS,
  REACTION_LABELS,
  dbRowToThread,
  dbRowToMessage,
  dbRowToMember,
} from '../../packages/shared/src/chat';

describe('Chat shared types', () => {
  describe('VALID_REACTIONS', () => {
    it('contains exactly 4 domain reactions', () => {
      expect(VALID_REACTIONS).toHaveLength(4);
      expect(VALID_REACTIONS).toContain('thumbs_up');
      expect(VALID_REACTIONS).toContain('wrench');
      expect(VALID_REACTIONS).toContain('checkmark');
      expect(VALID_REACTIONS).toContain('eyes');
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
  });

  describe('dbRowToThread', () => {
    it('converts DB row to ChatThread', () => {
      const thread = dbRowToThread({
        id: 't1',
        entity_type: 'truck',
        entity_id: 'truck-7',
        title: 'Truck 7',
        created_by: 'user_1',
        pinned_message_id: null,
        deleted_at: null,
        created_at: '2026-04-07T10:00:00Z',
      });

      expect(thread.id).toBe('t1');
      expect(thread.entityType).toBe('truck');
      expect(thread.entityId).toBe('truck-7');
      expect(thread.title).toBe('Truck 7');
    });
  });

  describe('dbRowToMessage', () => {
    it('converts DB row to ChatMessage', () => {
      const msg = dbRowToMessage({
        id: 'm1',
        thread_id: 't1',
        sender_id: 'u1',
        sender_name: 'Test',
        sender_role: 'mechanic',
        message_type: 'user',
        body: 'Hello',
        snapshot: null,
        attachments: [],
        edited_at: null,
        deleted_at: null,
        created_at: '2026-04-07T10:00:00Z',
      });

      expect(msg.id).toBe('m1');
      expect(msg.body).toBe('Hello');
      expect(msg.reactions).toEqual([]);
    });
  });

  describe('dbRowToMember', () => {
    it('converts DB row to ChatThreadMember', () => {
      const member = dbRowToMember({
        id: 'mem1',
        thread_id: 't1',
        user_id: 'u1',
        role: 'member',
        last_read_at: '2026-04-07T10:00:00Z',
        joined_at: '2026-04-07T09:00:00Z',
      });

      expect(member.userId).toBe('u1');
      expect(member.role).toBe('member');
    });
  });
});

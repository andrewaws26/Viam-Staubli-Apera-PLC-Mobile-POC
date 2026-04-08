-- Migration 004: Team Chat System
-- Contextual chat threads anchored to domain entities (trucks, work orders, DTCs)

-- ============================================================================
-- TABLES
-- ============================================================================

-- Chat threads — conversation containers anchored to entities
CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('truck', 'work_order', 'dtc', 'direct')),
  entity_id text,
  title text,
  created_by text NOT NULL,
  pinned_message_id uuid,  -- references chat_messages, added as FK after table exists
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Partial unique index: one thread per entity (except direct messages)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_threads_entity
  ON chat_threads (entity_type, entity_id)
  WHERE entity_type != 'direct' AND deleted_at IS NULL;

-- Chat thread members — who can see/post in a thread
CREATE TABLE IF NOT EXISTS chat_thread_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads ON DELETE CASCADE,
  user_id text NOT NULL,
  role text DEFAULT 'member' CHECK (role IN ('member', 'muted')),
  last_read_at timestamptz DEFAULT now(),
  joined_at timestamptz DEFAULT now(),
  UNIQUE (thread_id, user_id)
);

-- Chat messages — individual messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads ON DELETE CASCADE,
  sender_id text NOT NULL,
  sender_name text NOT NULL,
  sender_role text NOT NULL,
  message_type text NOT NULL DEFAULT 'user' CHECK (message_type IN ('user', 'system', 'ai', 'snapshot')),
  body text NOT NULL,
  snapshot jsonb,
  attachments jsonb DEFAULT '[]',
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Add FK for pinned_message_id now that chat_messages exists
ALTER TABLE chat_threads
  ADD CONSTRAINT fk_pinned_message
  FOREIGN KEY (pinned_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;

-- Chat reactions — domain-specific quick reactions
CREATE TABLE IF NOT EXISTS chat_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_messages ON DELETE CASCADE,
  user_id text NOT NULL,
  reaction text NOT NULL CHECK (reaction IN ('thumbs_up', 'wrench', 'checkmark', 'eyes')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (message_id, user_id, reaction)
);

-- Message reads — read tracking
CREATE TABLE IF NOT EXISTS message_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_messages ON DELETE CASCADE,
  reader_id text NOT NULL,
  read_at timestamptz DEFAULT now(),
  UNIQUE (message_id, reader_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
  ON chat_messages (thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
  ON chat_messages (sender_id);

CREATE INDEX IF NOT EXISTS idx_chat_thread_members_user
  ON chat_thread_members (user_id);

CREATE INDEX IF NOT EXISTS idx_chat_threads_entity
  ON chat_threads (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_chat_reactions_message
  ON chat_reactions (message_id);

CREATE INDEX IF NOT EXISTS idx_message_reads_reader
  ON message_reads (reader_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_thread_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;

-- Note: RLS policies use service_role key from the dashboard API routes,
-- so these policies are for direct Supabase access (future use).
-- The API routes enforce permissions in application code.

-- Threads: members can see their threads
CREATE POLICY "Members can view their threads"
  ON chat_threads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_thread_members
      WHERE chat_thread_members.thread_id = chat_threads.id
        AND chat_thread_members.user_id = auth.uid()::text
    )
  );

-- Messages: members can view messages in their threads
CREATE POLICY "Members can view thread messages"
  ON chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_thread_members
      WHERE chat_thread_members.thread_id = chat_messages.thread_id
        AND chat_thread_members.user_id = auth.uid()::text
    )
  );

-- Messages: members can insert into their threads
CREATE POLICY "Members can send messages"
  ON chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_thread_members
      WHERE chat_thread_members.thread_id = chat_messages.thread_id
        AND chat_thread_members.user_id = auth.uid()::text
    )
  );

-- Messages: users can update their own messages only
CREATE POLICY "Users can edit own messages"
  ON chat_messages FOR UPDATE
  USING (sender_id = auth.uid()::text);

-- Messages: users can soft-delete their own messages
CREATE POLICY "Users can delete own messages"
  ON chat_messages FOR DELETE
  USING (sender_id = auth.uid()::text);

-- Thread members: users can see memberships for their threads
CREATE POLICY "Members can view thread memberships"
  ON chat_thread_members FOR SELECT
  USING (user_id = auth.uid()::text OR
    EXISTS (
      SELECT 1 FROM chat_thread_members AS m2
      WHERE m2.thread_id = chat_thread_members.thread_id
        AND m2.user_id = auth.uid()::text
    )
  );

-- Reactions: members can manage their own reactions
CREATE POLICY "Members can add reactions"
  ON chat_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Members can remove own reactions"
  ON chat_reactions FOR DELETE
  USING (user_id = auth.uid()::text);

CREATE POLICY "Members can view reactions"
  ON chat_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_thread_members
      WHERE chat_thread_members.thread_id = (
        SELECT thread_id FROM chat_messages WHERE chat_messages.id = chat_reactions.message_id
      )
      AND chat_thread_members.user_id = auth.uid()::text
    )
  );

-- Message reads: users manage their own read status
CREATE POLICY "Users can manage own reads"
  ON message_reads FOR ALL
  USING (reader_id = auth.uid()::text);

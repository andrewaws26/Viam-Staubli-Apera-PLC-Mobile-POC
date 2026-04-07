// Team Chat — contextual conversations anchored to domain entities

// Entity types that threads anchor to
export type ChatEntityType = 'truck' | 'work_order' | 'dtc' | 'direct';

// Message types
export type ChatMessageType = 'user' | 'system' | 'ai' | 'snapshot';

// Domain-specific reactions only — no generic emoji
export type ChatReaction = 'thumbs_up' | 'wrench' | 'checkmark' | 'eyes';

// Display labels for reactions
export const REACTION_LABELS: Record<ChatReaction, { emoji: string; label: string }> = {
  thumbs_up: { emoji: '👍', label: 'Acknowledged' },
  wrench: { emoji: '🔧', label: 'On it' },
  checkmark: { emoji: '✅', label: 'Done' },
  eyes: { emoji: '👀', label: 'Looking into it' },
};

export const VALID_REACTIONS: ChatReaction[] = ['thumbs_up', 'wrench', 'checkmark', 'eyes'];

export interface ChatThread {
  id: string;
  entityType: ChatEntityType;
  entityId: string | null;
  title: string;
  createdBy: string;
  pinnedMessageId: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface ChatThreadMember {
  id: string;
  threadId: string;
  userId: string;
  role: string;
  lastReadAt: string;
  joinedAt: string;
}

export interface SensorSnapshot {
  // PLC data (truck entity threads)
  encoder_count?: number;
  plate_count?: number;
  avg_plates_per_min?: number;
  tie_spacing?: number;
  operating_mode?: string;
  // J1939 data (truck engine threads)
  engine_rpm?: number;
  coolant_temp_f?: number;
  oil_pressure_psi?: number;
  battery_voltage?: number;
  vehicle_speed_mph?: number;
  transmission_gear?: number;
  active_dtcs?: string[];
  // Timestamp
  captured_at: string;
}

export interface ChatAttachment {
  url: string;
  type: 'image' | 'video' | 'audio';
  filename: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  messageType: ChatMessageType;
  body: string;
  snapshot: SensorSnapshot | null;
  attachments: ChatAttachment[];
  reactions: ReactionSummary[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface ReactionSummary {
  reaction: ChatReaction;
  count: number;
  userIds: string[];
  reacted: boolean; // whether current user reacted
}

export interface ChatThreadWithPreview extends ChatThread {
  lastMessage: ChatMessage | null;
  unreadCount: number;
  memberCount: number;
}

// API payloads
export interface SendMessagePayload {
  threadId: string;
  body: string;
  snapshot?: SensorSnapshot;
  attachments?: ChatAttachment[];
  mentionAi?: boolean; // triggers AI response in thread
}

export interface CreateThreadPayload {
  entityType: ChatEntityType;
  entityId?: string;
  title?: string;
  memberIds: string[];
}

export interface EntityMention {
  type: 'truck' | 'work_order';
  id: string;
  display: string; // "@truck-7" or "@WO-1234"
}

// DB row to API type mapping helpers
export function dbRowToThread(row: Record<string, unknown>): ChatThread {
  return {
    id: row.id as string,
    entityType: row.entity_type as ChatEntityType,
    entityId: (row.entity_id as string) || null,
    title: (row.title as string) || '',
    createdBy: row.created_by as string,
    pinnedMessageId: (row.pinned_message_id as string) || null,
    deletedAt: (row.deleted_at as string) || null,
    createdAt: row.created_at as string,
  };
}

export function dbRowToMessage(
  row: Record<string, unknown>,
  reactions: ReactionSummary[] = [],
): ChatMessage {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    senderId: row.sender_id as string,
    senderName: row.sender_name as string,
    senderRole: row.sender_role as string,
    messageType: row.message_type as ChatMessageType,
    body: row.body as string,
    snapshot: (row.snapshot as SensorSnapshot) || null,
    attachments: (row.attachments as ChatAttachment[]) || [],
    reactions,
    editedAt: (row.edited_at as string) || null,
    deletedAt: (row.deleted_at as string) || null,
    createdAt: row.created_at as string,
  };
}

export function dbRowToMember(row: Record<string, unknown>): ChatThreadMember {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    userId: row.user_id as string,
    role: row.role as string,
    lastReadAt: row.last_read_at as string,
    joinedAt: row.joined_at as string,
  };
}

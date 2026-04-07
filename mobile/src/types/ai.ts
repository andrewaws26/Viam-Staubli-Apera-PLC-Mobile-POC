/** AI request and response types for the mobile app. */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  messages: ChatMessage[];
  readings: Record<string, unknown>;
}

export interface AiChatResponse {
  success: boolean;
  reply?: string;
  error?: string;
}

export interface AiDiagnoseRequest {
  readings: Record<string, unknown>;
}

export interface AiDiagnoseResponse {
  success: boolean;
  diagnosis?: string;
  error?: string;
}

export interface AiReportSummaryRequest {
  readings: Record<string, unknown>;
  history: Record<string, unknown>;
}

export interface AiReportSummaryResponse {
  success: boolean;
  summary?: string;
  error?: string;
}

/** Locally cached AI conversation */
export interface CachedConversation {
  id: string;
  truckId: string;
  userId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Locally cached AI diagnosis */
export interface CachedDiagnosis {
  id: string;
  truckId: string;
  dtcCodes: string[];
  diagnosis: string;
  createdAt: string;
}

/** Pending AI request queued for offline processing */
export interface PendingAiRequest {
  id: string;
  requestType: 'chat' | 'diagnose' | 'shift_report';
  truckId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  syncStatus: 'pending' | 'failed';
}

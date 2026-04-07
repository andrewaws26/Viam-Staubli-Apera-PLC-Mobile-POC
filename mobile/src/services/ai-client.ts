/**
 * AI service client.
 * All AI processing goes through the Vercel API routes — the mobile app
 * NEVER calls Anthropic directly. The server handles credentials, prompt
 * engineering, historical data injection, and DTC history context.
 *
 * Offline handling: requests are queued in pending_ai_requests and
 * processed when connectivity returns.
 */

import { apiRequest } from './api-client';
import type { ChatMessage, AiChatResponse, AiDiagnoseResponse, AiReportSummaryResponse } from '@/types/ai';

/**
 * Send a chat message to the AI mechanic.
 * The server injects live readings, 24h trends, and DTC history automatically.
 *
 * @param messages - Full conversation history
 * @param readings - Current cached truck readings (sent as context)
 * @returns AI response or error
 */
export async function chat(
  messages: ChatMessage[],
  readings: Record<string, unknown> = {},
): Promise<AiChatResponse> {
  const result = await apiRequest<AiChatResponse>('/api/ai-chat', {
    method: 'POST',
    body: { messages, readings },
    timeoutMs: 30000,
  });

  if (result.error) {
    return { success: false, error: result.error };
  }

  return result.data || { success: false, error: 'Empty response' };
}

/**
 * Request a full diagnostic analysis.
 * Returns a structured 6-section diagnosis.
 *
 * @param readings - Current truck readings
 */
export async function diagnose(
  readings: Record<string, unknown>,
): Promise<AiDiagnoseResponse> {
  const result = await apiRequest<AiDiagnoseResponse>('/api/ai-diagnose', {
    method: 'POST',
    body: { readings },
    timeoutMs: 60000,
  });

  if (result.error) {
    return { success: false, error: result.error };
  }

  return result.data || { success: false, error: 'Empty response' };
}

/**
 * Generate an AI summary for a shift report.
 *
 * @param readings - Current readings
 * @param history - Historical shift data
 */
export async function generateReportSummary(
  readings: Record<string, unknown>,
  history: Record<string, unknown>,
): Promise<AiReportSummaryResponse> {
  const result = await apiRequest<AiReportSummaryResponse>('/api/ai-report-summary', {
    method: 'POST',
    body: { readings, history },
    timeoutMs: 60000,
  });

  if (result.error) {
    return { success: false, error: result.error };
  }

  return result.data || { success: false, error: 'Empty response' };
}

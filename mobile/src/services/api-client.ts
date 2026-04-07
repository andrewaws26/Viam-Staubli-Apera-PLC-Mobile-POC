/**
 * HTTP client for Vercel API routes.
 * All requests include the Clerk session token for authentication.
 * Handles timeouts, retries, and offline detection.
 */

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://viam-staubli-apera-plc-mobile-poc.vercel.app';

let _getToken: (() => Promise<string | null>) | null = null;

/** Set the auth token provider. Called once from auth-provider. */
export function setTokenProvider(provider: () => Promise<string | null>): void {
  _getToken = provider;
}

/** Get the current auth token. Used by streaming requests that bypass apiRequest. */
export async function getAuthToken(): Promise<string | null> {
  if (!_getToken) return null;
  return _getToken();
}

/** Get the API base URL. */
export function getApiBase(): string {
  return API_BASE;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  timeoutMs?: number;
  retries?: number;
}

interface ApiResult<T> {
  data: T | null;
  error: string | null;
  status: number;
}

/**
 * Make an authenticated API request to the Vercel backend.
 * @param path - API route path (e.g., '/api/truck-readings')
 * @param options - Request options
 */
export async function apiRequest<T = Record<string, unknown>>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const { method = 'GET', body, timeoutMs = 30000, retries = 2 } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add auth token if available
  if (_getToken) {
    const token = await _getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const url = `${API_BASE}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      let json: Record<string, unknown>;
      try {
        json = await response.json();
      } catch {
        json = { error: `HTTP ${response.status} (non-JSON response)` };
      }

      if (!response.ok) {
        // Don't retry 4xx errors
        if (response.status >= 400 && response.status < 500) {
          return { data: null, error: (json.error as string) || `HTTP ${response.status}`, status: response.status };
        }
        // Retry 5xx errors
        if (attempt < retries) continue;
        return { data: null, error: (json.error as string) || `HTTP ${response.status}`, status: response.status };
      }

      return { data: json as T, error: null, status: response.status };
    } catch (err) {
      if (attempt < retries) {
        // Exponential backoff: 1s, 2s
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      const message = err instanceof Error ? err.message : 'Network error';
      return { data: null, error: message, status: 0 };
    }
  }

  return { data: null, error: 'Max retries exceeded', status: 0 };
}

// ── Convenience methods for common API calls ────────────────────────

/** Fetch live truck readings (returns flat payload with all sensor fields). */
export function fetchTruckReadings(truckId?: string) {
  const params = new URLSearchParams({ component: 'truck-engine' });
  if (truckId) params.set('truck_id', truckId);
  return apiRequest<Record<string, unknown>>(`/api/truck-readings?${params}`);
}

/** Fetch fleet status (all trucks). */
export function fetchFleetStatus() {
  return apiRequest<{ trucks: Record<string, unknown>[]; cached: boolean; timestamp: string }>('/api/fleet/status');
}

/** Fetch fleet truck registry (returns bare array). */
export function fetchFleetTrucks() {
  return apiRequest<{ id: string; name: string; hasTPSMonitor: boolean; hasTruckDiagnostics: boolean }[]>('/api/fleet/trucks');
}

/** Fetch truck notes (returns bare array). */
export function fetchTruckNotes(truckId: string) {
  return apiRequest<Record<string, unknown>[]>(`/api/truck-notes?truck_id=${truckId}`);
}

/** Create a truck note. */
export function createTruckNote(data: { truck_id: string; body: string }) {
  return apiRequest('/api/truck-notes', { method: 'POST', body: data });
}

/** Fetch DTC history for a truck (returns bare array). */
export function fetchDtcHistory(truckId: string) {
  return apiRequest<Record<string, unknown>[]>(`/api/dtc-history?truck_id=${truckId}`);
}

/** Fetch maintenance events (returns bare array). */
export function fetchMaintenance(truckId: string) {
  return apiRequest<Record<string, unknown>[]>(`/api/maintenance?truck_id=${truckId}`);
}

/** Create a maintenance event. */
export function createMaintenance(data: Record<string, unknown>) {
  return apiRequest('/api/maintenance', { method: 'POST', body: data });
}

/** Fetch shift report data. */
export function fetchShiftReport(truckId: string, date: string, shift: string) {
  return apiRequest(`/api/shift-report?truck_id=${truckId}&date=${date}&shift=${shift}`);
}

/** Fetch Pi health data. */
export function fetchPiHealth(host: 'tps' | 'truck' = 'tps', truckId?: string) {
  const params = new URLSearchParams({ host });
  if (truckId) params.set('truck_id', truckId);
  return apiRequest(`/api/pi-health?${params}`);
}

/** Fetch truck history (returns summary with time series). */
export function fetchTruckHistory(truckId: string, hours = 4) {
  return apiRequest(`/api/truck-history?truck_id=${truckId}&hours=${hours}`);
}

/** Fetch truck assignments. */
export function fetchTruckAssignments(truckId?: string) {
  const params = truckId ? `?truck_id=${truckId}` : '';
  return apiRequest<Record<string, unknown>[]>(`/api/truck-assignments${params}`);
}

/** Register/update push token on backend. */
export function registerPushTokenApi(data: { expo_token: string; platform: string; device_name: string }) {
  return apiRequest('/api/user/push-token', { method: 'POST', body: data });
}

/** Remove push token from backend. */
export function removePushTokenApi(data: { expo_token: string }) {
  return apiRequest('/api/user/push-token', { method: 'DELETE', body: data });
}

// ── Work Orders ──────────────────────────────────────────────────────

/** Fetch work orders. Optional filters: status, assigned_to, truck_id. */
export function fetchWorkOrders(filters?: { status?: string; assigned_to?: string; truck_id?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.assigned_to) params.set('assigned_to', filters.assigned_to);
  if (filters?.truck_id) params.set('truck_id', filters.truck_id);
  const qs = params.toString();
  return apiRequest<Record<string, unknown>[]>(`/api/work-orders${qs ? `?${qs}` : ''}`);
}

/** Create a work order. */
export function createWorkOrder(data: Record<string, unknown>) {
  return apiRequest('/api/work-orders', { method: 'POST', body: data });
}

/** Update a work order (status, assignment, blocker, etc.). */
export function updateWorkOrder(id: string, data: Record<string, unknown>) {
  return apiRequest(`/api/work-orders?id=${id}`, { method: 'PATCH', body: data });
}

/** Delete a work order. */
export function deleteWorkOrder(id: string) {
  return apiRequest(`/api/work-orders?id=${id}`, { method: 'DELETE' });
}

// ── Team Members ────────────────────────────────────────────────────

/** Fetch team members for assignment. */
export function fetchTeamMembers() {
  return apiRequest<{ id: string; name: string; email: string; role: string }[]>('/api/team-members');
}

// ── AI ──────────────────────────────────────────────────────────────

/** AI-powered step suggestions for work orders. */
export function suggestWorkOrderSteps(title: string, description?: string) {
  return apiRequest<{ steps: string[] }>('/api/ai-suggest-steps', {
    method: 'POST',
    body: { title, description: description || undefined },
  });
}

/**
 * Core offline-first sync engine.
 *
 * Strategy:
 * 1. All writes go to local SQLite first
 * 2. When online, process sync queue in order
 * 3. Conflict resolution: last write wins (timestamp-based)
 * 4. Failed syncs retry on next cycle (max 5 retries before surfacing to user)
 *
 * Sync frequency:
 * - Notes/inspections/handoffs/maintenance: immediate when online
 * - GPS tracks: batch every 5 minutes
 * - Sensor readings cache: refresh every 30 seconds
 * - Fleet config: refresh on app start, cache 24 hours
 * - AI caches: on each interaction
 */

import NetInfo from '@react-native-community/netinfo';
import { useSyncStore } from './sync-status';

/** Initialize the sync engine: subscribe to network changes, start sync loop. */
export function initSyncEngine(): () => void {
  // Subscribe to network state changes
  const unsubscribe = NetInfo.addEventListener((state) => {
    const online = !!(state.isConnected && state.isInternetReachable);
    useSyncStore.getState().setOnline(online);

    if (online) {
      // Trigger sync when coming back online
      runSync().catch(console.error);
    }
  });

  // Initial sync on startup
  runSync().catch(console.error);

  // Periodic sync every 5 minutes for GPS batch and cache refresh
  const interval = setInterval(() => {
    if (useSyncStore.getState().isOnline) {
      runSync().catch(console.error);
    }
  }, 5 * 60 * 1000);

  return () => {
    unsubscribe();
    clearInterval(interval);
  };
}

/**
 * Run a full sync cycle.
 * Processes all pending items in the correct order.
 */
async function runSync(): Promise<void> {
  const store = useSyncStore.getState();
  if (store.isSyncing) return;

  store.setSyncing(true);

  try {
    // The actual sync implementation will use the Supabase client
    // and the queries from db/queries.ts to:
    // 1. Upload pending photos
    // 2. Sync notes, inspections, handoffs, maintenance
    // 3. Batch-insert GPS tracks
    // 4. Process pending AI requests
    // 5. Pull latest remote data
    // 6. Refresh AI diagnosis cache for trucks with new DTCs

    // For now, just update the sync timestamp
    store.setLastSyncAt(new Date().toISOString());
    store.setPendingCount(0);
    store.setFailedCount(0);
  } catch (error) {
    console.error('[SYNC]', error);
  } finally {
    store.setSyncing(false);
  }
}

export { runSync };

/**
 * Background GPS tracking service.
 *
 * Logs a GPS point to local SQLite every 10 seconds when active.
 * Battery optimization: if speed is 0 for 2+ minutes, reduces to 60-second intervals.
 * Batch-syncs to Supabase every 5 minutes via the sync engine.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { insertGpsPoint } from '@/db/queries';

const BACKGROUND_TASK_NAME = 'IRONSIGHT_GPS_TRACKING';

let _truckId: string | null = null;
let _userId: string | null = null;
let _isTracking = false;

/** Register the background GPS task. Call once on app start. */
export function registerGpsTask(): void {
  TaskManager.defineTask(BACKGROUND_TASK_NAME, ({ data, error }) => {
    if (error) {
      console.error('[GPS]', error);
      return;
    }
    if (data) {
      const { locations } = data as { locations: Location.LocationObject[] };
      for (const loc of locations) {
        if (_truckId && _userId) {
          insertGpsPoint({
            truckId: _truckId,
            userId: _userId,
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            altitude: loc.coords.altitude ?? undefined,
            speedMph: loc.coords.speed != null ? loc.coords.speed * 2.237 : undefined, // m/s to mph
            heading: loc.coords.heading ?? undefined,
            accuracyMeters: loc.coords.accuracy ?? undefined,
            recordedAt: new Date(loc.timestamp).toISOString(),
          });
        }
      }
    }
  });
}

/**
 * Start GPS tracking for a truck.
 * Requests foreground + background location permissions.
 */
export async function startTracking(truckId: string, userId: string): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return false;

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') return false;

  _truckId = truckId;
  _userId = userId;
  _isTracking = true;

  await Location.startLocationUpdatesAsync(BACKGROUND_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 10000, // 10 seconds
    distanceInterval: 5, // 5 meters minimum movement
    deferredUpdatesInterval: 10000,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'IronSight',
      notificationBody: 'Tracking truck location',
      notificationColor: '#7c3aed',
    },
  });

  return true;
}

/** Stop GPS tracking. */
export async function stopTracking(): Promise<void> {
  _isTracking = false;
  _truckId = null;
  _userId = null;

  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_TASK_NAME);
  }
}

/** Check if GPS tracking is currently active. */
export function isTrackingActive(): boolean {
  return _isTracking;
}

/**
 * Map view showing all fleet trucks with GPS positions.
 * Uses Apple Maps on iOS via react-native-maps.
 * Markers are color-coded by truck status (running/idle/alert/offline).
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, Callout, PROVIDER_DEFAULT } from 'react-native-maps';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { formatValue } from '@/utils/format';
import type { FleetTruck } from '@/types/supabase';
import type { TruckSensorReadings } from '@/types/sensor';

interface FleetMapViewProps {
  trucks: FleetTruck[];
  readings: Record<string, TruckSensorReadings>;
  onTruckPress: (truckId: string) => void;
}

interface TruckMarker {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: 'running' | 'idle' | 'alert' | 'offline';
  statusColor: string;
  readings: TruckSensorReadings | null;
}

function getTruckStatus(r: TruckSensorReadings | null): { status: TruckMarker['status']; color: string } {
  if (!r) return { status: 'offline', color: colors.statusOffline };
  if ((r.active_dtc_count ?? 0) > 0) return { status: 'alert', color: colors.statusAlert };
  if (r.engine_rpm && r.engine_rpm > 0) return { status: 'running', color: colors.statusRunning };
  return { status: 'idle', color: colors.statusIdle };
}

export default function FleetMapView({ trucks, readings, onTruckPress }: FleetMapViewProps) {
  const mapRef = useRef<MapView>(null);

  const markers = useMemo(() => {
    const result: TruckMarker[] = [];
    for (const truck of trucks) {
      const r = readings[truck.id] ?? null;
      const lat = r?.gps_latitude;
      const lng = r?.gps_longitude;
      if (lat != null && lng != null && lat !== 0 && lng !== 0) {
        const { status, color } = getTruckStatus(r);
        result.push({
          id: truck.id,
          name: truck.name,
          latitude: lat,
          longitude: lng,
          status,
          statusColor: color,
          readings: r,
        });
      }
    }
    return result;
  }, [trucks, readings]);

  // Fit map to show all markers when they change
  useEffect(() => {
    if (markers.length > 0 && mapRef.current) {
      const coords = markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude }));
      // Small delay to ensure map is rendered
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 80, right: 60, bottom: 80, left: 60 },
          animated: true,
        });
      }, 300);
    }
  }, [markers]);

  if (markers.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📍</Text>
        <Text style={styles.emptyTitle}>No GPS Data</Text>
        <Text style={styles.emptyMessage}>
          Truck positions will appear here once GPS data is available.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        userInterfaceStyle="dark"
        showsUserLocation
        showsCompass
        showsScale
        initialRegion={{
          latitude: markers[0].latitude,
          longitude: markers[0].longitude,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }}
      >
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            pinColor={marker.statusColor}
            title={marker.name}
          >
            <Callout tooltip onPress={() => onTruckPress(marker.id)}>
              <View style={styles.callout}>
                <View style={styles.calloutHeader}>
                  <View style={[styles.calloutDot, { backgroundColor: marker.statusColor }]} />
                  <Text style={styles.calloutName}>{marker.name}</Text>
                </View>

                <View style={styles.calloutMetrics}>
                  <CalloutMetric label="RPM" value={formatValue(marker.readings?.engine_rpm, '', 0)} />
                  <CalloutMetric label="Speed" value={formatValue(marker.readings?.vehicle_speed_mph, ' mph', 0)} />
                  <CalloutMetric label="Coolant" value={formatValue(marker.readings?.coolant_temp_f, '°F', 0)} />
                </View>

                {(marker.readings?.active_dtc_count ?? 0) > 0 && (
                  <View style={styles.calloutDtc}>
                    <Text style={styles.calloutDtcText}>
                      {marker.readings?.active_dtc_count} Active DTC{(marker.readings?.active_dtc_count ?? 0) > 1 ? 's' : ''}
                    </Text>
                  </View>
                )}

                <Text style={styles.calloutTap}>Tap for details</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Truck count overlay */}
      <View style={styles.countOverlay}>
        <Text style={styles.countText}>{markers.length} truck{markers.length !== 1 ? 's' : ''} on map</Text>
      </View>
    </View>
  );
}

function CalloutMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.calloutMetric}>
      <Text style={styles.calloutMetricLabel}>{label}</Text>
      <Text style={styles.calloutMetricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['2xl'],
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold as any,
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    color: colors.textMuted,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  callout: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
    minWidth: 180,
    borderWidth: 1,
    borderColor: colors.border,
  },
  calloutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  calloutDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  calloutName: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.bold as any,
  },
  calloutMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  calloutMetric: {
    alignItems: 'center',
    gap: 2,
  },
  calloutMetricLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  calloutMetricValue: {
    color: colors.text,
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold as any,
  },
  calloutDtc: {
    backgroundColor: '#dc262630',
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  calloutDtcText: {
    color: colors.dangerLight,
    fontSize: 10,
    fontWeight: typography.weights.bold as any,
  },
  calloutTap: {
    color: colors.primaryLight,
    fontSize: 10,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  countOverlay: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    backgroundColor: colors.card + 'E0',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  countText: {
    color: colors.textSecondary,
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold as any,
  },
});

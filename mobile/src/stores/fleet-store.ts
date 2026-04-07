/**
 * Zustand store for fleet state — truck selection, cached readings.
 */

import { create } from 'zustand';
import type { FleetTruck } from '@/types/supabase';
import type { TruckSensorReadings } from '@/types/sensor';

interface FleetState {
  /** All trucks in the fleet */
  trucks: FleetTruck[];
  /** Currently selected truck ID */
  selectedTruckId: string | null;
  /** Cached readings per truck */
  readings: Record<string, TruckSensorReadings>;
  /** Timestamp of last readings fetch per truck */
  readingsUpdatedAt: Record<string, number>;
  /** Whether fleet data is loading */
  isLoading: boolean;

  setTrucks: (trucks: FleetTruck[]) => void;
  selectTruck: (id: string) => void;
  updateReadings: (truckId: string, readings: TruckSensorReadings) => void;
  setLoading: (loading: boolean) => void;
}

export const useFleetStore = create<FleetState>((set) => ({
  trucks: [],
  selectedTruckId: null,
  readings: {},
  readingsUpdatedAt: {},
  isLoading: false,

  setTrucks: (trucks) => set({ trucks }),

  selectTruck: (id) => set({ selectedTruckId: id }),

  updateReadings: (truckId, readings) =>
    set((state) => ({
      readings: { ...state.readings, [truckId]: readings },
      readingsUpdatedAt: { ...state.readingsUpdatedAt, [truckId]: Date.now() },
    })),

  setLoading: (loading) => set({ isLoading: loading }),
}));

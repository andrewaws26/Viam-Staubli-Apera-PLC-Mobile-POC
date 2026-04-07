"use client";

import React, { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { ChatThread, SensorSnapshot, dbRowToThread } from "@/lib/chat";
import ThreadView from "./ThreadView";

interface TruckChatTabProps {
  truckId: string;
  currentReadings?: Record<string, unknown> | null;
}

export default function TruckChatTab({ truckId, currentReadings }: TruckChatTabProps) {
  const { user } = useUser();
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function getOrCreateThread() {
      try {
        const res = await fetch(
          `/api/chat/threads/by-entity?entity_type=truck&entity_id=${encodeURIComponent(truckId)}`,
        );
        if (!res.ok) throw new Error("Failed to load chat");
        const data = await res.json();
        setThread(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load chat");
      } finally {
        setLoading(false);
      }
    }
    getOrCreateThread();
  }, [truckId]);

  // Build snapshot from current readings
  const snapshot: SensorSnapshot | undefined = currentReadings
    ? {
        engine_rpm: currentReadings.engine_rpm as number | undefined,
        coolant_temp_f: currentReadings.coolant_temp_f as number | undefined,
        oil_pressure_psi: currentReadings.oil_pressure_psi as number | undefined,
        battery_voltage: currentReadings.battery_voltage as number | undefined,
        vehicle_speed_mph: currentReadings.vehicle_speed_mph as number | undefined,
        transmission_gear: currentReadings.transmission_gear as number | undefined,
        active_dtcs: currentReadings.active_dtcs as string[] | undefined,
        plate_count: currentReadings.plate_count as number | undefined,
        avg_plates_per_min: currentReadings.avg_plates_per_min as number | undefined,
        operating_mode: currentReadings.operating_mode as string | undefined,
        captured_at: new Date().toISOString(),
      }
    : undefined;

  if (loading) {
    return <div className="text-center py-8 text-gray-500 text-sm">Loading chat...</div>;
  }

  if (error || !thread) {
    return <div className="text-center py-8 text-red-400 text-sm">{error || "Chat unavailable"}</div>;
  }

  return (
    <div className="h-[400px] border border-gray-700/50 rounded-lg overflow-hidden bg-gray-900/50">
      <div className="px-3 py-2 border-b border-gray-700/50 bg-gray-900/80">
        <h3 className="text-xs font-bold text-gray-200 uppercase tracking-wider">
          Team Chat — {thread.title}
        </h3>
      </div>
      <div className="h-[calc(100%-36px)]">
        <ThreadView
          threadId={thread.id}
          currentUserId={user?.id || ""}
          snapshot={snapshot}
        />
      </div>
    </div>
  );
}

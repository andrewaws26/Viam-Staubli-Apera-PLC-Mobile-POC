"use client";

import React from "react";
import TrendChart from "../TrendChart";

export interface TrendChartsGridProps {
  trendHistory?: Record<string, { time: number; value: number }[]>;
  busConnected?: boolean;
}

export default function TrendChartsGrid({
  trendHistory = {},
  busConnected = false,
}: TrendChartsGridProps) {
  if (!busConnected || Object.keys(trendHistory).length === 0) return null;

  return (
    <div className="mt-3">
      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
        {"\u{1F4C8}"} Live Trends
      </h4>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <TrendChart label="RPM" data={trendHistory.engine_rpm || []} color="#818cf8" />
        <TrendChart label="Coolant" data={trendHistory.coolant_temp_f || []} unit="°F" color="#f87171" warnThreshold={203} critThreshold={221} />
        <TrendChart label="Speed" data={trendHistory.vehicle_speed_mph || []} unit=" mph" color="#34d399" />
        <TrendChart label="Throttle" data={trendHistory.throttle_position_pct || []} unit="%" color="#fbbf24" />
        <TrendChart label="Battery" data={trendHistory.battery_voltage_v || []} unit="V" color="#60a5fa" warnThreshold={12} critThreshold={11.5} inverted />
        <TrendChart label="Oil Temp" data={trendHistory.oil_temp_f || []} unit="°F" color="#fb923c" warnThreshold={230} critThreshold={266} />
        <TrendChart label="Manifold" data={trendHistory.boost_pressure_psi || []} unit=" PSI" color="#a78bfa" />
        <TrendChart label="Fuel Level" data={trendHistory.fuel_level_pct || []} unit="%" color="#2dd4bf" warnThreshold={20} critThreshold={10} inverted />
        <TrendChart label="SCR Efficiency" data={trendHistory.scr_efficiency_pct || []} unit="%" color="#10b981" warnThreshold={80} critThreshold={50} inverted />
        <TrendChart label="DEF Level" data={trendHistory.def_level_pct || []} unit="%" color="#06b6d4" warnThreshold={15} critThreshold={5} inverted />
      </div>
    </div>
  );
}

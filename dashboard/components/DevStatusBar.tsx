"use client";

import { useState, useEffect } from "react";

interface PiStatus {
  online: boolean;
  hostname: string;
  tailscale_ip: string;
  _data_age_seconds?: number;
  cpu_temp_c?: number | null;
  memory_used_pct?: number | null;
  wifi_ssid?: string | null;
  error?: string;
}

const STATUS_POLL_MS = 5000;

export default function DevStatusBar() {
  const [tps, setTps] = useState<PiStatus | null>(null);
  const [viamOk, setViamOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const tpsRes = await fetch("/api/pi-health?host=tps")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (cancelled) return;
        setTps(tpsRes);
        setViamOk(tpsRes !== null && !tpsRes.error);
      } catch {
        if (!cancelled) setViamOk(false);
      }
    };
    poll();
    const id = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800">
      <div className="px-3 sm:px-6 py-2 flex items-center gap-3 sm:gap-5 text-xs sm:text-xs overflow-x-auto">
        <PiIndicator
          label="Pi 5"
          detail="All Modules"
          status={tps}
          defaultIp="100.112.68.52"
        />
        <Sep />
        <div className="flex items-center gap-1.5 shrink-0">
          <Dot
            color={viamOk === null ? "gray" : viamOk ? "green" : "red"}
          />
          <span className="text-gray-400 font-medium">
            <span className="hidden sm:inline">Viam </span>Cloud
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span
            className={`px-1.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
              process.env.NODE_ENV === "production"
                ? "bg-red-900/30 text-red-400"
                : "bg-green-900/30 text-green-400"
            }`}
          >
            {process.env.NODE_ENV === "production" ? "PROD" : "DEV"}
          </span>
          <a
            href="/"
            className="text-gray-500 hover:text-gray-300 transition-colors whitespace-nowrap"
          >
            <span className="hidden sm:inline">&larr; </span>Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

function PiIndicator({
  label,
  detail,
  status,
  defaultIp,
}: {
  label: string;
  detail: string;
  status: PiStatus | null;
  defaultIp: string;
}) {
  const online = status?.online ?? null;
  const age = status?._data_age_seconds;
  const ip = status?.tailscale_ip ?? defaultIp;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Dot color={online === null ? "gray" : online ? "green" : "red"} />
      <span className="text-gray-400 font-medium">{label}</span>
      <span className="hidden sm:inline text-gray-600">({detail})</span>
      <span className="hidden md:inline font-mono text-gray-600">{ip}</span>
      {age !== undefined && (
        <span
          className={`hidden sm:inline font-mono ${
            age < 10
              ? "text-green-600"
              : age < 60
                ? "text-yellow-600"
                : "text-red-600"
          }`}
        >
          {age < 5 ? "live" : `${Math.round(age)}s`}
        </span>
      )}
    </div>
  );
}

function Dot({ color }: { color: "green" | "yellow" | "red" | "gray" }) {
  const cls = {
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    red: "bg-red-500",
    gray: "bg-gray-600",
  }[color];
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

function Sep() {
  return <span className="hidden sm:block w-px h-4 bg-gray-800 shrink-0" />;
}

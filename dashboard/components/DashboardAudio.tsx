"use client";

import { useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Audio — industrial klaxon using Web Audio API.
// Two alternating sawtooth tones mimic a factory alarm.
// ---------------------------------------------------------------------------

function buildAlarmPlayer() {
  return () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();

      const bursts = [
        { freq: 880, t0: 0.0, t1: 0.18 },
        { freq: 1100, t0: 0.22, t1: 0.4 },
        { freq: 880, t0: 0.44, t1: 0.62 },
        { freq: 1100, t0: 0.66, t1: 0.84 },
      ];

      bursts.forEach(({ freq, t0, t1 }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.22, ctx.currentTime + t0);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t1);
        osc.start(ctx.currentTime + t0);
        osc.stop(ctx.currentTime + t1 + 0.05);
      });
    } catch {
      // Browser blocked autoplay — user must interact with the page first
    }
  };
}

// ---------------------------------------------------------------------------
// Hook: useAlarm — returns a stable function to trigger the alarm sound
// ---------------------------------------------------------------------------

export function useAlarm() {
  const playAlarm = useRef(buildAlarmPlayer());
  return useCallback(() => playAlarm.current(), []);
}

// ---------------------------------------------------------------------------
// FlashOverlay — full-screen flash on new faults, keyed to re-mount
// ---------------------------------------------------------------------------

export interface FlashOverlayProps {
  flashKey: number;
}

export function FlashOverlay({ flashKey }: FlashOverlayProps) {
  if (flashKey <= 0) return null;
  return (
    <div
      key={flashKey}
      className="fixed inset-0 pointer-events-none z-50"
      style={{ animation: "flashOut 0.7s ease-out forwards" }}
    />
  );
}

"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const DURATION_SECONDS = 8;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t) ^ (t >>> 14);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

export default function AudioWaveform({ seed }: { seed: number }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1

  const bars = useMemo(() => {
    const rng = mulberry32(seed);
    return Array.from({ length: 64 }, () => 0.15 + rng() * 0.85);
  }, [seed]);

  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - progress * DURATION_SECONDS * 1000;
    let raf: number;

    function tick(t: number) {
      const elapsed = (t - start) / 1000;
      const next = elapsed / DURATION_SECONDS;
      if (next >= 1) {
        setProgress(1);
        setPlaying(false);
        return;
      }
      setProgress(next);
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  function toggle() {
    if (progress >= 1) setProgress(0);
    setPlaying((p) => !p);
  }

  const elapsed = progress * DURATION_SECONDS;

  return (
    <div className="rounded-lg border border-[#24332a] bg-[#0f1913] p-4">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Captured Audio (CH. 01)
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e6a52d] text-black hover:bg-[#f0b63c]"
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>

        <div className="relative flex h-10 flex-1 items-center gap-[2px] overflow-hidden">
          {bars.map((h, i) => {
            const barProgress = i / bars.length;
            const played = barProgress <= progress;
            return (
              <span
                key={i}
                className={`w-full rounded-full transition-colors ${
                  played ? "bg-[#e6a52d]" : "bg-[#2a3830]"
                }`}
                style={{ height: `${h * 100}%` }}
              />
            );
          })}
        </div>

        <span className="w-16 shrink-0 text-right font-mono text-[10px] text-gray-500">
          {formatTime(elapsed)} / {formatTime(DURATION_SECONDS)}
        </span>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

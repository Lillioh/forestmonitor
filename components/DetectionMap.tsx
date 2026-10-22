"use client";

import dynamic from "next/dynamic";

const OfflineMap = dynamic(() => import("./OfflineMap"), {
  ssr: false,
  loading: () => <div className="flex h-[500px] items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--text-muted)]">Loading local map…</div>,
});

export default function DetectionMap() { return <OfflineMap />; }

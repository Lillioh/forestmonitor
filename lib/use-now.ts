"use client";

import { useCallback, useSyncExternalStore } from "react";

let clock = 0;
const snapshot = () => clock;
const serverSnapshot = () => 0;

export function useNow(intervalMs = 1000): number {
  const subscribe = useCallback((listener: () => void) => {
    const timer = setInterval(() => { clock = Date.now(); listener(); }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

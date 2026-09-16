"use client";

import { useEffect, useState } from "react";
import { DEMO_NOW } from "./mock-data";

/**
 * Returns the current epoch ms, ticking every `intervalMs`.
 * Starts at the fixed DEMO_NOW anchor on the server (and on first client
 * render) so SSR and hydration match exactly, then starts ticking with
 * real time once mounted in the browser.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(DEMO_NOW);

  useEffect(() => {
    // Intentional one-time correction from the SSR anchor to real client
    // time once mounted (the anchor keeps SSR/hydration output identical).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

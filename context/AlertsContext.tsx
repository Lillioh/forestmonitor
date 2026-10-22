"use client";

import type { MonitoringSettings, MonitoringState } from "@/lib/types";
import type { LocalUser } from "@/lib/server/accounts.mjs";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface AlertsContextValue extends MonitoringState {
  user: LocalUser;
  error: string | null;
  connected: boolean;
  getAlert: (id: string) => MonitoringState["alerts"][number] | undefined;
  dispatchAlert: (id: string, teamId?: string) => Promise<boolean>;
  markResolved: (id: string) => Promise<boolean>;
  markFalsePositive: (id: string) => Promise<boolean>;
  escalate: (id: string) => Promise<boolean>;
  assignTeam: (id: string, teamId: string) => Promise<boolean>;
  addTeam: (name: string) => Promise<boolean>;
  removeTeam: (id: string) => Promise<boolean>;
  saveSettings: (settings: MonitoringSettings) => Promise<boolean>;
  triggerDetection: () => Promise<boolean>;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

async function readResponse(response: Response) {
  if (response.status === 401) {
    // Discard all protected client state and cached layouts when the session expires.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
    throw new Error("Your session has expired. Please sign in again.");
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "The local server could not save your change.");
  return body;
}

export function AlertsProvider({ children, initialState, user }: { children: ReactNode; initialState: MonitoringState; user: LocalUser }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/state", { cache: "no-store", signal });
    const next: MonitoringState = await readResponse(response);
    setState(next);
    setConnected(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (controller.signal.aborted) return;
      try { await refresh(controller.signal); }
      catch { if (!controller.signal.aborted) setConnected(false); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);

  const mutate = useCallback(async (url: string, method: string, body: unknown = {}) => {
    setError(null);
    if (state.readOnly) { setError("This cloud dashboard is read-only. Make changes at the local outpost."); return false; }
    try {
      await readResponse(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      // A committed write stays successful if the subsequent read is interrupted.
      try { await refresh(); } catch { setConnected(false); }
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to reach the outpost server.");
      return false;
    }
  }, [refresh, state.readOnly]);

  const incidentAction = useCallback((id: string, action: string, teamId?: string) => mutate(`/api/alerts/${encodeURIComponent(id)}`, "PATCH", { action, teamId }), [mutate]);
  const value = useMemo<AlertsContextValue>(() => ({
    ...state, user, error, connected,
    getAlert: (id) => state.alerts.find((a) => a.id === id),
    dispatchAlert: (id, teamId) => incidentAction(id, "dispatch", teamId),
    markResolved: (id) => incidentAction(id, "resolve"),
    markFalsePositive: (id) => incidentAction(id, "false-positive"),
    escalate: (id) => incidentAction(id, "escalate"),
    assignTeam: (id, teamId) => incidentAction(id, "assign", teamId),
    triggerDetection: () => mutate("/api/alerts", "POST"),
    addTeam: (name) => mutate("/api/teams", "POST", { name }),
    removeTeam: (id) => mutate(`/api/teams/${encodeURIComponent(id)}`, "DELETE"),
    saveSettings: (settings) => mutate("/api/settings", "PATCH", settings),
  }), [state, user, error, connected, incidentAction, mutate]);

  return (
    <AlertsContext.Provider value={value}>
      <div className="flex h-full min-h-0 flex-col">
        {state.readOnly && <p role="status" className="shrink-0 bg-blue-100 px-4 py-2 text-xs text-blue-950">Cloud view - read-only. Last outpost contact: {state.sync.lastSyncedAt ? new Date(state.sync.lastSyncedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "waiting for first upload"}. Updates arrive when the Pi has internet access.</p>}
        {!state.readOnly && state.sync.enabled && <p role="status" className="shrink-0 bg-[var(--surface)] px-4 py-1 text-[10px] text-[var(--text-muted)]">Cloud mirror: {state.sync.pending ? `${state.sync.pending} changes queued` : "up to date"}{state.sync.error ? ` - ${state.sync.error} Local operation remains available.` : ""}</p>}
        {!connected && <p role="status" className="shrink-0 bg-amber-100 px-4 py-2 text-xs text-amber-950">Connection to the outpost server was lost. Showing the last received data; reconnecting automatically.</p>}
        {error && <div role="alert" className="flex shrink-0 items-center justify-between gap-3 bg-red-100 px-4 py-2 text-xs text-red-950"><span>{error}</span><button type="button" onClick={() => setError(null)} className="underline">Dismiss</button></div>}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </AlertsContext.Provider>
  );
}

export function useAlerts() {
  const context = useContext(AlertsContext);
  if (!context) throw new Error("useAlerts must be used within AlertsProvider");
  return context;
}

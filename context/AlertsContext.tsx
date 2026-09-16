"use client";

import {
  DISPATCH_TEAMS,
  INITIAL_NODE_EVENTS,
  INITIAL_SENSOR_NODES,
} from "@/lib/mock-data";
import {
  driftTelemetry,
  generateLiveAlert,
  generateNodeEvent,
  pickDispatchTeamId,
} from "@/lib/simulation";
import type { Alert, AlertStatus, DispatchTeam, NodeEvent, SensorNode } from "@/lib/types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// How often the simulated sensor mesh "ticks" — telemetry drifts and there's
// a chance of a new detection on every tick. This stands in for the real
// LoRa/Raspberry Pi telemetry feed until that hardware is wired up.
const TICK_MS = 7000;
const DETECTION_CHANCE = 0.18;
const NODE_EVENT_CHANCE = 0.3;
const MAX_NODE_EVENTS = 40;

interface AlertsContextValue {
  alerts: Alert[];
  sensors: SensorNode[];
  nodeEvents: NodeEvent[];
  teams: DispatchTeam[];
  simRunning: boolean;
  getAlert: (id: string) => Alert | undefined;
  dispatchAlert: (id: string, teamId?: string) => void;
  markResolved: (id: string) => void;
  markFalsePositive: (id: string) => void;
  escalate: (id: string) => void;
  assignTeam: (id: string, teamId: string) => void;
  setTeams: React.Dispatch<React.SetStateAction<DispatchTeam[]>>;
  triggerDetection: () => void;
  toggleSimulation: () => void;
  resetSimulation: () => void;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

function updateStatus(
  alerts: Alert[],
  id: string,
  status: AlertStatus,
  extra?: Partial<Alert>
): Alert[] {
  return alerts.map((a) => (a.id === id ? { ...a, status, ...extra } : a));
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sensors, setSensors] = useState<SensorNode[]>(INITIAL_SENSOR_NODES);
  const [nodeEvents, setNodeEvents] = useState<NodeEvent[]>(INITIAL_NODE_EVENTS);
  const [teams, setTeams] = useState<DispatchTeam[]>(DISPATCH_TEAMS);
  const [simRunning, setSimRunning] = useState(true);
  const seqRef = useRef(1);

  const spawnAlert = useCallback((now: number) => {
    const nodeIds = INITIAL_SENSOR_NODES.map((n) => n.id);
    const alert = generateLiveAlert(seqRef.current, nodeIds, now);
    seqRef.current += 1;
    setAlerts((prev) => [alert, ...prev]);
  }, []);

  // The live simulation "heartbeat" — drifts telemetry, occasionally logs a
  // node event, and occasionally spawns a fresh detection. Everything here
  // is generated on the fly; nothing is pre-scripted.
  useEffect(() => {
    if (!simRunning) return;

    const id = setInterval(() => {
      const now = Date.now();

      setSensors((prev) => prev.map((node) => driftTelemetry(node, now)));

      if (Math.random() < NODE_EVENT_CHANCE) {
        const node = INITIAL_SENSOR_NODES[Math.floor(Math.random() * INITIAL_SENSOR_NODES.length)];
        const event = generateNodeEvent(node.id, now);
        setNodeEvents((prev) => [event, ...prev].slice(0, MAX_NODE_EVENTS));
      }

      if (Math.random() < DETECTION_CHANCE) {
        spawnAlert(now);
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [simRunning, spawnAlert]);

  // One detection shortly after boot so the dashboard isn't sitting empty,
  // generated live the same way as any other — not a hardcoded scenario.
  useEffect(() => {
    const id = setTimeout(() => spawnAlert(Date.now()), 3000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getAlert = useCallback(
    (id: string) => alerts.find((a) => a.id === id),
    [alerts]
  );

  const dispatchAlert = useCallback((id: string, teamId?: string) => {
    setAlerts((prev) =>
      updateStatus(prev, id, "DISPATCHED", {
        assignedTeamId: teamId ?? prev.find((a) => a.id === id)?.assignedTeamId ?? pickDispatchTeamId(),
      })
    );
  }, []);

  const markResolved = useCallback((id: string) => {
    setAlerts((prev) =>
      updateStatus(prev, id, "RESOLVED", {
        responseMinutes:
          prev.find((a) => a.id === id)?.responseMinutes ??
          Number((Math.random() * 6 + 4).toFixed(1)),
      })
    );
  }, []);

  const markFalsePositive = useCallback((id: string) => {
    setAlerts((prev) => updateStatus(prev, id, "FALSE_POSITIVE"));
  }, []);

  const escalate = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, priority: "HIGH" } : a))
    );
  }, []);

  const assignTeam = useCallback((id: string, teamId: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, assignedTeamId: teamId } : a))
    );
  }, []);

  const triggerDetection = useCallback(() => {
    spawnAlert(Date.now());
  }, [spawnAlert]);

  const toggleSimulation = useCallback(() => {
    setSimRunning((r) => !r);
  }, []);

  const resetSimulation = useCallback(() => {
    setAlerts([]);
    setSensors(INITIAL_SENSOR_NODES);
    setNodeEvents(INITIAL_NODE_EVENTS);
    seqRef.current = 1;
  }, []);

  const value = useMemo(
    () => ({
      alerts,
      sensors,
      nodeEvents,
      teams,
      simRunning,
      getAlert,
      dispatchAlert,
      markResolved,
      markFalsePositive,
      escalate,
      assignTeam,
      setTeams,
      triggerDetection,
      toggleSimulation,
      resetSimulation,
    }),
    [
      alerts,
      sensors,
      nodeEvents,
      teams,
      simRunning,
      getAlert,
      dispatchAlert,
      markResolved,
      markFalsePositive,
      escalate,
      assignTeam,
      triggerDetection,
      toggleSimulation,
      resetSimulation,
    ]
  );

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts() {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error("useAlerts must be used within AlertsProvider");
  return ctx;
}

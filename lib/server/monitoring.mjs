import { randomUUID } from "node:crypto";
import { getDatabase, transaction, audit } from "./database.mjs";
import { localSyncStatus } from "./sync/local.mjs";
import { currentSensor } from "./sensor-status.mjs";

export class StoreError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function initializeMonitoring(defaults) {
  transaction((db) => {
    if (db.prepare("SELECT key FROM configuration WHERE key = 'initialized'").get()) return;
    for (const sensor of defaults.sensors) {
      db.prepare("INSERT INTO sensors (id, payload) VALUES (?, ?)").run(sensor.id, JSON.stringify({
        ...sensor, signal: null, battery: null, coreTemp: null, uptimeHours: null, lastSyncAt: 0, status: "OFFLINE",
      }));
    }
    for (const team of defaults.teams) db.prepare("INSERT INTO teams (id, payload) VALUES (?, ?)").run(team.id, JSON.stringify(team));
    db.prepare("INSERT INTO configuration (key, value) VALUES ('settings', ?)").run(JSON.stringify(defaults.settings));
    db.prepare("INSERT INTO configuration (key, value) VALUES ('initialized', 'true')").run();
  });
}

export function readState() {
  const state = transaction((db) => ({
    alerts: db.prepare("SELECT payload FROM incidents ORDER BY timestamp DESC, id DESC").all().map((r) => JSON.parse(r.payload)),
    sensors: db.prepare("SELECT payload FROM sensors ORDER BY id").all().map((r) => currentSensor(JSON.parse(r.payload))),
    nodeEvents: db.prepare("SELECT payload FROM node_events ORDER BY timestamp DESC LIMIT 100").all().map((r) => JSON.parse(r.payload)),
    teams: db.prepare("SELECT payload FROM teams ORDER BY rowid").all().map((r) => JSON.parse(r.payload)),
    settings: JSON.parse(db.prepare("SELECT value FROM configuration WHERE key = 'settings'").get().value),
    simulationEnabled: process.env.FOREST_SIMULATION_ENABLED === "true",
  }));
  return { ...state, readOnly: false, deployment: "local", sync: localSyncStatus(getDatabase()) };
}

export function createDetection(detection, actorId) {
  return transaction((db) => {
    const result = db.prepare("INSERT INTO incidents (timestamp, status, payload) VALUES (?, 'NEW', '{}')").run(detection.timestamp);
    const id = String(result.lastInsertRowid).padStart(3, "0");
    const alert = {
      ...detection, id, code: `INC-${new Date(detection.timestamp).getFullYear()}-${id.padStart(4, "0")}`,
      status: "NEW", assignedTeamId: null, responseMinutes: null,
    };
    db.prepare("UPDATE incidents SET payload = ? WHERE id = ?").run(JSON.stringify(alert), Number(id));
    audit(db, actorId, "DETECTION_CREATED", { id, source: alert.source });
    return alert;
  });
}

export function updateIncident(id, action, teamId, actorId) {
  return transaction((db) => {
    const row = db.prepare("SELECT payload FROM incidents WHERE id = ?").get(Number(id));
    if (!row) throw new StoreError("Incident not found.", 404);
    const alert = JSON.parse(row.payload);
    if (["RESOLVED", "FALSE_POSITIVE"].includes(alert.status)) throw new StoreError("This incident is already closed.", 409);
    const teams = db.prepare("SELECT payload FROM teams").all().map((r) => JSON.parse(r.payload));
    if (action === "dispatch" || action === "assign") {
      const chosenId = teamId || alert.assignedTeamId || teams.find((t) => t.status === "ACTIVE")?.id || teams.find((t) => t.status === "STANDBY")?.id;
      const team = teams.find((t) => t.id === chosenId && t.status !== "OFFLINE");
      if (!team) throw new StoreError("Select an available dispatch team.", 409);
      alert.assignedTeamId = team.id;
      if (action === "dispatch") {
        alert.status = "DISPATCHED";
        alert.dispatchedAt ??= Date.now();
        alert.responseMinutes = Number((Math.max(0, alert.dispatchedAt - alert.timestamp) / 60000).toFixed(2));
      }
    } else if (action === "resolve") {
      if (alert.status !== "DISPATCHED") throw new StoreError("Dispatch the incident before resolving it.", 409);
      alert.status = "RESOLVED";
      alert.resolvedAt = Date.now();
    } else if (action === "false-positive") {
      alert.status = "FALSE_POSITIVE";
      alert.resolvedAt = Date.now();
    } else if (action === "escalate") {
      alert.priority = "HIGH";
    } else throw new StoreError("Unknown incident action.");
    db.prepare("UPDATE incidents SET status = ?, payload = ? WHERE id = ?").run(alert.status, JSON.stringify(alert), Number(id));
    audit(db, actorId, `INCIDENT_${action.toUpperCase()}`, { id: alert.id, teamId: alert.assignedTeamId });
    return alert;
  });
}

export function addTeam(name, actorId) {
  if (typeof name !== "string" || !name.trim() || name.length > 80) throw new StoreError("Enter a team name of at most 80 characters.");
  return transaction((db) => {
    const team = { id: randomUUID(), name: name.trim(), shortCode: name.trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 4), members: 3, channel: "Local Radio", status: "STANDBY" };
    db.prepare("INSERT INTO teams (id, payload) VALUES (?, ?)").run(team.id, JSON.stringify(team));
    audit(db, actorId, "TEAM_CREATED", { id: team.id });
    return team;
  });
}

export function removeTeam(id, actorId) {
  transaction((db) => {
    // Keep historical assignments meaningful, including closed incidents.
    const assigned = db.prepare("SELECT id FROM incidents WHERE json_extract(payload, '$.assignedTeamId') = ? LIMIT 1").get(id);
    if (assigned) throw new StoreError("This team is referenced by an incident and cannot be removed.", 409);
    const result = db.prepare("DELETE FROM teams WHERE id = ?").run(id);
    if (!result.changes) throw new StoreError("Team not found.", 404);
    audit(db, actorId, "TEAM_REMOVED", { id });
  });
}

export function saveSettings(settings, actorId) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new StoreError("Invalid settings.");
  const { outpostName, location } = settings;
  if (typeof outpostName !== "string" || !outpostName.trim() || outpostName.length > 80 || typeof location !== "string" || !location.trim() || location.length > 160) throw new StoreError("Enter a valid outpost name and location.");
  // Only persist controls implemented by this deployment.
  const value = { outpostName: outpostName.trim(), location: location.trim() };
  transaction((db) => {
    db.prepare("UPDATE configuration SET value = ? WHERE key = 'settings'").run(JSON.stringify(value));
    audit(db, actorId, "SETTINGS_UPDATED", value);
  });
  return value;
}

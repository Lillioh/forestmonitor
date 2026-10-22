"use client";

import { useState } from "react";
import { useAlerts } from "@/context/AlertsContext";
import { alertsToCsv, downloadTextFile } from "@/lib/format";

export default function SettingsPage() {
  const { settings, user, teams, sensors, alerts, saveSettings, addTeam, removeTeam, simulationEnabled, triggerDetection, readOnly } = useAlerts();
  const admin = user.role === "admin" && !readOnly;
  const [outpostName, setOutpostName] = useState(settings.outpostName);
  const [location, setLocation] = useState(settings.location);
  const [newTeamName, setNewTeamName] = useState("");
  const [exportFormat, setExportFormat] = useState<"CSV" | "JSON" | "GeoJSON">("CSV");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true); setMessage(null);
    if (await saveSettings({ outpostName, location })) setMessage("Outpost details saved on this device.");
    setBusy(false);
  }

  async function createTeam() {
    if (!newTeamName.trim()) return;
    setBusy(true);
    if (await addTeam(newTeamName)) { setNewTeamName(""); setMessage("Dispatch team saved."); }
    setBusy(false);
  }

  function exportData() {
    if (exportFormat === "CSV") {
      downloadTextFile("forest-incidents.csv", alertsToCsv(alerts.map((a) => ({ id: a.code, time: new Date(a.timestamp).toISOString(), lat: a.lat, lng: a.lng, classification: a.classification, confidence: a.confidence, status: a.status, source: a.source ?? "SENSOR", team: a.assignedTeamId ?? "" }))), "text/csv");
    } else {
      const payload = exportFormat === "GeoJSON" ? { type: "FeatureCollection", features: alerts.map((a) => ({ type: "Feature", geometry: { type: "Point", coordinates: [a.lng, a.lat] }, properties: a })) } : { settings, sensors, alerts, teams };
      downloadTextFile(`forest-outpost-export.${exportFormat === "GeoJSON" ? "geojson" : "json"}`, JSON.stringify(payload, null, 2), "application/json");
    }
  }

  const input = "w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-60";
  const button = "rounded bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-black disabled:opacity-40";

  return <div className="space-y-5 p-5">
    <div><h2 className="text-sm font-semibold">Outpost settings</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{readOnly ? "This cloud copy displays records uploaded by the outpost." : "Accounts and monitoring records are stored on this outpost device."}</p></div>
    {!admin && <p className="text-xs text-[var(--text-muted)]">{readOnly ? "Manage outpost details and dispatch teams on the local Pi." : "Signed in as an operator. An administrator manages outpost details and dispatch teams."}</p>}
    {message && <p role="status" className="rounded border border-[var(--border)] bg-[var(--card)] p-3 text-xs">{message}</p>}
    <Panel title="Outpost details">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-xs"><span>Outpost name</span><input value={outpostName} onChange={(e) => setOutpostName(e.target.value)} maxLength={80} disabled={!admin || busy} className={input} /></label>
        <label className="space-y-2 text-xs"><span>Location</span><input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={160} disabled={!admin || busy} className={input} /></label>
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">Timezone: Asia/Manila (PHT +08:00)</p>
      {admin && <button onClick={save} disabled={busy || !outpostName.trim() || !location.trim()} className={`mt-4 ${button}`}>{busy ? "Saving…" : "Save outpost details"}</button>}
    </Panel>
    <Panel title="Dispatch teams">
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[var(--text-muted)]"><tr><th className="py-2">Team</th><th>Members</th><th>Channel</th><th>Status</th>{admin && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>
        {teams.map((team) => <tr key={team.id} className="border-t border-[var(--border)]"><td className="py-3 pr-3">{team.name}</td><td className="pr-3">{team.members}</td><td className="pr-3">{team.channel}</td><td className="pr-3">{team.status}</td>{admin && <td><button disabled={busy} onClick={async () => { setBusy(true); await removeTeam(team.id); setBusy(false); }} className="text-red-500 disabled:opacity-40">Remove</button></td>}</tr>)}
        {teams.length === 0 && <tr><td colSpan={admin ? 5 : 4} className="py-4 text-[var(--text-muted)]">No dispatch teams configured.</td></tr>}
      </tbody></table></div>
      {admin && <form onSubmit={(e) => { e.preventDefault(); void createTeam(); }} className="mt-4 flex gap-2"><input aria-label="New dispatch team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} maxLength={80} placeholder="New dispatch team name" disabled={busy} className={input} /><button disabled={busy || !newTeamName.trim()} className={`shrink-0 ${button}`}>Add team</button></form>}
    </Panel>
    <Panel title="Export monitoring records">
      <div className="flex flex-wrap items-center gap-3"><label className="text-xs">Format <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)} className="ml-2 rounded border border-[var(--border)] bg-[var(--panel)] p-2"><option>CSV</option><option>JSON</option><option>GeoJSON</option></select></label><button onClick={exportData} className={button}>Export data</button></div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">Exports contain monitoring records. Device backups must also include accounts, configuration, and recordings.</p>
    </Panel>
    {simulationEnabled && admin && <Panel title="Test detection"><p className="mb-3 text-xs text-[var(--text-muted)]">Test detections are labeled SIMULATED and saved in the incident log.</p><button onClick={() => triggerDetection()} className={button}>Generate test detection</button></Panel>}
  </div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"><h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</h3>{children}</section>;
}

"use client";

import Toggle from "@/components/ui/Toggle";
import { useAlerts } from "@/context/AlertsContext";
import { alertsToCsv, downloadTextFile } from "@/lib/format";
import { OUTPOST } from "@/lib/mock-data";
import type { DispatchTeam } from "@/lib/types";
import { useState } from "react";

const CHANNELS = ["SMS Gateway", "Email Report", "VHF Radio Broadcast", "Mobile Push Alert"];

export default function SettingsPage() {
  const { alerts, teams, setTeams, sensors, simRunning, toggleSimulation, triggerDetection, resetSimulation } =
    useAlerts();

  const [outpostName, setOutpostName] = useState(OUTPOST.name);
  const [location, setLocation] = useState(OUTPOST.location);
  const [meshProtocol, setMeshProtocol] = useState("LoRa 915MHz");
  const [errorRadius, setErrorRadius] = useState(15);
  const [syncInterval, setSyncInterval] = useState(5);
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [activeChannels, setActiveChannels] = useState<string[]>([
    "SMS Gateway",
    "Email Report",
  ]);
  const [escalationTimeout, setEscalationTimeout] = useState(10);
  const [retention, setRetention] = useState("90 days");
  const [exportFormat, setExportFormat] = useState<"CSV" | "JSON" | "GeoJSON">("CSV");
  const [autoExport, setAutoExport] = useState(true);
  const [newTeamName, setNewTeamName] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  function toggleChannel(channel: string) {
    setActiveChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  }

  function addTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    const team: DispatchTeam = {
      id: `team-${Date.now()}`,
      name,
      shortCode: name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 4),
      members: 3,
      channel: "Radio Mesh",
      status: "STANDBY",
    };
    setTeams((prev) => [...prev, team]);
    setNewTeamName("");
    showToast(`${name} added to dispatch teams`);
  }

  function removeTeam(id: string) {
    setTeams((prev) => prev.filter((t) => t.id !== id));
  }

  function handleExportAll() {
    if (exportFormat === "JSON" || exportFormat === "GeoJSON") {
      const payload =
        exportFormat === "GeoJSON"
          ? {
              type: "FeatureCollection",
              features: alerts.map((a) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [a.lng, a.lat] },
                properties: a,
              })),
            }
          : { sensors, alerts };
      downloadTextFile(
        `forest-outpost-export.${exportFormat === "GeoJSON" ? "geojson" : "json"}`,
        JSON.stringify(payload, null, 2),
        "application/json"
      );
    } else {
      const rows = alerts.map((a) => ({
        id: a.code,
        classification: a.classification,
        confidence: a.confidence,
        status: a.status,
        zone: a.zone,
      }));
      downloadTextFile("forest-outpost-export.csv", alertsToCsv(rows), "text/csv");
    }
    showToast("Export started — check your downloads");
  }

  return (
    <div className="space-y-5 p-5">
      <div>
        <p className="text-xs font-semibold tracking-wider text-gray-400">SETTINGS</p>
        <p className="text-[10px] text-gray-600">System Configuration · {outpostName}</p>
      </div>

      <Panel title="General System Details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Outpost Name">
            <input
              value={outpostName}
              onChange={(e) => setOutpostName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Timezone">
            <input value={OUTPOST.timezone} readOnly className="input opacity-60" />
          </Field>
          <Field label="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Language">
            <select value="English" disabled className="input opacity-60">
              <option>English</option>
            </select>
          </Field>
        </div>
      </Panel>

      <Panel title="Sensor Network Parameters">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Mesh Protocol">
            <select
              value={meshProtocol}
              onChange={(e) => setMeshProtocol(e.target.value)}
              className="input"
            >
              <option>LoRa 915MHz</option>
              <option>LoRa 868MHz</option>
              <option>Zigbee 2.4GHz</option>
            </select>
          </Field>
          <Field label="Error Radius Threshold (m)">
            <input
              type="number"
              value={errorRadius}
              onChange={(e) => setErrorRadius(Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="Sync Interval (s)">
            <input
              type="number"
              value={syncInterval}
              onChange={(e) => setSyncInterval(Number(e.target.value))}
              className="input"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Alert Configuration">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[11px] text-gray-300">Auto dispatch on High Confidence</span>
          <Toggle checked={autoDispatch} onChange={setAutoDispatch} />
        </div>

        <p className="mb-2 text-[10px] uppercase tracking-wider text-gray-600">
          Active Notification Channels
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {CHANNELS.map((channel) => {
            const active = activeChannels.includes(channel);
            return (
              <button
                key={channel}
                onClick={() => toggleChannel(channel)}
                className={`rounded-full border px-3 py-1.5 text-[10px] transition ${
                  active
                    ? "border-[#62b66d]/50 bg-[#62b66d]/15 text-[#8fd497]"
                    : "border-[#24332a] text-gray-500 hover:border-[#3a4d40]"
                }`}
              >
                {channel}
              </button>
            );
          })}
        </div>

        <Field label="Escalation Timeout (min)">
          <input
            type="number"
            value={escalationTimeout}
            onChange={(e) => setEscalationTimeout(Number(e.target.value))}
            className="input w-32"
          />
        </Field>
      </Panel>

      <Panel title="Dispatch Teams">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-gray-600">
              <th className="py-2 font-medium">Team Name</th>
              <th className="py-2 font-medium">Members</th>
              <th className="py-2 font-medium">Contact Channel</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id} className="border-t border-[#1b2620]">
                <td className="py-2 text-gray-200">{team.name}</td>
                <td className="py-2 text-gray-400">{team.members} rangers</td>
                <td className="py-2 text-gray-400">{team.channel}</td>
                <td className="py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[9px] font-bold ${
                      team.status === "ACTIVE"
                        ? "bg-[#62b66d]/15 text-[#8fd497]"
                        : team.status === "STANDBY"
                          ? "bg-[#e7a52c]/15 text-[#e7a52c]"
                          : "bg-gray-600/15 text-gray-500"
                    }`}
                  >
                    {team.status}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => removeTeam(team.id)}
                    className="text-[9px] text-gray-600 hover:text-[#e46a52]"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex gap-2">
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTeam()}
            placeholder="New team name..."
            className="input flex-1"
          />
          <button
            onClick={addTeam}
            className="rounded bg-[#e6a52d] px-4 py-2 text-[10px] font-bold text-black hover:bg-[#f0b63c]"
          >
            + Add Team
          </button>
        </div>
      </Panel>

      <Panel title="Data &amp; Export Preferences">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Data Retention Policy">
            <select
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              className="input"
            >
              <option>30 days</option>
              <option>90 days</option>
              <option>180 days</option>
              <option>1 year</option>
            </select>
          </Field>

          <Field label="Default Export Format">
            <div className="flex gap-2">
              {(["CSV", "JSON", "GeoJSON"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setExportFormat(fmt)}
                  className={`rounded border px-3 py-1.5 text-[10px] ${
                    exportFormat === fmt
                      ? "border-[#e6a52d] bg-[#e6a52d]/15 text-[#f0b63c]"
                      : "border-[#24332a] text-gray-500"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[11px] text-gray-300">Automated Daily Export</span>
          <Toggle checked={autoExport} onChange={setAutoExport} />
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={handleExportAll}
            className="rounded bg-[#e6a52d] px-4 py-2 text-[10px] font-bold text-black hover:bg-[#f0b63c]"
          >
            Export All Data
          </button>
          <button
            onClick={() => showToast("Local cache cleared")}
            className="rounded border border-[#24332a] px-4 py-2 text-[10px] text-gray-400 hover:bg-[#19251e]"
          >
            Clear Cache
          </button>
        </div>
      </Panel>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-[#24332a] bg-[#101a14] px-4 py-2 text-[11px] text-gray-200 shadow-lg">
          {toast}
        </div>
      )}

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid #24332a;
          background: #0f1913;
          padding: 0.5rem 0.75rem;
          font-size: 11px;
          color: #e5e7eb;
        }
        .input:focus {
          outline: none;
          border-color: #3a4d40;
        }
      `}</style>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#24332a] bg-[#101a14] p-4">
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] uppercase tracking-wider text-gray-600">
        {label}
      </span>
      {children}
    </label>
  );
}

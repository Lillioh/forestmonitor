import test from "node:test";
import assert from "node:assert/strict";
import { recordedIncidentTimeline } from "../lib/incident-timeline.ts";

test("incident timeline uses recorded detection, dispatch and resolution times", () => {
  const record = { timestamp: 1000, dispatchedAt: 95000, resolvedAt: 240000, status: "RESOLVED", source: "SENSOR" };
  assert.deepEqual(recordedIncidentTimeline(record), [
    { label: "Detection recorded", timestamp: 1000 },
    { label: "Dispatch recorded", timestamp: 95000 },
    { label: "Marked resolved", timestamp: 240000 },
  ]);
});

test("new and legacy incidents do not invent pipeline or response timestamps", () => {
  assert.deepEqual(recordedIncidentTimeline({ timestamp: 1000, status: "NEW" }), [{ label: "Detection recorded", timestamp: 1000 }]);
  assert.deepEqual(recordedIncidentTimeline({ timestamp: 1000, status: "RESOLVED" }), [{ label: "Detection recorded", timestamp: 1000 }]);
  assert.deepEqual(recordedIncidentTimeline({ timestamp: NaN, dispatchedAt: Infinity, status: "NEW" }), []);
});

test("simulations and false positives are labeled explicitly", () => {
  assert.deepEqual(recordedIncidentTimeline({ timestamp: 1000, resolvedAt: 7000, status: "FALSE_POSITIVE", source: "SIMULATION" }), [
    { label: "Simulated detection recorded", timestamp: 1000 },
    { label: "Marked false positive", timestamp: 7000 },
  ]);
});

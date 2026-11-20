import test from "node:test";
import assert from "node:assert/strict";
import { mapFeatures } from "../lib/maps/features.ts";
import { incidentPositionLabel } from "../lib/format.ts";

test("recording-node incidents have a map marker without a fabricated accuracy circle", () => {
  const incident = { id: "001", code: "INC-2026-0001", status: "NEW", lat: 8.46, lng: 124.7, radiusM: null, source: "SENSOR", locationBasis: "node_gps" };
  const features = mapFeatures([], [incident]);
  assert.equal(features.detections.features.length, 1);
  assert.deepEqual(features.detections.features[0].geometry.coordinates, [124.7, 8.46]);
  assert.equal(features.areas.features.length, 0);
  const legacy = mapFeatures([], [{ ...incident, radiusM: 12, locationBasis: undefined, source: "SIMULATION" }]);
  assert.equal(legacy.areas.features.length, 1);
});

test("location labels distinguish a node fix, stale GPS and configured position", () => {
  assert.equal(incidentPositionLabel("node_gps"), "Recording node GPS");
  assert.equal(incidentPositionLabel("node_last_known"), "Recording node's last known GPS");
  assert.equal(incidentPositionLabel("node_configured"), "Configured recording node position");
  assert.equal(incidentPositionLabel(undefined), "Estimated position");
});

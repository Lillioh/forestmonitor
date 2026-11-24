export function currentSensor(sensor, now = Date.now()) {
  if (!sensor.lastSyncAt) {
    return sensor.status === "OFFLINE" ? sensor : { ...sensor, status: "OFFLINE" };
  }
  const age = Math.max(0, now - sensor.lastSyncAt);
  const status = age > 180_000 ? "OFFLINE" : "ONLINE";
  return { ...sensor, status };
}

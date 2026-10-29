export function currentSensor(sensor, now = Date.now()) {
  if (!sensor.lastSyncAt) return sensor;
  const age = Math.max(0, now - sensor.lastSyncAt);
  const status = age > 180_000 ? "OFFLINE" : age > 90_000 || sensor.gpsFix === false ? "DEGRADED" : "ONLINE";
  return { ...sensor, status };
}

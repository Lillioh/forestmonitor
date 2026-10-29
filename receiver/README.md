# Wi-Fi receiver

The receiver accepts the ESP32's existing `/location` and `/upload` requests, classifies audio synchronously, and durably queues results for the local app. It never exposes recordings; PCM is discarded after classification, and the old `/listen` and `/nodes` routes are unavailable. GPS-only updates work without a model. Audio returns 503 until the compatible float32 model is installed. The model has not been supplied or accuracy validated.

## Setup on a Raspberry Pi (64-bit Linux, Python 3.11 through 3.13)

From the existing checkout as the user running the app:

For an existing outpost, run `npm run db:backup` before upgrading. The application migrates its database to schema version 3, which older app versions cannot open. Keep a consistent backup of both the app database and receiver spool after enabling ingestion.

```sh
cd ~/forestmonitor  # use the actual checkout path
python3 -m venv receiver/.venv
receiver/.venv/bin/pip install -r receiver/requirements.txt
mkdir -p data/models
# Copy the supplied model to data/models/honest_chainsaw_model.tflite.
receiver/.venv/bin/python receiver/provision.py --node node_A=NODE-01 --node node_B=NODE-02 --node node_C=NODE-03
chmod 600 .env.local .env.receiver.local data/receiver/nodes.json
```

Check `python3 --version` first; use Python 3.11 through 3.13. On Raspberry Pi OS, install the venv package with `sudo apt install python3-venv` if needed. After changing the model file, restart the receiver so it loads the new model.

The provisioner creates `.env.receiver.local` and `data/receiver/nodes.json` with absolute checkout paths and adds a new ingest secret to `.env.local` without removing existing settings. A blank or commented ingest setting is treated as unset. If a nonempty ingest secret already exists or the receiver files exist, it refuses to overwrite them: configure both sides manually. Keep these files private, and deliver each node its own token securely. Canonical IDs must already exist in the app. Copy the model into the ignored data directory; no model is included here. The published LiteRT 2.3.0 package has Linux ARM64 wheels for Python 3.11 through 3.13; install and test on the actual Pi.

To install the service, copy `deploy/forest-receiver.service` to `/etc/systemd/system/forest-receiver.service`, replace `YOUR_USER` with your current login and every `YOUR_CHECKOUT` with the checkout's absolute path, then run `sudo systemctl daemon-reload`, `sudo systemctl enable --now forest-receiver`, and `systemctl status forest-receiver`. The paths in the generated environment file must match. Restart the Next app so it reads `FOREST_INGEST_TOKEN`. The receiver's app credential is separate from each node credential. Keep the spool across restarts; losing it changes receiver identity and requires deliberate app-side reprovisioning. Only one receiver should own each node.

Restrict port 5000 to the trusted device network. The device connection carries a bearer secret: use TLS termination for untrusted networks. The app forwarding URL is restricted to loopback HTTP and redirects are refused.
## Device requests

Each device must persist a strictly increasing positive decimal counter (1 through 9007199254740991), shared by location and audio observations. Send observations in counter order, and reuse the same counter and identical content for every retry, including after a device restart. Reusing a counter with different content or sending an older, expired counter returns 409; do not silently advance past an unacknowledged observation. A success means the classification (when present) and result have been durably queued, and the app can catch up later.

```http
POST /location
Authorization: Bearer <node_A secret>
X-Event-ID: 1
Content-Type: application/json

{"node_id":"node_A","gps_fix":true,"latitude":8.46,"longitude":124.7}
```

`event_id` in the location JSON is also accepted. For a missing fix send `"gps_fix":false`.

```http
POST /upload
Authorization: Bearer <node_A secret>
X-Event-ID: 2
X-Node-ID: node_A
X-GPS-Fix: 1
X-GPS-Lat: 8.46
X-GPS-Lng: 124.7
X-Sample-Rate: 22050
Content-Type: application/octet-stream
Content-Length: 88200

<2 seconds of mono signed 16-bit little-endian PCM at 22050 Hz>
```

Use `X-GPS-Fix: 0` when there is no fix. Success includes `status`, `detected`, `chainsaw_probability`, `confidence`, and `result`. No filename is returned because recordings are not retained.

The spool retains delivered receipts for 7 days by default (`RECEIVER_RECEIPT_SECONDS`); the receiver keeps a permanent per-node counter watermark after receipts expire. A retry whose receipt has expired is rejected with 409, never accepted as a new observation. Pending and quarantined records are never evicted. If the app rejects an observation with HTTP 400 or 409, the receiver logs the node and counter and quarantines it while continuing other deliveries. Investigate and repair the app or configuration, then follow an operator recovery procedure; quarantined records count toward the limit and are not marked delivered. The default 100,000-record total cap includes pending records and receipts; it returns 503 when full, so the sender must retry. SQLite pages are capped at 256 MiB and the WAL is checkpointed; storage/permissions failures also prevent acknowledgment. Monitor service logs and available disk and investigate prolonged app unavailability. App-side receipts also persist after receiver receipts expire. Removing the spool or rotating node credentials needs an explicit plan; never silently replace receiver identity.

Run focused tests from the checkout with `PYTHONPATH=receiver receiver/.venv/bin/python -m unittest discover -s receiver/tests`.



To retry a quarantined event after its cause is fixed, stop the receiver, back up the spool including its WAL, then use the SQLite CLI against `data/receiver/spool.sqlite`. Inspect `SELECT node_id,event_id,rejected_status FROM events WHERE rejected_status IS NOT NULL;`. For the specific corrected event, run `UPDATE events SET rejected_status=NULL WHERE node_id='NODE-01' AND event_id='1' AND delivered_at IS NULL;` with its actual node and counter substituted. Restart the receiver and check the logs. Keep the record quarantined if the cause is not resolved; deleting it loses the accepted observation.

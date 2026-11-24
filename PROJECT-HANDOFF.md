# Forest Monitor project handoff

**24 November 2026 · Bantay Gubat / Forest Monitor · Forest Outpost 03**

Forest Monitor runs an acoustic monitoring outpost on a Raspberry Pi 4. Three ESP32 nodes can send microphone clips and GPS observations over the outpost Wi-Fi. The Pi classifies the clips, records incidents in SQLite, and serves a dashboard to operators on the LAN. An optional Vercel dashboard displays a one-way copy of the outpost records in MongoDB.

**Where to resume.** On November 20, the Pi operator reported the receiver listening on port 5000. Vercel served the expanded map and accepted the dashboard fix for an unlinked outpost. The outstanding milestone is a physical node producing a classified incident visible on the Pi and in the cloud. On the existing Pi, first check `systemctl status forest-monitor forest-receiver --no-pager` and `curl -sS http://127.0.0.1:3000/api/health`. Take **one node** through [field acceptance](#field-acceptance), then repeat with the other two.

| What the next maintainer has | What still needs confirmation |
| --- | --- |
| Local `main` and its saved `origin/main` reference point to `3b4144e`. That revision contains the Wi-Fi receiver, wider Iligan map and cloud dashboard fix. | Which revision and configuration are installed on the Pi and each ESP32. The current Windows working tree contains newer code. |
| The Windows checkout contains the newer firmware, receiver, dashboard changes and a private model file. | Transfer of the intended model to the Pi, successful inference there, accuracy on labeled field recordings, and actual capture from all three microphones. |
| The November 20 deployment record reports a successful production deploy, map download and public health check. | The physical Pi's cloud registration, acknowledged upload, matching cloud incident, and automatic service recovery after reboot. Production was not queried for this handoff. |

**Contents** · [System and operator workflow](#system-and-operator-workflow) · [Changes and release boundaries](#changes-and-release-boundaries) · [Pi installation](#install-the-local-outpost) · [Receiver and nodes](#provision-the-receiver-and-nodes) · [Map maintenance](#maintain-the-offline-map) · [Cloud linking](#link-the-optional-cloud-dashboard) · [Backup and recovery](#back-up-and-recover-the-outpost) · [Field acceptance](#field-acceptance) · [Verification and source documents](#verification-and-source-documents)

## System and operator workflow

```text
ESP32 A / B / C  ── Wi-Fi, TCP 5000 ──► Pi receiver (Flask + Waitress)
                                         ├─ classify PCM with LiteRT
                                         └─ persist result in receiver SQLite spool
                                                    │ loopback POST /api/ingest
                                                    ▼
LAN browser ◄──── TCP 3000 ────► Next.js on Pi ◄──► outpost SQLite
                                                          │ transactional outbox
                                                          ▼
                                              optional Pi sync worker
                                                          │ HTTPS POST /api/sync
                                                          ▼
                                        Vercel + MongoDB ◄── cloud viewer
```

The Pi owns the operational record. Dispatch still works when the internet is down as long as the browser can reach the Pi. A disconnected browser cannot save an action. The cloud viewer uses separate accounts and shows the last outpost contact. Even a cloud administrator has read-only access to monitoring records.

| Operator screen | How to use it |
| --- | --- |
| Dashboard, `/dashboard` | Review active incidents, the regional map and incident feed. In the working tree, **Clear All** hides existing feed entries across tabs using the same site and browser profile. **Show hidden** brings them back. The Alert Log and other browser profiles keep their records. |
| Sensor Nodes, `/sensor-nodes` | Check node identity, last contact, GPS and last classification separately. The three initial sensor positions are configured defaults. The topology illustration describes configured links. It provides no live LoRa link measurements. |
| Alert Log, `/alerts` | Search or filter by status, open an incident and export the matching records to CSV. To distinguish simulations, open the incident detail or use a Settings export that includes the source. |
| Incident, `/incidents/[id]` | Assign an available team, dispatch, escalate, or mark a false positive. Dispatch first to resolve an incident. Resolution and false-positive status close it to further actions. Response time runs from detection to first dispatch. The timeline uses recorded timestamps. |
| Reports, `/reports` | Review the rolling 30-day window. Reports exclude simulations and use Manila time for the hourly breakdown. |
| Settings, `/settings` | Local admins can change outpost details and teams. With simulation enabled they can generate a labeled test detection. Settings exports incidents as CSV or GeoJSON and outpost monitoring data as JSON. Database recovery requires a separate backup. |

The app seeds Forest Outpost 03, three offline nodes and four teams on first initialization. Operators and admins can respond to incidents locally. Admins also manage configuration. The authenticated browser reloads state roughly every five seconds and after a mutation. There are no default credentials, public sign-up, or automatic simulated detections.

### What a detection means

One positive clip from one node creates one high-priority `SENSOR` incident. The time shown is the receiver's observation time. The map uses the reporting node's GPS fix, its applicable last-known position, or its configured position. A label identifies the source of the coordinates. A negative clip updates the node's classification and event history. Three nodes hearing the same sound can create three incidents.

Wi-Fi incidents have no estimated sound-source position, uncertainty radius, measured TDoA, or playable recording. Time difference of arrival (TDoA) would require validated cross-node timing and a localization algorithm. The current firmware records timing information for bench work. Historical or simulated waveform displays are labeled demonstrations. Live LoRa ingestion, delivered notifications, training datasets, and a model-training pipeline are outside the delivered system.

### Interfaces and data ownership

| Interface or store | Owner and contents |
| --- | --- |
| `POST /location`, `POST /upload`, `GET /clock` on port 5000 | Python receiver. Each board authenticates with its own alias and bearer token. Only the working-tree receiver provides the clock route. |
| `POST /api/ingest` on port 3000 | Local Next.js app. The receiver forwards a versioned observation over loopback with a separate ingest token. The write includes the receipt, updated node, node event, any new incident and associated outbox changes in one transaction. |
| Browser API on port 3000 or cloud HTTPS | `POST /api/auth/login` and `/api/auth/logout` manage sessions. `GET /api/state` and `GET /api/maps` require login. `GET` and `HEAD /api/maps/archive` serve the map. Local writes use `POST /api/alerts`, `PATCH /api/alerts/[id]`, `PATCH /api/settings`, `POST /api/teams`, and `DELETE /api/teams/[id]` with role checks. Creating a simulation also requires the simulation flag. |
| `GET /api/health` | Public readiness probe for the selected database. HTTP 200 returns `{"status":"ok"}`. HTTP 503 means the database check failed. A healthy response alone says nothing about node contact, model inference, or sync. |
| `data/receiver/spool.sqlite` | Receiver identity, outgoing sequence, per-node high-water counters, accepted envelopes, delivery receipts, quarantined events, and working-tree `audio_timing` rows. PCM is discarded. |
| `data/forest-monitor.sqlite` | Local accounts, hashed sessions, login attempts, settings, sensors, teams, incidents, node events, audits and ingestion receipts. Schema v2 added outpost identity and sync outbox. Schema v3 added ingestion receipts. SQLite uses WAL and full synchronous commits. |
| `POST /api/sync` and MongoDB | Optional cloud receiver validates the registered device and token. MongoDB holds device acknowledgments, mirrored documents and separate cloud users, sessions and login attempts. Local accounts, audit history, raw audio, receiver timing rows and receiver secrets stay out of the sync payload. |

There are three separate identities to preserve. A board's alias and counter identify its observations. The receiver UUID and sequence live in the spool. The outpost UUID and cloud acknowledgment history live in the app database. Restoring only one database, erasing board counters, or registering a development computer as the Pi can break continuity.

## Changes and release boundaries

### Committed on main

| Date | Revision | Change |
| --- | --- | --- |
| Sep 16–Oct 4 | `fc4c3cb` through `62ab729` | Initial dashboard and subsequent navigation, sensor, incident and detection-map work. Earlier browser-only simulated history has no persistent record to migrate. |
| Oct 22 | `61560c4` | Moved operations to Pi-hosted Next.js and SQLite, replaced Supabase login, introduced local accounts, protected APIs, bundled offline maps, deployment units and the optional sync design. |
| Oct 23 | `d176072` | Added MongoDB connection diagnostics, connection handling, cloud account safeguards and database health reporting. |
| Oct 29 | `b900bdb`, `5632bd8` | Aligned map asset handling and server packaging, then updated dependencies and Pi deployment guidance. The lockfile now specifies Next.js 16.4.3. |
| Nov 20 | `81514d9` | Added authenticated Wi-Fi GPS and audio ingestion, Python classification and durable forwarding, schema v3, recording-node location labels, receiver provisioning, service and tests. |
| Nov 20 | `ff673b8` | Replaced the default map archive with coverage of Iligan, central Cagayan de Oro and Mapawa–Malasag. Updated its manifest and operating instructions. |
| Nov 20 | `3b4144e` | Allowed authenticated cloud viewers to open an empty read-only dashboard and map before a physical outpost is registered or selected. |

### Present only in the working tree

At review, Git showed **27 modified tracked files and three untracked source files** before this handoff was added. A clone or archive made from `main` alone omits these changes. Carry the intended source revision to the Pi and both firmware files to the flashing computer. Transfer credentials and the model separately.

| Area | What changed after the last commit |
| --- | --- |
| Firmware | New untracked [ESP32 sketch](firmware/ForestMonitorESP32/ForestMonitorESP32.ino) and [clock helper](firmware/ForestMonitorESP32/ClockSync.h). Continuous sound-triggered capture, manual capture, one RAM clip buffer, boot GPS fix, quiet heartbeat, nonvolatile counter and Pi clock sampling. The per-board `node_config.h` is ignored. |
| Receiver and classifier | DC-offset removal and peak normalization, cached spectral calculations, model warmup with retry on first audio, concurrent feature work with serialized interpreter access, configurable inclusive threshold, GPS-assisted wall-clock correction, authenticated capture timing and a corrected full-size upload limit. Receiver config, systemd capabilities, README and tests changed with these features. |
| Ingestion and status | The committed receiver used a score strictly greater than 0.60. The working-tree receiver and web app agree that a score **at or above** the configured threshold is positive, with a default of **0.70**. A node with contact in the last 180 seconds is online. A node with no contact, or older contact, is offline. GPS fix and last classification are separate evidence. The committed README's degraded state at 90 seconds describes the older code. |
| Dashboard | Updated Forest Monitor branding, taller map, responsive sensor cards, simpler telemetry displays and clearer negative-classification labels. The incident feed gained browser-local hide and restore behavior through the untracked [incident feed helper](lib/incident-feed.ts). Future map extracts also use the updated name. |
| Tests | Expanded receiver, ingestion and feed tests and adjusted compiled-route and Wi-Fi HTTP expectations. Earlier reports' test counts, thresholds, firmware behavior and map dimensions belong to their respective snapshots. |

The Git remote is [Lillioh/forestmonitor](https://github.com/Lillioh/forestmonitor). To identify a deployed Git checkout, run `git rev-parse --short HEAD` and `git status --short --branch` there. For an extracted archive with no Git metadata, compare the source files and map/model checksums with the intended package. Deploy the receiver and ingest changes together to keep the threshold rule consistent.

## Install the local outpost

The target is a Raspberry Pi 4 Model B with 8 GB RAM, 64-bit Linux, local persistent storage and a trusted LAN. Node must be **24.15.0 or later within 24.x**. The app uses Node's built-in SQLite. Initial installation needs internet or preloaded packages. Install dependencies on the Pi so npm selects ARM64 packages. The reported Pi login is `thesis2026`; the examples assume `/home/thesis2026/forestmonitor`.

**Existing outpost:** take a backup with the **currently installed release** before opening the database with newer code. The backup helper opens the database and can run migrations. Older versions cannot open schema v3. Preserve the private configuration, spool and identity as described under [backup and recovery](#back-up-and-recover-the-outpost).

**Pi terminal.** Run each command separately from the directory containing `package.json` and `package-lock.json`.

```sh
cd ~/forestmonitor
uname -m
node --version
npm --version
npm ci
test -e .env.local || cp .env.example .env.local
npm run account:create
npm run build -- --webpack
npm start -- --hostname 0.0.0.0
```

Expect `aarch64` on the Pi. If Node is absent and the Pi already uses nvm, run `nvm install 24` and `nvm use 24`, then check the version. Use an `admin` role for the first account and a unique 12–128 character password. On a provisioned Pi, retain the existing account and environment. Browse to `http://localhost:3000` on the Pi or `http://PI_LAN_IP:3000` on the outpost Wi-Fi. The last command runs in the foreground. Stop that foreground instance before starting the systemd unit on the same port.

Create other local accounts with `npm run account:create`. Reset a password with `npm run account:reset`; reset revokes that user's sessions. For a terminal without hidden input, `npm run account:create -- --username admin --name Administrator --role admin --generate-password` displays a generated password once. Store it privately. Local passwords use salted scrypt. Sessions use hashed random tokens with a 12-hour lifetime and an HttpOnly, SameSite=Lax cookie. Login attempts are limited. On a shared network use HTTPS and set `FOREST_COOKIE_SECURE=true`.

**Windows development.** From the repository, use `if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }` and `npm.cmd` wherever PowerShell blocks `npm.ps1`. Use `npm run dev` for development. Each local database generates its own identity. The Windows development identity is unsuitable for linking the physical Pi.

### Configuration by host

| Location | Values to set or verify |
| --- | --- |
| Pi `.env.local` | `FOREST_DEPLOYMENT=local`. `FOREST_DATABASE_PATH=./data/forest-monitor.sqlite` or an absolute path on persistent storage. `FOREST_MAP_ARCHIVE=./public/maps/mapawa_malasag.pmtiles`. `FOREST_COOKIE_SECURE=false` for HTTP on the trusted LAN. `FOREST_SIMULATION_ENABLED=false` by default. Provision `FOREST_INGEST_TOKEN` for the receiver. Leave `FOREST_SYNC_URL` and `FOREST_SYNC_TOKEN` empty until cloud linking. |
| Pi `.env.receiver.local` | `RECEIVER_NODES_FILE`, `RECEIVER_DATABASE` and `RECEIVER_MODEL` are absolute paths. `WEBSITE_LOCATION_URL=http://127.0.0.1:3000/api/ingest`. `WEBSITE_API_TOKEN` must match the app's ingest token. Defaults are `RECEIVER_HOST=0.0.0.0`, `RECEIVER_PORT=5000`, `RECEIVER_CAPACITY=100000` and `RECEIVER_RECEIPT_SECONDS=604800`. Working-tree defaults add `RECEIVER_THRESHOLD=0.70` and `RECEIVER_GPS_CLOCK_SYNC=1`. |
| Each board's private header | `WIFI_SSID`, `WIFI_PASSWORD`, `PI_BASE_URL`, `NODE_ID`, `NODE_TOKEN`. The URL is the Pi's LAN address with port 5000. A separate token identifies each alias. |
| Admin computer `.env.cloud.local` and Vercel environment | `FOREST_DEPLOYMENT=cloud`, `MONGODB_URI`, `MONGODB_DATABASE=forest_monitor`, `FOREST_CLOUD_DEVICE_ID`, `FOREST_COOKIE_SECURE=true`, simulation disabled and the bundled map path. Next.js does not automatically load the admin CLI's `.env.cloud.local`. Set the production values in Vercel. |

Keep passwords, connection strings, node tokens and upload tokens out of source control and browser-exposed `NEXT_PUBLIC_` variables. The [local](.env.example), [receiver](.env.receiver.example) and [cloud](.env.cloud.example) examples are safe starting points.

## Provision the receiver and nodes

### Install the receiver on the Pi

1. In the Pi checkout, check `python3 --version`. Use Python 3.11 through 3.13 on 64-bit Linux. If the venv module is missing on Raspberry Pi OS, install `sudo apt install python3-venv`.
2. Create the virtual environment and install the pinned Flask, Waitress, NumPy, librosa and LiteRT dependencies.

   ```sh
   cd ~/forestmonitor
   python3 -m venv receiver/.venv
   receiver/.venv/bin/pip install -r receiver/requirements.txt
   mkdir -p data/models
   ```

3. Transfer the intended model. The file checked for this handoff is the **checkout's** `data/models/honest_chainsaw_model.tflite`, 2,719,388 bytes, SHA-256 `9417557bfde938ded4f1e9d9ef540a8e495d672ad441960579ad246a0e8fcbe9`. It is ignored by Git. A file with the same name was found in Downloads during earlier setup. Use the digest to identify the copy you deploy.

   **Windows PowerShell, from the checkout.** Substitute the actual Pi address for `PI_LAN_IP`. Preserve an existing deployed model before replacing it.

   ```powershell
   scp .\data\models\honest_chainsaw_model.tflite thesis2026@PI_LAN_IP:~/forestmonitor/data/models/
   ```

   **Pi terminal.** Compare the digest, then run a compatibility check. The printed score for silence is a smoke test. Use labeled recordings to evaluate detection accuracy.

   ```sh
   sha256sum data/models/honest_chainsaw_model.tflite
   PYTHONPATH=receiver receiver/.venv/bin/python -c "from classifier import Classifier; print(Classifier('data/models/honest_chainsaw_model.tflite')(bytes(88200)))"
   ```

4. Provision a **new** receiver once. For an existing receiver, retain its registry, credentials and spool. The provisioner refuses to overwrite existing receiver files or a populated app ingest secret.

   ```sh
   receiver/.venv/bin/python receiver/provision.py --node node_A=NODE-01 --node node_B=NODE-02 --node node_C=NODE-03
   chmod 600 .env.local .env.receiver.local data/receiver/nodes.json
   ```

   The command creates private per-node tokens in `data/receiver/nodes.json`, writes absolute paths to `.env.receiver.local`, and adds the matching app credential to `.env.local`. If configuring the two sides manually, match `WEBSITE_API_TOKEN` and `FOREST_INGEST_TOKEN`. Give each board only its own node token. One receiver owns each canonical sensor ID.

5. Install the services below. Restart the dashboard after provisioning so it reads the ingest token. Restart the receiver after changing the model. GPS requests can succeed without a model. An audio request receives HTTP 503 while classification is unavailable.

### Run the services after reboot

Use the templates in [deploy](deploy). The dashboard and worker templates assume `User=forest`, `/opt/forest-monitor` and `/usr/bin/npm`. The receiver template uses `YOUR_USER` and `YOUR_CHECKOUT`. On the reported Pi, substitute `thesis2026` and `/home/thesis2026/forestmonitor`. Check `command -v node` and `command -v npm` as the service user. With nvm, set the unit's `ExecStart` to the actual npm path and include its Node bin directory in the unit's `PATH`. systemd does not load an interactive shell profile.

**Pi terminal, first installation.** Copy each template, then edit the installed file **before** enabling it. For an existing installation, preserve site-specific settings and merge the template changes.

```sh
sudo install -m 0644 deploy/forest-monitor.service /etc/systemd/system/forest-monitor.service
sudoedit /etc/systemd/system/forest-monitor.service
sudo install -m 0644 deploy/forest-receiver.service /etc/systemd/system/forest-receiver.service
sudoedit /etc/systemd/system/forest-receiver.service
sudo systemctl daemon-reload
sudo systemctl enable --now forest-monitor
sudo systemctl enable --now forest-receiver
systemctl status forest-monitor forest-receiver --no-pager
curl -sS http://127.0.0.1:3000/api/health
ss -ltn
```

Expect the app on port **3000**, the receiver on **5000**, and a healthy local database response. The receiver replaces the old `test4.py` listener. Only one process can own port 5000. Restrict it to the trusted device LAN. The supplied sketch uses HTTP and has no configured TLS trust anchor. An untrusted network requires a tested HTTPS endpoint and certificate validation on the boards for both uploads and clock requests. Receiver-to-app forwarding uses loopback HTTP and refuses redirects.

### Configure and flash one ESP32

Use the [sketch](firmware/ForestMonitorESP32/ForestMonitorESP32.ino) and [ClockSync.h](firmware/ForestMonitorESP32/ClockSync.h) from this working tree together. The target used for local verification is the classic ESP32 Dev Module (`esp32:esp32:esp32`), with Arduino ESP32 core 3.3.7 and TinyGPSPlus 1.0.3.

| Connection | Sketch setting |
| --- | --- |
| GPS module TX to ESP32 RX | GPIO 16, serial at 9600 baud, 8N1 |
| I²S microphone | BCLK GPIO 32, WS GPIO 25, microphone data out to ESP32 GPIO 27. The sketch reads the left channel. |
| Audio | 22,050 samples/second, mono, signed 16-bit little-endian PCM. Two seconds is 44,100 samples or 88,200 bytes. |

1. In the sketch directory, create or select the private `node_config.h` for **one** board. This placeholder template shows the required names.

   ```cpp
   #pragma once
   constexpr char WIFI_SSID[] = "YOUR_WIFI_NAME";
   constexpr char WIFI_PASSWORD[] = "YOUR_HOTSPOT_PASSWORD";
   constexpr char PI_BASE_URL[] = "http://PI_LAN_IP:5000";
   constexpr char NODE_ID[] = "node_A";
   constexpr char NODE_TOKEN[] = "REPLACE_WITH_THIS_NODES_PROVISIONED_TOKEN";
   ```

2. Set the Pi's reachable LAN IP with no trailing slash. Match each alias to its provisioned token and canonical ID. The normal mapping is `node_A → NODE-01`, `node_B → NODE-02`, `node_C → NODE-03`. Keep the header private, including when transferring a sketch directory.
3. Select the intended board and serial port in the Arduino IDE, verify the sketch, upload it, and open Serial Monitor at **115200 baud**. Look for Wi-Fi connection, microphone monitoring, GPS boot fix and `[CLOCK] Pi time available`. Press **R** for one controlled two-second capture. Record the event ID and HTTP result.
4. Check that the expected node updates in the local dashboard before flashing the next one. The sketch locks its station location after a valid boot fix with UTC and stops GPS polling. Reboot a relocated node and confirm a new fix. Later quiet heartbeats normally omit coordinates. For the exact last-fix time, open `/api/state` in a signed-in browser and inspect the matching sensor's `lastGpsAt`.

The working-tree sketch triggers on one 20 ms block at or above its default **−45 dBFS** level. This level triggers a recording. The Pi separately compares the model score with `RECEIVER_THRESHOLD`. The node normally sends a quiet heartbeat after about 60 seconds. It keeps one clip in RAM, counts triggers missed while busy, discards offline clips, and releases the buffer after an upload attempt.

### Receiver contract and capture timing

| Request | Data to send | Expected result |
| --- | --- | --- |
| `POST /location` | Node bearer token, `X-Event-ID`, JSON with `node_id` and `gps_fix`. Include `latitude` and `longitude` for a fix. A string `event_id` in the body is also accepted. | HTTP 200 with `accepted` and the event ID after the receiver has persisted the observation. |
| `POST /upload` | Node bearer token, `X-Node-ID`, `X-Event-ID`, `X-GPS-Fix`, coordinates when valid, `X-Sample-Rate: 22050`, and 88,200 bytes of raw PCM with `Content-Type: application/octet-stream`. | HTTP 200 with ID, probability, threshold, decision and model hash after classification and spool commit. The local dashboard can catch up later. |
| `GET /clock` | Working-tree receiver and firmware, node token and `X-Node-ID`. | HTTP 204 with `X-Pi-Receive-Us`, `X-Pi-Send-Us`, and `X-Pi-Clock-Id`. The clock ID changes whenever the receiver process restarts. |

The protocol expects a strictly increasing, positive decimal event counter shared by location and audio, up to 9,007,199,254,740,991. A sender retry must reuse the original counter and identical observation. The receiver can serve an exact retry from its receipt without a second inference or incident. A conflicting or expired counter gets HTTP 409. **The current sketch persists the counter but does not retain failed clips for replay.** A failed boot-location attempt also takes a new counter on a later attempt. The receiver's durability guarantee starts when it accepts an observation.

The classifier removes DC offset, normalizes clip level, trims/pads audio, and produces a 128 × 87 log-Mel feature array. It expects one float32 input `[1,128,87,1]` and one float32 output containing a single probability. The receiver records the model's SHA-256 with the result. The current default decision is `probability >= 0.70`. Keep the exact model, preprocessing version and threshold with evaluation results.

The firmware sends its local first-sample time in `X-Audio-Start-Us`. With a recent Pi clock exchange it adds the Pi clock ID, estimated Pi first-sample time, round-trip time and sample age. The receiver stores these diagnostics in its own `audio_timing` table. A stale clock ID leaves only the board's local sample time. Clock sampling is separate from UTC. With `RECEIVER_GPS_CLOCK_SYNC=1`, valid node GPS UTC can advance the Pi wall clock by at least five seconds when NTP does not report synchronization and the service has `CAP_SYS_TIME`. Set the option to `0` if another service owns wall-clock correction. The receiver refuses backward steps.

**Pi terminal, after a real clip.** Use the configured spool path. Detailed wire examples and timing headers are in the [receiver README](receiver/README.md).

```sh
sqlite3 -readonly data/receiver/spool.sqlite 'SELECT node_id,event_id,timing FROM audio_timing ORDER BY rowid DESC LIMIT 6;'
```

## Maintain the offline map

The active file retains the name `public/maps/mapawa_malasag.pmtiles`. It now covers **Iligan City, central Cagayan de Oro and Mapawa–Malasag**. The pinned Protomaps build is dated 18 November 2026, schema 4.15.2. Bounds are west 124.14, south 7.96, east 124.80, north 8.58. The archive has **4,769 addressed tiles**, zooms **8–15**, and **12,706,615 bytes**. SHA-256 is `ef9346c62b07bfad193bc36cf24ab31de89242e56207962c4a4f6dd9deb346cc`. A second, older `outpost.pmtiles` is bundled. Check `FOREST_MAP_ARCHIVE` to identify the file the Pi actually serves.

1. Run `npm run map:assets -- --check` offline to verify the bundled archive, worker, fonts and sprites. When online, `npm run map:assets` refreshes the pinned display assets. Preserve attribution and license files.
2. For the documented **smaller custom region**, run the following while connected. Choose a new output path when an existing package needs preserving.

   ```sh
   npm run map:prepare -- --source https://build.protomaps.com/20261026.pmtiles --bounds 124.66,8.42,124.75,8.475 --max-zoom 15 --output data/maps/mapawa_malasag.pmtiles
   ```

3. Set `FOREST_MAP_ARCHIVE` to the desired file and restart the dashboard. The extractor limits candidate tiles to 4,096 and compressed tile data to 256 MiB. Distribute the verified bundled archive to reproduce the full Iligan region. The smaller example produces different coverage. If the Pi already uses the earlier transferred `data/maps/iligan-cdo.pmtiles`, compare its digest before changing the configured path.
4. For a different Vercel region, replace the bundled default archive, update its manifest and attribution, verify the assets and rebuild. The Next.js route traces explicitly include the bundled archives.

MapLibre uses the viewing browser's WebGL, two workers and a bounded tile cache. It serves its styles, glyphs, sprites and map locally. The authenticated archive endpoint uses HTTP 206 byte ranges up to 4 MiB. Preserve range headers, ETag and untransformed content through any proxy. A missing archive or WebGL failure produces a coordinate view. Out-of-region sensors trigger a warning and coordinate view. Detail above zoom 15 is enlarged vector data. The package has no automatic update, satellite imagery or routing. [Asset manifest](public/maps/asset-manifest.json) · [Map sources and licenses](public/maps/NOTICE.txt)

## Link the optional cloud dashboard

The previously deployed site was [Forest Monitor on Vercel](https://forestmonitor-ebon.vercel.app). Use the actual project and production domain when linking. Skip this section for a LAN-only installation. Local monitoring continues without Atlas.

1. **Physical Pi.** From the same checkout and database used by `forest-monitor`, run `npm run sync:status`. Record the `deviceId`, pending count and last sync time. If it has synced before, recover the existing registration and token. Running the command in an empty development database can generate a different UUID.
2. **Windows administration computer.** In the project directory, create the private cloud file once with `if (!(Test-Path .env.cloud.local)) { Copy-Item .env.cloud.example .env.cloud.local }`. Set cloud mode and the complete Atlas Drivers URI. Percent-encode reserved characters in credentials. Use MongoDB Atlas or a replica set with transaction support. Give the database user the necessary read, write and index rights on the application database and allow the applicable outbound addresses in Atlas Network Access.
3. Run `npm.cmd run db:check`. The diagnostic checks Shell availability, DNS and SRV/TXT discovery, TCP, driver authentication, application reads, granted write/index privileges, selected device and a separate shell ping. It makes no test writes. An unselected or unregistered outpost can yield an incomplete result at this stage. Resolve the first failing stage. A DNS failure means authentication has yet to be tested.
4. For a **new** physical Pi identity, run the following after replacing `PI_DEVICE_ID`. Registration creates indexes and issues the device upload token once. Save it privately. The script refuses to re-register an existing identity.

   ```powershell
   npm.cmd run cloud:setup -- --device PI_DEVICE_ID --name "Forest Outpost 03"
   ```

5. Set `FOREST_CLOUD_DEVICE_ID` in the admin file to the same UUID. Create a separate viewer account with `npm.cmd run cloud:account` and a distinct password. Run `npm.cmd run db:check` again. For a cloud password reset use `npm.cmd run cloud:account -- --reset`.
6. **Vercel.** Select the Next.js project, Node 24.x, and the build command `npm run build -- --webpack`. Set the cloud environment values in **Production**, including the same UUID. Redeploy for environment changes to take effect. Credentials belong in server-side environment settings.
7. **Pi.** Keep `FOREST_DEPLOYMENT=local`. Set `FOREST_SYNC_URL=https://YOUR_VERIFIED_PRODUCTION_DOMAIN/api/sync` and `FOREST_SYNC_TOKEN` in the Pi's `.env.local`. Use the production domain shown in the intended Vercel project. Run one batch, then inspect its acknowledgment.

   ```sh
   npm run sync:once
   npm run sync:status
   ```

8. **Pi.** For continued uploads, run `npm run sync:run` in a supervised process or install the optional unit below. Adjust the account, working directory and Node path as for the dashboard.

   ```sh
   sudo install -m 0644 deploy/forest-sync.service /etc/systemd/system/forest-sync.service
   sudoedit /etc/systemd/system/forest-sync.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now forest-sync
   systemctl status forest-sync --no-pager
   ```

9. Sign in as the cloud viewer. Check that last contact advances, the pending queue drains when writes settle, and the same incident code is visible locally and online. One `sync:once` can leave more than one batch pending. An empty cloud map with the linking message is expected until a registered outpost is selected.

**How replay works.** SQLite queues monitoring changes and deletion records in the same transaction as each write. An initial migration queues existing records once. A worker leases the queue for 90 seconds and saves the exact outgoing request before sending it. Each batch contains up to 64 changes with a 220,000-byte combined event budget. Atlas commits mirror changes and the acknowledgment in one transaction. A matching replay returns the earlier acknowledgment. The Pi clears only acknowledged events and the saved request together. An idle worker sends a heartbeat about once a minute. A failed upload remains queued and retries with backoff. The system implements one outpost per dashboard and one-way sync.

## Back up and recover the outpost

**Routine application backup, Pi terminal.** Confirm an external drive is mounted before selecting it as the destination. Use a fresh filename for each retained backup.

```sh
npm run db:backup
npm run db:backup -- /media/backup/forest-monitor.sqlite
```

The default writes a dated file under `backups/`. The SQLite online backup includes committed WAL contents, account hashes, sessions, device identity, sync acknowledgment and pending outbox. Protect it and keep an off-device copy.

**Complete device backup.** Arrange a maintenance window because nodes can lose clips while the receiver is stopped. Stop the receiver, sync worker if installed, and dashboard. Back up the app database and receiver spool as a matched set with no active writers. For the default spool location, the SQLite CLI can produce a consistent standalone copy:

```sh
sqlite3 -readonly data/receiver/spool.sqlite ".backup '/media/backup/forest-receiver.sqlite'"
```

Also preserve the private app and receiver environments, node registry, board-to-alias assignment, model plus digest, any custom archive, service overrides and the exact deployable source version. Keep credentials in restricted storage. Restart the dashboard, receiver and optional sync worker after the backup. An ordinary live copy of a SQLite main file can miss writes still in its WAL.

**Restore.** Stop all writers including the sync worker. Preserve the current app and spool databases with their respective `-wal` and `-shm` companions together as rollback copies. Restore the matched standalone backups to `FOREST_DATABASE_PATH` and `RECEIVER_DATABASE` with no stale sidecar files at those paths. Restore private configuration, paths, ownership and restrictive permissions. Start the dashboard and receiver, verify login and node ownership, then inspect local sync status before resuming the worker. A restored app database also restores the account/session state it held when backed up.

If the cloud has advanced past the restored acknowledgment, sync can return HTTP 409. Keep operating locally while recovering the latest consistent database. Preserve the existing queue, sequence counters and cloud history. A replacement identity needs deliberate reprovisioning and a full baseline. There is no automatic reseed or cloud rollback utility.

### Inspect a delayed or quarantined observation

1. Read `journalctl -u forest-receiver -n 80 --no-pager` and `journalctl -u forest-monitor -n 80 --no-pager` for errors. Verify that the app is healthy and the localhost URL and ingest tokens match.
2. Inspect the spool with a read-only connection. Use the configured file if its path differs.

   ```sh
   sqlite3 -readonly data/receiver/spool.sqlite 'SELECT count(*) FROM events WHERE delivered_at IS NULL AND rejected_status IS NULL;'
   sqlite3 -readonly data/receiver/spool.sqlite 'SELECT node_id,event_id,rejected_status FROM events WHERE rejected_status IS NOT NULL;'
   ```

3. App HTTP 400 or 409 quarantines the event and allows other deliveries to proceed. Identify and correct the cause before retrying. Examples include an unknown node, different receiver identity or an invalid timestamp. Other forwarding failures keep the observation pending for retry. An external wall-clock correction backward by more than five minutes can make an already-queued observation look too far in the future to the app.
4. With the cause fixed, stop the receiver and back up the spool. Open `sqlite3 data/receiver/spool.sqlite`. Substitute the **actual** canonical ID and event counter in the following SQL, which targets one undelivered, quarantined row.

   ```sql
   UPDATE events SET rejected_status=NULL
   WHERE node_id='NODE-01' AND event_id='1'
     AND delivered_at IS NULL AND rejected_status IS NOT NULL;
   ```

5. Restart the receiver and check that the dashboard shows the observation. For confirmation in the spool, query the same IDs. A populated `delivered_at` and empty `rejected_status` mean the app acknowledged it.

   ```sh
   sqlite3 -readonly data/receiver/spool.sqlite "SELECT delivered_at,rejected_status FROM events WHERE node_id='NODE-01' AND event_id='1';"
   ```

### Diagnose a break in the data path

| Symptom | First check |
| --- | --- |
| LAN dashboard unreachable | Check `systemctl status forest-monitor`, `curl -sS http://127.0.0.1:3000/api/health`, the bound port and the Pi's current LAN address. A missing unit means the template still needs installing. |
| Node joins Wi-Fi but gets no response | Check `PI_BASE_URL`, LAN reachability, port 5000, receiver logs and whether the older listener still owns the port. Use the first Serial Monitor HTTP result, with secrets omitted. |
| Node gets 401, 400 or 409 | For 401 check that the alias and per-node token match. For 400 check PCM length, sample rate, GPS fields and event-ID format. For 409 inspect counter order or reused ID. Preserve the stored counter, receiver spool and event identity while investigating. |
| GPS works but audio gets 503 | Check the configured model path, LiteRT installation, file permissions and model warmup. Also check receiver capacity, disk space and service logs. Run the model smoke test on the Pi. |
| Node shows online but no incident | A GPS heartbeat is enough for online status. Read **Latest audio** and the recent node event log. For the exact time, score and threshold, inspect the matching sensor's `lastClassification` in authenticated `/api/state`. A negative clip creates a node event. If the receiver returned 200 but the app is stale, inspect its spool, port 3000 and the receiver-to-app token. |
| Cloud dashboard works but is empty or stale | Compare `sync:status` on the actual Pi with the selected Vercel device ID and last contact. Check `journalctl -u forest-sync -n 80 --no-pager`. A 401 points to device credentials. A sync 409 requires history recovery. For Atlas connection issues check DNS, TCP, TLS, network access, grants and device state with `db:check`. |
| Map shows only coordinates | Check the effective archive path, bundled hashes and WebGL on the viewing device. A reverse proxy must preserve range responses. Compare actual node coordinates against the package bounds. |

### Capacity and field limits

The receiver keeps delivered receipts for seven days by default. Pending and quarantined events remain. The 100,000-row cap counts **all three** categories. If each of three nodes successfully uploads one observation every two seconds, they generate 1.5 observations per second. An empty spool would reach the cap in about **18½ hours** at that sustained rate, before seven-day receipts begin expiring. This is a capacity scenario. Field traffic and Pi throughput still need measurement. A full receiver returns 503. SQLite storage and WAL limits can also constrain capacity.

The receiver retains a per-node counter watermark after receipts expire. The app keeps its own ingestion receipts. During ingestion the app prunes node events to the newest 1,000, and the state view returns 100. Incident history is read in full. The cloud outbox accumulates changes even when sync is disabled. Monitor space on persistent storage, queue age and count, full-history report cost, and CPU/RAM while inference and dashboard polling run together. Keep power and the Pi clock stable. Pagination, workload-based retention and unattended field performance remain work for a larger installation.

## Field acceptance

Use a supervised bench session and keep the incident code, node alias, event ID, model digest, Pi revision and time with the results. Each row closes a different open question.

| Check | Evidence to retain |
| --- | --- |
| Start without an internet uplink | Dashboard login on the outpost LAN works, local health is OK, and the map opens on the field browser. Record the effective archive digest and verify Iligan and the deployed node positions. |
| Receive one board | Correct alias appears in Serial Monitor, the receiver accepts the boot fix or heartbeat, and the expected canonical node updates on the Pi. Repeat for each node and verify their distinct positions. |
| Classify actual audio | Check the model digest and smoke test first. Exercise both a known background recording and a labeled chainsaw recording through the actual microphone. Record microphone trigger, HTTP response, score and model version. Inspect negative node events and any positive `SENSOR` incident. Repeat across all boards and representative background conditions before making accuracy claims. |
| Validate incident workflow | Use a labeled test incident on a bench database if needed. Assign, dispatch and close it. Confirm the first-dispatch response time, status and persistence from a second LAN browser. |
| Check timing diagnostics | Inspect `audio_timing` for samples from different nodes in the same receiver clock session, with round-trip time and age. Any localization work requires a separate common-signal bench measurement of timing error. |
| Test restart and outages | On the bench, leave the receiver up while the dashboard is briefly stopped. An accepted observation should appear once after restart. Check service startup after Pi reboot. Separately document clips the board misses when Wi-Fi is down or its single buffer is busy. |
| Link the cloud, if required | Verify the real Pi UUID, successful acknowledgments, last contact and the same local incident code on the authenticated read-only viewer. Confirm the LAN keeps working during an uplink outage and the queue drains on reconnect. |
| Check recovery and running cost | Restore a paired backup to an isolated system with cloud uploads disabled. Verify identity, receipts and records. Measure spool growth, Pi load and disk space at the intended cadence before unattended operation. |

## Verification and source documents

### Checks performed for this handoff

| Check | Result on the Windows working tree |
| --- | --- |
| Application and offline map | All **53 Node tests** passed. TypeScript passed. Map integrity verified **28 assets**. ESLint reported zero errors and three unused-function warnings in a third-party file under the receiver's Python virtual environment. |
| Production routes and transport | A fresh Webpack production build in a temporary source copy passed. Compiled API checks and the production HTTP smoke test passed. The separate receiver-to-dashboard HTTP test passed positive/negative classifications, replay and backlog recovery across restarts using an injected classifier. |
| Runtime versions | The build used installed Node **24.21.0** and Next.js **16.3.2**. The manifest and lockfile require Next.js **16.4.3**, React **19.2.8** and MongoDB driver **7.7.0**. A clean `npm ci` and verification on the Pi are still needed for the locked release. |
| Python receiver | All **23 receiver tests** passed in the existing Python 3.13.14 virtual environment using temporary state. |
| Current ESP32 sources | Compiled the exact sketch and clock helper for `esp32:esp32:esp32` with a temporary placeholder configuration, Arduino-ESP32 3.3.7 and TinyGPSPlus 1.0.3. Hardware upload and live transmission were outside this check. |
| Actual model | Verified the local file digest and float32 input/output tensor shapes. A Windows zero-PCM inference attempt stopped at model load because the venv lacks `ai_edge_litert`. Inference on Pi and labeled accuracy remain open. |

### Repeat the software checks

**App checkout, Pi terminal.** Use `npm.cmd` for the equivalent Windows commands. The audit needs registry access. Run route and HTTP tests after the production build. Local tests use isolated data. The cloud connection diagnostic is a separate check against a configured deployment.

```sh
npm run lint
npm run typecheck
npm test
npm audit --audit-level=low
npm run map:assets -- --check
npm run build -- --webpack
npm run test:routes
npm run test:http
PYTHONPATH=receiver receiver/.venv/bin/python -m unittest discover -s receiver/tests
receiver/.venv/bin/python tests/wifi-e2e.py --run
```

The October architecture review describes a restricted Windows runner that needed pre-created output directories and `FOREST_PRESERVE_BUILD_OUTPUT=true`. Use that workaround only for the documented filesystem issue. Normal builds use Next.js output cleanup.

### Where to make changes

| Concern | Owning source |
| --- | --- |
| Dashboard, login, incident workflow and exports | [App routes and screens](app), [components](components), [active client state provider](context/AlertsContext.tsx), [local monitoring actions](lib/server/monitoring.mjs) |
| Local schema, authentication, receiver ingestion | [Database](lib/server/database.mjs), [accounts](lib/server/accounts.mjs), [app-side ingest validation](lib/server/ingestion.mjs), [node freshness](lib/server/sensor-status.mjs) |
| Boards, timing, model and forwarding | [Firmware](firmware/ForestMonitorESP32), [classifier](receiver/classifier.py), [receiver and spool](receiver/receiver.py), [service entry point](receiver/main.py), [provisioner](receiver/provision.py) |
| Cloud, maps and maintenance tools | [Sync protocol and worker](lib/server/sync), [cloud storage](lib/server/cloud), [map serving](lib/server/maps.mjs), [map packaging](lib/maps), [admin scripts](scripts), [systemd templates](deploy) |
| Regression and integration checks | [Application and HTTP tests](tests), [receiver tests](receiver/tests), [npm commands](package.json) |

### Instructions carried forward from the four Markdown files

| Original document | Instructions and context carried into this handoff |
| --- | --- |
| [Root README](README.md) | Pi and Windows setup, account creation/reset, environment settings, maps, cloud registration and diagnostics, systemd, online backups, restore and development commands. Its 90-second degraded rule applies to the committed release. |
| [Receiver README](receiver/README.md) | Python versions, venv, model placement, one-time provisioning, device request examples, service installation, timing validation, spool retention, quarantine recovery and receiver tests. Its retry rules describe what a conforming sender must do. The current sketch's single-buffer behavior is documented above. |
| [Architecture review](ARCHITECTURE-REVIEW.md) | Rationale for offline PMTiles, LAN authentication, read-only cloud access, durable replay, honest incident timestamps, restore safeguards, map licensing and field performance checks. Its 1.4 MB map, test counts and missing integration were October observations. |
| [Codex project report](CODEX-PROJECT-REPORT.md) | Directory and schema reference, map API and byte-range design, cloud synchronization, environment matrix, build commands and physical deployment tasks. The current archive, schema v3, Wi-Fi ingestion, software versions and deployment evidence are updated above. The report's Atlas checks describe that earlier environment. |

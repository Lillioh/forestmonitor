# Bantay Gubat / Forest Monitor

An offline outpost dashboard for acoustic forest monitoring. Next.js serves the interface and a local API; SQLite stores accounts, sessions, incidents, sensor configuration, dispatch teams, outpost settings, and an audit log on the Raspberry Pi. Browsers on the same local network share this database through the API.

## Raspberry Pi 4 Model B (8 GB)

- Use a 64-bit Linux OS and the latest patched **Node.js 24.x LTS release**, at least 24.15, with npm. This application uses Node's built-in `node:sqlite`; no MongoDB, Supabase, database daemon, or native npm database addon is required.
- Initial software installation requires internet access or preloaded dependencies. Normal operation does not.
- Keep the database on local storage, preferably an SSD, not a network share. Reserve CPU/RAM for the separate ML/TDoA process.

```sh
npm ci
cp .env.example .env.local
npm run account:create
npm run build -- --webpack
npm start -- --hostname 0.0.0.0
```

Install dependencies on the Pi with `npm ci` so npm selects Linux ARM64 binaries from the committed lockfile. Do not copy `node_modules` from Windows or another architecture. Run `npm audit --audit-level=low` to check the locked dependencies against current security advisories before deployment. After a dependency update, rerun the checks below and rebuild before restarting the services.

During account creation, choose a username, display name, role (`admin` for the initial administrator), and a unique password of 12–128 characters. Password entry is hidden. There are **no default credentials and no public signup**. Create subsequent operator accounts with the same command on the Pi. Reset a forgotten password using `npm run account:reset`; it revokes that user's sessions.

For a terminal without hidden-input support, use `npm run account:create -- --username admin --name Administrator --role admin --generate-password`. This generates a unique random password and displays it once in that terminal; save it privately. Passwords are never accepted as command-line arguments.

On Windows use `Copy-Item .env.example .env.local` when creating the environment file and `npm.cmd` if PowerShell blocks `npm.ps1`. Preserve any existing `.env.local` rather than overwriting it; old Supabase/Google environment variables are unused.

Open `http://<pi-local-IP>:3000` from a phone or computer on the same Wi-Fi/Ethernet network. On the Pi itself, open `http://localhost:3000`. The network needs no internet uplink. A browser disconnected from the Pi cannot fetch or change records; this is local server operation, not a browser PWA. Optional cloud mirroring is disabled until configured as described below.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `FOREST_DATABASE_PATH` | `./data/forest-monitor.sqlite` | Local SQLite path, relative to the project working directory unless absolute |
| `FOREST_DEPLOYMENT` | `local` | Use `cloud` only on Vercel with MongoDB configured |
| `FOREST_COOKIE_SECURE` | `false` | Set `true` with HTTPS; retain `false` for a local HTTP deployment |
| `FOREST_SIMULATION_ENABLED` | `false` | Allow admins to generate labeled test detections |
| `FOREST_MAP_ARCHIVE` | `./public/maps/mapawa_malasag.pmtiles` | Read-only regional PMTiles archive |
| `FOREST_SYNC_URL` | empty | Optional HTTPS cloud receiver, e.g. `https://your-site.vercel.app/api/sync` |
| `FOREST_SYNC_TOKEN` | empty | Per-device upload token issued by cloud setup; never a `NEXT_PUBLIC_` variable |

Use a trusted LAN. HTTP does not encrypt passwords in transit; use local HTTPS when the network is shared or untrusted and set `FOREST_COOKIE_SECURE=true`. Cookies are HttpOnly and SameSite=Lax. Session tokens are random, stored only as hashes, expire after 12 hours, and are revoked at logout. Passwords use salted scrypt; login attempts are limited in the local database. Administrators manage configuration and teams; operators can view records and perform incident response actions.

## Monitoring data

- Sensor coordinates use the configured three-node triangle. Nodes start offline until real telemetry is integrated; no simulated data is generated automatically.
- Administrator test detections are available only with `FOREST_SIMULATION_ENABLED=true`. They are persisted and clearly marked `SIMULATION`.
- Response time measures detection to first dispatch; resolution has its own timestamp. Actions and settings changes are committed transactionally and audited.
- The incident timeline shows recorded detection, dispatch, and closure times. TDoA pair delays are displayed separately; inference-stage completion times are not assumed.
- Dashboard clients poll the authenticated local state endpoint every five seconds and reload state after mutations. Refreshing or restarting does not discard saved records.
- MapLibre renders a local vector basemap with roads, buildings, land cover, water, configured sensors, active incidents, and uncertainty areas. No Google scripts, remote tiles, fonts, or icons are fetched during normal operation.
- ESP32/LoRa ingestion, Raspberry Pi ML/TDoA inference, real audio recordings, and notification delivery remain separate integration work. The existing waveform is an explicitly labeled demonstration, not recorded evidence.

## Offline geographic map

The repository includes `public/maps/mapawa_malasag.pmtiles`: **1,415,845 bytes, 100 tiles, zooms 0-15**, bounding box **124.66,8.42,124.75,8.475** (west,south,east,north). It covers the project's configured Mapawa / Malasag sensor area near Cagayan de Oro. The renderer can zoom further by enlarging existing vector tiles. It does not add detail beyond zoom 15, provide satellite imagery, or calculate routes. Position estimates still come from the application's sensor data; a basemap does not improve TDoA accuracy.

The source is the Protomaps 2026-10-26 daily archive, schema 4.15.2. Sources, sizes, and SHA-256 hashes are in `public/maps/asset-manifest.json`. Fonts, sprites, and their licenses are bundled alongside the archive. OpenStreetMap attribution remains on the map. Run `npm run map:assets -- --check` to verify all bundled assets without internet. To re-download the pinned fonts/icons while online, run `npm run map:assets`; it rejects changed upstream bytes.

To prepare a different region while online:

```sh
npm run map:prepare -- --source https://build.protomaps.com/20261026.pmtiles --bounds 124.66,8.42,124.75,8.475 --max-zoom 15 --output data/maps/mapawa_malasag.pmtiles
```

Then set `FOREST_MAP_ARCHIVE` to that file and restart. The extraction tool bounds work to 4,096 tiles and 256 MB and checks range support and source format. A smaller area/zoom is needed if those limits are exceeded. For a different region on Vercel, replace the bundled `public/maps/mapawa_malasag.pmtiles`, review/update its manifest, and rebuild so the function trace includes the correct archive.

Authenticated map endpoints validate the archive and serve small byte ranges with `206`, `Content-Range`, ETag, and no compression transformation. Keep byte-range headers intact in any reverse proxy. MapLibre uses two workers and a bounded tile cache; rendering happens in the viewing browser. A browser without working WebGL, or a missing/corrupt package, receives the coordinate-view fallback. Sensors outside the package's coverage produce a visible warning. Dark/light themes use local styles and assets.

## Optional Vercel + MongoDB cloud mirror

The Pi remains authoritative: **Next.js + local SQLite + local accounts + local map** work without the cloud. Vercel runs the same application in `FOREST_DEPLOYMENT=cloud` mode and reads MongoDB. It never opens SQLite or writes local files. Cloud accounts and sessions are separate; local users, password hashes, sessions, and audit logs are never uploaded. The remote dashboard is read-only, including server-side mutation enforcement, and shows the last outpost contact time. Do not treat it as live when the Pi lacks internet.

1. Obtain the Pi's stable identity with `npm run sync:status`. Back up its SQLite database before upgrading; schema version 2 adds the transactional outbox and identity automatically.
2. Create a MongoDB Atlas database (or a MongoDB replica set that supports transactions). Prepare a private `.env.cloud.local` based on `.env.cloud.example` on an administration machine. Set `MONGODB_URI` and `FOREST_DEPLOYMENT=cloud`. Protect this file; it must not be committed.
3. Run `node --env-file=.env.cloud.local scripts/cloud-setup.mjs --device <pi-device-id> --name "Forest Outpost 03"`. This creates indexes and registers the device. Save its displayed upload token privately. Re-registering an existing identity is refused to preserve synchronization history.
4. Set `FOREST_CLOUD_DEVICE_ID` in that cloud environment, and provision a cloud viewer account with `node --env-file=.env.cloud.local scripts/account.mjs`. Use a distinct password from the Pi. Cloud accounts can view data; even a cloud admin cannot dispatch or modify outpost records.
5. Deploy this repository to Vercel with Node.js 24.x and the values from `.env.cloud.example`. Choose the Next.js framework and a build command of `npm run build -- --webpack`. Keep MongoDB credentials server-side. Configure Atlas network access for the deployment and use a database user limited to this application's database.
6. On the Pi, set `FOREST_SYNC_URL=https://<your-vercel-domain>/api/sync` and the issued `FOREST_SYNC_TOKEN`, retaining `FOREST_DEPLOYMENT=local`. Try `npm run sync:once`, then run `npm run sync:run` as a separate service.

Each committed telemetry/configuration change enqueues an event in the same SQLite transaction, including deletion tombstones. The worker saves the exact in-flight request in local internal configuration before sending a bounded HTTPS batch. New records wait for the next batch; retries retain the same request even after a worker restart or lost cloud response. The receiver commits mirror changes and its acknowledgment together in a MongoDB transaction. Acknowledged events and their saved request are removed in one local transaction; failures remain queued and retry with backoff. A local lease prevents competing workers; idle workers send a contact heartbeat once a minute. The web request path never waits for an internet upload.

This is a single-outpost, one-way mirror. A missing internet connection means the cloud copy becomes stale; Vercel cannot be accessed offline. MongoDB alone does not synchronize two deployments. Existing records bootstrap into the queue once during migration; accounts do not. Keep sufficient disk space for the queue during long outages. Raw recordings are not included in this protocol.

Linux service examples are in `deploy/forest-monitor.service` and `deploy/forest-sync.service`. Change the username, project directory, and Node/npm paths to match the Pi; configure the database path on persistent storage. The sync service is optional, and neither service requires an internet connection at boot.

## Cloud connection diagnostics

Keep the Pi's `.env.local` in local mode. Use a separate, ignored `.env.cloud.local` on the administration machine (copy `.env.cloud.example` once, without overwriting an existing configuration). Set `MONGODB_URI` to the complete Atlas Drivers connection string and `MONGODB_DATABASE=forest_monitor`. Percent-encode reserved characters in URI credentials; never use a `NEXT_PUBLIC_` variable for MongoDB. This private file is loaded explicitly by the cloud CLI commands. Next.js does not automatically load `.env.cloud.local`; set the cloud values in Vercel's environment settings before deploying.

```sh
npm run db:check
npm run cloud:setup -- --device <actual-pi-device-id> --name "Forest Outpost 03"
npm run cloud:account
```

`db:check` performs read-only checks and reports Shell availability/version, public DNS, Atlas SRV/TXT discovery, TCP connectivity, driver authentication, actual application collection reads, declared database write/index privileges, configured outpost state, and a separate MongoDB Shell ping. It never creates accounts, devices, or sample records. Successful pings do not prove write authorization or that the dashboard's device is configured. Required writes are checked against reported grants without writing production records. An incomplete or failed check exits nonzero. The Shell probe passes credentials through its child environment, not command arguments or output. Atlas CLI is not required.

If DNS fails, authentication has not been tested. If TCP fails, inspect outbound network/firewall/VPN restrictions and Atlas Network Access. Use the current development/hosting outbound IPs and database-specific `readWrite` permissions; do not disable TLS validation or open network access to all addresses as a timeout workaround. Confirm Cluster0 is active and that the URI comes from that deployment. This environment cannot verify external Atlas settings without access to the Atlas project.

Register only the identity from `npm run sync:status` on the actual Pi database. Do not provision the development computer as the Pi or replace an existing cloud device's synchronization history. The setup command displays an upload token once; save it privately in the Pi's configuration. Create dashboard accounts separately with `cloud:account` in an interactive terminal so passwords stay hidden.

`GET /api/health` is a public, non-cacheable readiness probe. It returns only `200 {"status":"ok"}` or `503 {"status":"unavailable"}` after checking the selected database. Local mode checks SQLite without contacting Atlas. Cloud mode pings MongoDB using the same pooled client as the application. Connection establishment has a 12-second application deadline including DNS discovery, followed by a five-second ping deadline. Failed connections leave the cache and late connections are closed. API logs contain failure categories/codes rather than raw database errors or connection strings.

## Backup and restore

```sh
npm run db:backup
# Or write directly to a mounted external drive:
npm run db:backup -- /media/backup/forest-monitor.sqlite
```

The backup command uses SQLite's online backup API so committed WAL content is included. It contains password hashes and account records: protect the file and keep a copy off the Pi. A monitoring JSON/CSV export is not a complete device backup. Copy audio recordings separately when recording support is added.

To restore, stop the application and any database writers. Preserve the current database and its `-wal`/`-shm` companions together as a rollback copy, then place the consistent backup at `FOREST_DATABASE_PATH` with no stale companion files at that path. Ensure only the application account can access it, then restart. Restoring also restores account/session state from the backup.

Stop the sync worker during restore too. A backup contains the device identity, acknowledgment sequence, and pending outbox. If the cloud has advanced beyond a restored backup, the receiver returns `409` rather than accepting old history. Keep local operation available while recovering the latest consistent database. Do not clear the queue, reset sequence numbers, reuse an identity on another live Pi, or overwrite the cloud device record to bypass this check. A replacement identity requires deliberate re-provisioning and a complete baseline; an automatic cloud rollback/reseed utility is not included.

Configure your service manager to start the app after reboot, use the project as its working directory, and keep data outside release directories that get replaced. Backups and reliable power remain necessary; WAL does not protect against storage loss.

## Development and checks

```sh
npm run dev
npm run lint
npm run typecheck
npm test
npm audit --audit-level=low
npm run map:assets -- --check
# After a production build:
npm run test:routes
npm run test:http
```

Tests use isolated temporary databases. The compiled route check tests actual Next request/cookie contexts without sockets; the HTTP smoke check starts a production server and requires loopback networking. If Turbopack cannot launch its CSS worker in a restricted Windows environment, build with `npm run build -- --webpack`. No cloud credentials are required. Existing browser-only simulated incidents from earlier versions cannot be migrated after they have been discarded; earlier versions did not persist them.

See `ARCHITECTURE-REVIEW.md` for the review, deployment boundaries, remaining hardware work, and validation limits. Live Atlas/Vercel checks require the actual deployment credentials; unit tests cover queue, retry, replay, stale-history, heartbeat, and local/cloud separation without contacting an external database.

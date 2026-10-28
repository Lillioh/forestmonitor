# Bantay Gubat / Forest Monitor — Comprehensive Project Report for Codex

**Last Updated:** 2026-10-27  
**Runtime Requirement:** Node.js `>=24.15.0 <25` (uses built-in `node:sqlite`)  
**Framework:** Next.js `16.3.2` (App Router, React `19.2.8`, TypeScript `5`, Tailwind CSS `4`)

---

## 1. Executive Summary & System Purpose

**Bantay Gubat (Forest Monitor)** is an offline-first acoustic forest monitoring dashboard designed for a **Raspberry Pi 4 Model B (8 GB)** outpost deployed in the **Mapawa / Malasag watershed area of Cagayan de Oro, Philippines**.

The system monitors a 3-node acoustic sensor triangle (`NODE-01` Root Gateway, `NODE-02` Relay, `NODE-03` Endpoint), visualizes localized acoustic detections (e.g., chainsaw noise, vehicle noise, tree crash events) calculated via Time Difference of Arrival (TDoA), manages response team dispatches (DENR/ENRO units), logs audit trails, and generates 30-day operational analytics and CSV/JSON/GeoJSON exports.

### Core Architectural Invariants
1. **Local Raspberry Pi is Authoritative (`FOREST_DEPLOYMENT=local`)**:
   - Uses Node.js built-in `node:sqlite` (`data/forest-monitor.sqlite`) in `WAL` mode.
   - Works **100% offline** on a local Wi-Fi/Ethernet LAN without internet access, external CDNs, Supabase, or Google Maps APIs.
   - Serves an offline vector basemap (`public/maps/mapawa_malasag.pmtiles`) via HTTP `206 Partial Content` byte-range requests to MapLibre GL JS with locally bundled Noto Sans glyphs and Protomaps sprites.
2. **Optional Cloud Mirror (`FOREST_DEPLOYMENT=cloud` on Vercel + MongoDB Atlas)**:
   - Strictly **one-way** (Pi $\rightarrow$ Cloud) and **read-only** on the cloud dashboard.
   - Cloud mode never opens SQLite (`getDatabase()` throws immediately if `isCloud()` is true).
   - Every local mutation is rejected with `HTTP 403` on the cloud API (`apiUser(..., mutation=true)`), and mutation UI controls are disabled when `state.readOnly === true`.
   - Local accounts, password hashes, sessions, login attempts, and audit logs **never** leave the Raspberry Pi; cloud viewer accounts are provisioned separately in MongoDB Atlas.

---

## 2. Complete Directory & File Structure

```text
forestmonitor/
├── .env.example                 # Template for local Raspberry Pi deployment (.env.local)
├── .env.cloud.example           # Template for cloud / Vercel deployment (.env.cloud.local)
├── .env.local                   # Local environment variables (gitignored)
├── .env.cloud.local             # Private cloud CLI / Atlas credentials (gitignored)
├── next.config.ts               # Next.js config; traces mapawa_malasag.pmtiles & outpost.pmtiles into /api/maps*
├── package.json                 # Scripts and dependencies (Node >=24.15.0 <25)
├── tsconfig.json                # TypeScript configuration (@/* -> ./*)
├── ARCHITECTURE-REVIEW.md       # Security, offline map, and hybrid sync architecture review
├── README.md                    # Operational runbook and setup guide
├── CODEX-PROJECT-REPORT.md      # This comprehensive technical reference for Codex
│
├── app/                         # Next.js App Router
│   ├── globals.css              # Theme CSS variables (dark/light mode) & Tailwind v4 imports
│   ├── layout.tsx               # Root HTML shell
│   ├── page.tsx                 # Public landing & login page (redirects to /dashboard if authenticated)
│   ├── context/
│   │   └── AlertsContext.tsx    # Re-exports AlertsProvider and useAlerts from @/context/AlertsContext
│   ├── (protected)/             # Authenticated route group (enforces requireUser() server-side)
│   │   ├── layout.tsx           # Loads user + initial monitoringState(); wraps Sidebar, TopBar, AlertsProvider
│   │   ├── dashboard/page.tsx   # Live Map (DetectionMap + 3 SensorCards + IncidentFeed)
│   │   ├── incidents/[id]/page.tsx # Incident detail page (renders IncidentDetailView)
│   │   ├── alerts/page.tsx      # Searchable/filterable paginated Alert Log + CSV export + summary metrics
│   │   ├── sensor-nodes/page.tsx# Node health cards, SVG MeshTopology, and recent node event logs
│   │   ├── reports/page.tsx     # 30-day KPIs (excludes simulations), top zones, team response, 24h heatmap
│   │   └── settings/page.tsx    # Outpost name/location, dispatch team CRUD, CSV/JSON/GeoJSON export, test detection trigger
│   └── api/                     # Authenticated & public backend API routes (Node.js runtime)
│       ├── health/route.ts      # GET: Readiness probe (200 ok / 503 unavailable) for SQLite or MongoDB
│       ├── auth/login/route.ts  # POST: Scrypt credential check, rate limiting, sets HttpOnly forest_session cookie
│       ├── auth/logout/route.ts # POST: Revokes session token in DB and clears cookie
│       ├── state/route.ts       # GET: Returns full MonitoringState (polled every 5s by client)
│       ├── alerts/route.ts      # POST: Admin-only simulated detection generator (when FOREST_SIMULATION_ENABLED=true)
│       ├── alerts/[id]/route.ts # PATCH: Incident actions (dispatch, assign, resolve, false-positive, escalate)
│       ├── teams/route.ts       # POST: Admin-only create dispatch team
│       ├── teams/[id]/route.ts  # DELETE: Admin-only remove dispatch team (blocked if referenced by an incident)
│       ├── settings/route.ts    # PATCH: Admin-only update outpostName and location
│       ├── maps/route.ts        # GET: Validates PMTiles header/schema and returns MapInfo metadata
│       ├── maps/archive/route.ts# GET / HEAD: Authenticated HTTP 206 byte-range streamer for PMTiles archive
│       └── sync/route.ts        # POST: Cloud-only batch receiver (Bearer token + X-Forest-Device + ACID transaction)
│
├── components/
│   ├── DetectionMap.tsx         # Client dynamic wrapper (ssr: false) for OfflineMap
│   ├── OfflineMap.tsx           # MapLibre GL JS + PMTiles protocol renderer with GeoJSON overlays & CoordinateMap fallback
│   ├── CoordinateMap.tsx        # Zero-dependency SVG local coordinate plot (fallback or out-of-bounds view)
│   ├── IncidentFeed.tsx         # Right-hand live incident sidebar on /dashboard
│   ├── IncidentDetailView.tsx   # Full incident view: AudioWaveform, TDoA pairs, timeline, dispatch controls
│   ├── AudioWaveform.tsx        # Labeled demonstration waveform visualizer
│   ├── SensorCard.tsx           # Compact sensor status card for /dashboard
│   ├── NodeDetailCard.tsx       # Detailed telemetry card for /sensor-nodes
│   ├── MeshTopology.tsx         # SVG 3-node LoRa mesh link quality diagram
│   ├── LocalLoginForm.tsx       # Sign-in form posting to /api/auth/login
│   ├── Sidebar.tsx              # Left navigation bar with unread NEW alert badge & outpost status
│   ├── TopBar.tsx               # Header with node counter, connection status, PHT clock, theme toggle, logout
│   └── ui/                      # Shared primitives (MetricBar.tsx, StatusBadge.tsx, Toggle.tsx)
│
├── context/
│   └── AlertsContext.tsx        # React context: 5s polling of /api/state, mutation helpers, cloud/offline status banners
│
├── lib/
│   ├── types.ts                 # Core TypeScript interfaces (Alert, SensorNode, DispatchTeam, MonitoringState, etc.)
│   ├── mock-data.ts             # Initial seed config (OUTPOST, INITIAL_SENSOR_NODES, DISPATCH_TEAMS, MESH_LINKS)
│   ├── simulation.ts            # Simulated TDoA detection generator inside the 3-node triangle
│   ├── incident-timeline.ts     # Builds chronological timeline strictly from recorded timestamps (no invented offsets)
│   ├── format.ts                # Coordinate formatting, relative time, CSV serialization, browser file download
│   ├── nav.ts                   # Navigation items and route title helpers
│   ├── random.ts                # Deterministic mulberry32 PRNG helpers
│   ├── use-now.ts               # Client hook for current epoch timestamp
│   ├── maps/
│   │   ├── style.ts             # Generates MapLibre StyleSpecification (light/dark) using local glyphs, sprites, and pmtiles://
│   │   ├── features.ts          # Converts SensorNode[] and Alert[] into GeoJSON FeatureCollections (nodes, detections, areas, triangle)
│   │   └── archive-builder.mjs  # Bounded PMTiles v3 regional writer & HTTPS range extractor (max 4,096 tiles / 256 MB)
│   └── server/
│       ├── deployment.mjs       # isCloud() and secureCookies() helpers
│       ├── http.ts              # apiUser() auth/role/cloud-readonly guard, readMutation() CSRF/origin/size validator, apiError()
│       ├── auth.ts              # Next.js cookie reader (forest_session) & requireUser() redirect guard
│       ├── state.ts             # Dispatches monitoringState() to cloudState() or local SQLite readState()
│       ├── database.mjs         # SQLite singleton connection, schema initialization, WAL pragmas, transaction(), audit()
│       ├── database-health.mjs  # Readiness check for /api/health (SQLite SELECT 1 vs MongoDB ping)
│       ├── accounts.mjs         # Local SQLite user CRUD, scrypt password hashing, session hashing, login rate limiting
│       ├── account-store.mjs    # Dynamic dispatcher between local accounts.mjs and cloud/accounts.mjs
│       ├── monitoring.mjs       # Local SQLite state initialization, readState(), incident/team/settings mutations
│       ├── maps.mjs             # PMTiles file resolution (defaultMapPath), header/layer validation, HTTP 206 range responder
│       ├── sync/
│       │   ├── local.mjs        # SQLite user_version=2 migration, sync_meta & sync_outbox triggers, nextBatch()
│       │   ├── protocol.mjs     # Batch envelope/record validator, SHA-256 digest, idempotent acceptBatch() state machine
│       │   └── worker.mjs       # Local lease acquisition, durable sync_inflight freeze, HTTPS upload, ACK cleanup, 60s heartbeat
│       └── cloud/
│           ├── connection-check.mjs # URI/DB validation, 12s connectWithDeadline(), secret-redacting databaseFailure()
│           ├── database.mjs     # Cached MongoClient pool per URI, cloudDatabase(), createCloudIndexes()
│           ├── accounts.mjs     # MongoDB user/session/rate-limit store for cloud dashboard accounts
│           └── mirror.mjs       # receiveBatch() replica-set transaction & cloudState() device-isolated reader
│
├── public/maps/
│   ├── mapawa_malasag.pmtiles   # Default active regional PMTiles v3 archive (1,415,845 bytes, 100 tiles, zooms 0-15)
│   ├── outpost.pmtiles          # Wider CDO regional PMTiles v3 archive (3,481,211 bytes, 198 tiles, zooms 8-15)
│   ├── maplibre-gl-worker.js    # Bundled offline WebWorker for MapLibre GL JS (prevents Next.js chunk URL 404s)
│   ├── asset-manifest.json      # Pinned byte sizes and SHA-256 hashes for all 26 glyph/sprite assets + worker + archive
│   ├── NOTICE.txt               # ODbL / OSM / Protomaps / SIL OFL / MIT attribution and provenance
│   ├── FONT-LICENSE.txt         # SIL Open Font License 1.1 for Noto Sans PBF glyphs
│   ├── SPRITE-LICENSE.txt       # MIT License for Protomaps/Tangram sprite icons
│   ├── glyphs/                  # Local PBF font ranges for Noto Sans Regular, Medium, Italic
│   └── sprites/                 # Local light & dark sprite PNGs and JSONs (1x and @2x)
│
├── scripts/
│   ├── account.mjs              # Interactive CLI to create or reset local or cloud (--cloud) user accounts
│   ├── backup.mjs               # Online SQLite backup CLI using node:sqlite backup() API
│   ├── prepare-map.mjs          # CLI to extract a regional PMTiles archive from an HTTPS Protomaps build
│   ├── prepare-map-assets.mjs   # CLI to download or offline-verify (--check) all pinned map assets against asset-manifest.json
│   ├── sync.mjs                 # Outpost sync daemon (continuous loop or --once)
│   ├── sync-status.mjs          # Prints local sync_meta deviceId, pending outbox count, lastSyncedAt, and error
│   ├── cloud-setup.mjs          # Creates MongoDB indexes, registers Pi deviceId in devices collection, issues upload token
│   └── db-check.mjs             # Read-only diagnostic tool for MongoDB Shell, DNS, SRV/TXT, TCP, Auth, Grants, and App state
│
├── deploy/
│   ├── forest-monitor.service   # systemd unit for local Next.js server on Raspberry Pi
│   └── forest-sync.service      # systemd unit for optional background cloud upload worker on Raspberry Pi
│
└── tests/
    ├── local-backend.test.mjs   # Unit tests: SQLite accounts, sessions, rate-limits, incidents, teams, backups
    ├── maps.test.mjs            # Unit tests: PMTiles writer/reader, range parser, 206 streaming, manifest hashes, style spec
    ├── sync.test.mjs            # Unit tests: Outbox triggers, rollback safety, replay, lost ACK, worker leases, cloud guard
    ├── cloud-connection.test.mjs# Unit tests: Mongo URI validation, error secret redaction, connection deadlines, pool caching
    ├── incident-timeline.test.mjs # Unit tests: Timeline timestamp accuracy and simulation labeling
    ├── route-integration.mjs    # Post-build integration test against compiled .next/server/app/api/** route modules
    └── http-smoke.mjs           # Full loopback HTTP smoke test (requires socket bind permission)
```

---

## 3. Offline Geographic Map Architecture & Recent Corrections

### How the Offline Map Pipeline Works
1. **Archive Resolution (`lib/server/maps.mjs`)**:
   - `defaultMapPath` is `"public/maps/mapawa_malasag.pmtiles"`.
   - `mapPath()` resolves `process.env.FOREST_MAP_ARCHIVE || defaultMapPath`.
2. **Metadata Validation Endpoint (`GET /api/maps` $\rightarrow$ `mapInfo()`)**:
   - Requires an authenticated session (`await apiUser()`).
   - Opens the PMTiles file, reads the v3 header and JSON metadata via a custom file descriptor byte-range reader.
   - Verifies `specVersion === 3`, `tileType === 1` (MVT vector tiles), `minZoom <= maxZoom`, and that `vector_layers` includes `"earth"`, `"roads"`, and `"water"`.
   - Returns:
     ```json
     {
       "available": true,
       "bytes": 1415845,
       "minZoom": 0,
       "maxZoom": 15,
       "bounds": [124.66, 8.42, 124.75, 8.475],
       "dataVersion": "4.15.2",
       "dataDate": "2026-10-26T04:00:00Z",
       "archiveUrl": "/api/maps/archive"
     }
     ```
3. **Byte-Range Streaming Endpoint (`GET` / `HEAD /api/maps/archive` $\rightarrow$ `serveArchive()`)**:
   - Requires an authenticated session (`await apiUser()`).
   - Computes a weak/strong ETag from file size and `mtimeMs`; returns `304 Not Modified` when `If-None-Match` matches.
   - Parses `Range: bytes=start-end` header via `parseRange()`.
   - Rejects non-range `GET` requests (`400`), malformed/out-of-bounds ranges (`416`), and ranges $>4\text{ MB}$ (`413`).
   - Streams the exact file slice with `206 Partial Content`, `Content-Type: application/vnd.pmtiles`, `Content-Encoding: identity`, `Cache-Control: private, no-cache, no-transform`, and `Content-Range`.
4. **Client Rendering (`components/DetectionMap.tsx` $\rightarrow$ `components/OfflineMap.tsx`)**:
   - Registers the `pmtiles://` protocol handler once globally with `maplibre-gl` (`maplibregl.addProtocol("pmtiles", protocol.tile)`), configures the local WebWorker URL (`maplibregl.setWorkerUrl("/maps/maplibre-gl-worker.js")`), and limits workers to `2`.
   - Fetches `/api/maps` on mount, builds the local style via `offlineStyle(archiveUrl, dark)` (`lib/maps/style.ts`) pointing to:
     - `pmtiles://${window.location.origin}/api/maps/archive`
     - `${window.location.origin}/maps/glyphs/{fontstack}/{range}.pbf`
     - `${window.location.origin}/maps/sprites/${flavor}`
   - Renders GeoJSON layers from `mapFeatures(sensors, alerts)` (`lib/maps/features.ts`):
     - `triangle-fill` & `triangle-line`: dashed green polygon connecting the 3 sensor nodes.
     - `uncertainty-fill` & `uncertainty-line`: 48-vertex geodesic circle (`alert.radiusM`) around each active detection.
     - `sensor-points` & `sensor-labels`: color-coded by `ONLINE` / `DEGRADED` / `OFFLINE`.
     - `detection-points` & `detection-labels`: clickable markers that navigate to `/incidents/[id]`.
   - Automatically falls back to `<CoordinateMap />` (an offline SVG coordinate plot) if WebGL fails, the map archive is unavailable, or any sensor lies outside `info.bounds`.

### Details of `public/maps/mapawa_malasag.pmtiles` & Consistency Fixes Applied
When `public/maps/mapawa_malasag.pmtiles` was added to the repository, the following consistency updates were made across the codebase so local, cloud, build traces, and asset checks all align:
- **Archive Specifications**:
  - **File**: `public/maps/mapawa_malasag.pmtiles`
  - **Size**: `1,415,845` bytes (~1.4 MB)
  - **SHA-256**: `d9aebb4454c59b0108be6a3967a6549d9bc079822efc200e641a0f8153b7051d`
  - **Bounds (W, S, E, N)**: `[124.66, 8.42, 124.75, 8.475]` (covers all 3 configured sensors around `124.7003–124.7019 E, 8.4588–8.4604 N`, including tile `15/27734/15611`)
  - **Zoom Range**: `0` to `15` (`100` addressed MVT tiles, gzip-compressed, Protomaps schema `4.15.2`, OSM replication `2026-10-26T04:00:00Z`)
- **Files Updated for Consistency**:
  1. `lib/server/maps.mjs`: Updated `defaultMapPath` to `"public/maps/mapawa_malasag.pmtiles"`.
  2. `next.config.ts`: Updated `outputFileTracingIncludes` for `/api/maps` and `/api/maps/archive` to include `["./public/maps/mapawa_malasag.pmtiles", "./public/maps/outpost.pmtiles"]` (verified in `.next/server/app/api/maps*/route.js.nft.json`).
  3. `public/maps/asset-manifest.json`: Updated `manifest.archive` with the exact path, bounds, zoom range, tile count, byte size, and SHA-256 of `mapawa_malasag.pmtiles`.
  4. `tests/maps.test.mjs`: Updated the bundled archive test to dynamically load `manifest.archive.path` (`mapawa_malasag.pmtiles`) instead of hardcoding `outpost.pmtiles`.
  5. `scripts/prepare-map.mjs`, `.env.example`, `.env.cloud.example`, `.env.local`, `public/maps/NOTICE.txt`, `README.md`, `ARCHITECTURE-REVIEW.md`: Synchronized default paths, bounds, and metadata documentation.

---

## 4. Data Persistence, Schemas & Cloud Synchronization

### A. Local SQLite Schema (`lib/server/database.mjs` & `lib/server/sync/local.mjs`)
- **`users`**: `id`, `username` (UNIQUE COLLATE NOCASE), `name`, `password_hash` (salted scrypt), `role` (`'admin' | 'operator'`), `created_at`
- **`sessions`**: `token_hash` (SHA-256 hex of 32-byte base64url token), `user_id` (FK CASCADE), `expires_at` (12-hour TTL)
- **`login_attempts`**: `key` (`'global'` or `user:<username>`), `attempts`, `started_at` (15-minute window: max 5 per user, 60 global)
- **`configuration`**: `key` (`'settings'`, `'initialized'`, `'sync_inflight'`), `value` (JSON text)
- **`sensors`**: `id` (`'NODE-01'`, `'NODE-02'`, `'NODE-03'`), `payload` (JSON `SensorNode`)
- **`teams`**: `id`, `payload` (JSON `DispatchTeam`)
- **`incidents`**: `id` (INTEGER PK AUTOINCREMENT), `timestamp`, `status`, `payload` (JSON `Alert`)
- **`node_events`**: `id`, `timestamp`, `payload` (JSON `NodeEvent`)
- **`audit_log`**: `id`, `timestamp`, `actor_id`, `action`, `details`
- **`sync_meta`** (Schema `user_version = 2`):
  - Singleton row (`id = 1`) holding `device_id` (UUIDv4 generated once on first migration), `ack_seq`, `last_synced_at`, `last_error`, `lease_owner`, `lease_until`.
- **`sync_outbox`**:
  - `seq` (AUTOINCREMENT), `entity` (`'incident' | 'sensor' | 'team' | 'node_event' | 'settings'`), `entity_id`, `operation` (`'upsert' | 'delete'`), `payload`, `created_at`.
  - Populated automatically via SQLite `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers within the same local transaction.

### B. Cloud MongoDB Atlas Schema (`lib/server/cloud/*`)
Database name: `forest_monitor` (configurable via `MONGODB_DATABASE`).
- **`devices`**:
  - `_id`: Raspberry Pi UUID (`device_id` from `sync_meta`)
  - `name`: Outpost display name
  - `tokenHash`: SHA-256 hex digest of the secret `FOREST_SYNC_TOKEN`
  - `enabled`: `true`
  - `lastAck`: Last acknowledged `seq` integer
  - `lastDigest`: SHA-256 hex digest of the last committed batch JSON
  - `lastSyncedAt`: Epoch ms of last batch/heartbeat
- **`mirror`**:
  - `_id`: `"${deviceId}:${entity}:${entityId}"`
  - `deviceId`, `entity`, `entityId`, `revision` (`seq`), `deleted` (boolean), `payload`
  - Index: `{ deviceId: 1, entity: 1, deleted: 1, "payload.timestamp": -1 }`
- **`users`**: `_id`, `username` (unique index), `name`, `role`, `passwordHash`
- **`sessions`**: `_id` (SHA-256 token hash), `userId`, `credentialVersion` (SHA-256 of `passwordHash`), `expiresAt` (TTL index `expireAfterSeconds: 0`)
- **`login_attempts`**: `_id`, `attempts`, `expiresAt` (TTL index `expireAfterSeconds: 0`)

### C. Synchronization Protocol (`lib/server/sync/*` & `app/api/sync/route.ts`)
1. **Batch Freezing**: `syncOnce()` acquires a 90-second lease in `sync_meta`, reads up to 64 events ($\le 220\text{ KB}$) via `nextBatch()`, and saves the exact JSON string in `configuration` under key `'sync_inflight'` **before** transmitting. If a network drop or process restart occurs after the cloud commits but before the Pi receives the HTTP response, the next retry sends the exact same batch bytes so the cloud's digest check succeeds idempotently.
2. **Cloud Ingestion (`POST /api/sync`)**:
   - Validates `Authorization: Bearer <token>` and `X-Forest-Device: <deviceId>`.
   - Runs inside a MongoDB replica-set transaction (`readConcern: "snapshot"`, `writeConcern: { w: "majority" }`).
   - Verifies `timingSafeEqual` on the SHA-256 token hash.
   - If `device.lastAck === batch.afterSeq`, applies all upserts/tombstones to `mirror` and updates `devices.lastAck`, `lastDigest`, and `lastSyncedAt`.
   - If `device.lastAck === last && device.lastDigest === digest`, returns `{ ackSeq: last }` idempotently.
   - Otherwise throws `409 Conflict` to prevent stale backups or split-brain workers from corrupting cloud state.

---

## 5. Environment Variables Reference

| Variable | Local Pi (`.env.local`) | Cloud / Vercel (`.env.cloud.local`) | Description |
| :--- | :--- | :--- | :--- |
| `FOREST_DEPLOYMENT` | `local` | `cloud` | Selects SQLite (`local`) vs MongoDB (`cloud`). Vercel (`VERCEL=1`) forces `cloud`. |
| `FOREST_DATABASE_PATH` | `./data/forest-monitor.sqlite` | *(Unused)* | Path to local SQLite file. |
| `FOREST_COOKIE_SECURE` | `false` (HTTP LAN) | `true` (HTTPS) | Sets `Secure` attribute on `forest_session` cookie. |
| `FOREST_SIMULATION_ENABLED` | `false` (or `true` for testing) | `false` | Enables `POST /api/alerts` simulated detection button in Settings. |
| `FOREST_MAP_ARCHIVE` | `./public/maps/mapawa_malasag.pmtiles` | `./public/maps/mapawa_malasag.pmtiles` | Path to regional PMTiles v3 vector basemap. |
| `FOREST_SYNC_URL` | `https://<app>.vercel.app/api/sync` | *(Unused)* | Optional HTTPS endpoint for one-way sync worker. Leave empty for offline-only. |
| `FOREST_SYNC_TOKEN` | `<secret-token>` | *(Unused)* | Per-device upload token output by `npm run cloud:setup`. |
| `MONGODB_URI` | *(Unused)* | `mongodb+srv://...` | MongoDB Atlas replica-set connection string. |
| `MONGODB_DATABASE` | *(Unused)* | `forest_monitor` | MongoDB database name. |
| `FOREST_CLOUD_DEVICE_ID` | *(Unused)* | `<pi-uuid>` | UUID of the Raspberry Pi outpost from `npm run sync:status`. |

---

## 6. Verification & Build Commands

Note: On Windows PowerShell where script execution policy blocks `npm.ps1`, invoke `npm.cmd`.

```sh
# 1. Verify all 27 offline map assets (glyphs, sprites, and mapawa_malasag.pmtiles SHA-256)
npm.cmd run map:assets -- --check

# 2. Run all 36 unit & subsystem tests (SQLite, maps, sync, cloud connection, timeline)
npm.cmd test

# 3. Run ESLint and TypeScript checks
npm.cmd run lint
npm.cmd run typecheck

# 4. Build production bundle (use --webpack in restricted Windows environments)
npm.cmd run build -- --webpack

# 5. Run compiled Next.js API route integration tests (requires production build)
npm.cmd run test:routes

# 6. Check MongoDB Atlas connectivity and readiness (reads .env.cloud.local)
npm.cmd run db:check
```

---

## 7. Current Status & Remaining Deployment Steps

- **Verified & Passing**:
  - All 36 unit tests (`npm.cmd test`), ESLint (`npm.cmd run lint`), TypeScript (`npm.cmd run typecheck`), offline map asset hash verification (`npm.cmd run map:assets -- --check`), production Webpack build (`npm.cmd run build -- --webpack`), and compiled route integration tests (`npm.cmd run test:routes`).
  - `public/maps/mapawa_malasag.pmtiles` is fully wired into `lib/server/maps.mjs`, `next.config.ts` file tracing, `public/maps/asset-manifest.json`, `.env*` files, and `tests/maps.test.mjs`.
  - MongoDB Atlas connection, replica-set transactions, and collection indexes (`users`, `devices`, `mirror`, `sessions`, `login_attempts`) are verified and provisioned.
- **Pending Physical Raspberry Pi / Hardware Integration**:
  1. Run `npm run sync:status` on the physical Raspberry Pi to obtain its generated `deviceId`, then register it in Atlas via `npm run cloud:setup -- --device <pi-device-id> --name "Forest Outpost 03"` and set `FOREST_CLOUD_DEVICE_ID` in `.env.cloud.local` / Vercel.
  2. Connect actual ESP32/LoRa hardware packet ingestion and Raspberry Pi ML/TDoA inference scripts to insert live sensor telemetry and detections into SQLite.

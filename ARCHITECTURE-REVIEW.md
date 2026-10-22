# Offline map and hybrid deployment review

Reviewed: 2026-10-22. Target: Raspberry Pi 4 Model B, 8 GB, mostly offline.

## Decision

**MapLibre + a bounded, local Protomaps PMTiles archive passes the software architecture review for this project.** It adds a real geographic basemap without making the outpost depend on Google APIs or internet access. The optional Vercel/MongoDB design is implemented as a separate, read-only mirror. Live cloud deployment and Raspberry Pi performance validation remain deployment checks, not claims established by the local tests.

## Project context and boundaries

The application is an acoustic forest-monitoring dashboard: configured sensor nodes, estimated incident locations, classification/confidence, dispatch workflows, teams, and reports. Next.js serves both the UI and authenticated API. Local SQLite persists accounts, sessions, telemetry/configuration, incident actions, and audits. Local credentials replace Google login. Dashboard clients need a LAN connection to the Pi; they do not need an internet uplink.

Hardware ingestion, inference, synchronized TDoA measurements, recorded audio, and delivered notifications are not connected. A geographic map places the supplied coordinates on a basemap; it does not establish that a detection is accurate or that sensors are online.

## Findings and implemented safeguards

| Concern | Result / safeguard |
| --- | --- |
| Offline maps can silently retain CDN dependencies | Bundled PMTiles, local style generation, fonts, and sprites. Only optional attribution links lead outside the local host. Both theme styles validate against the MapLibre specification. |
| A world archive is too large for the Pi | A 3.3 MB regional archive is bundled. Preparation rejects more than 4,096 tiles, zooms above 15, or more than 256 MB of compressed tile data. Sources and hashes are pinned. |
| Downloading the whole archive for each map request | Authenticated range endpoint returns exact `206` byte ranges, ETag and `Content-Range`; no transformations; requests capped at 4 MB. Missing/corrupt files produce a readable fallback. |
| Pi/client memory and rendering | Two MapLibre workers, 100-tile cache, persistent map instance during polling, explicit resize/theme handling and cleanup, coordinate fallback on WebGL/render failure. The viewing browser renders the map. Actual ML-plus-browser load must be measured on the Pi. |
| Coordinates outside the prepared region | Visible warning and coordinate plot; the selected region is not represented as worldwide coverage. |
| Vercel cannot retain local SQLite writes | Cloud mode uses MongoDB only. Vercel is also detected automatically to prevent accidentally opening SQLite there. PMTiles is read-only and explicitly included in server function traces. |
| Outages could stop local work | Uploads run in a separate optional process. Local requests never wait for them; SQLite and account checks remain local. |
| Lost data or duplicates during reconnect | Source writes and outbox events share one SQLite transaction. MongoDB mirror updates and acknowledgment share one replica-set transaction. Exact batch replay is idempotent; only acknowledged events are deleted locally. |
| Deletes and updates could be omitted | Database triggers capture insert/update/delete operations; tombstones are mirrored. The migration bootstraps existing monitoring records once. |
| Multiple workers / restored backups | Local worker lease; monotonic sequences; cloud rejects stale or diverging acknowledgment history with `409`. Restore instructions preserve identity and queue. No silent cloud overwrite or automatic identity reset. |
| Idle outpost looks disconnected | Contact heartbeat once a minute; cloud shows its last contact time and read-only status. |
| Cloud edits conflict with offline edits | Cloud UI hides/disables changes, context rejects mutations, and every monitoring mutation API rejects them in cloud mode, including cloud-admin requests. |
| Local credentials leaked to cloud | Only telemetry, incidents, teams, node events, and outpost settings enter the outbox. Users, password hashes, sessions, and audit records are excluded. Cloud accounts are provisioned separately. |
| Asset provenance | Map manifest records source, bounding box, zooms, bytes and SHA-256. OpenStreetMap attribution and Noto/icon licenses are included. |

## Validation

Follow-up review on 2026-10-22 reproduced and corrected three implementation gaps:

| Finding | Correction |
| --- | --- |
| An accepted upload with a lost response could fail its next retry if more local records arrived, because the retry batch changed | Persist the exact in-flight request before sending. Reuse it across retries and process restarts, and clear it atomically with acknowledged outbox records. Regression coverage includes new local writes and a separate restarted worker process. |
| Incident details invented node-arrival and CNN/TDoA completion timestamps from fixed offsets | Render only recorded detection, dispatch, and closure timestamps. Pairwise TDoA readings remain separate from the event timeline. |
| Null/primitive sync events could throw a server error instead of a client validation response | Validate event object shape before reading its fields and return a `400` error. |

Automated checks cover local authentication/persistence/backup, official PMTiles-reader round trips, real regional MVT decoding, bundled asset hashes, both map styles, range responses and archive failures, outbox transaction rollback, deletion tombstones, retry/lost acknowledgment/replay, stale-device rejection, idle heartbeats, competing-worker leases, and the cloud SQLite guard.

The compiled API integration check uses actual Next.js route modules and request/cookie contexts. It covers authentication and roles, mutation validation, map authorization/ranges/HEAD, sync-envelope rejection, and read-only cloud mutation rejection. The cloud mutation check uses a small session-store fixture; it does not claim an Atlas connection. The production webpack build and output traces verify that the archive is packaged with its read endpoints.

Completed in this workspace: 29 automated tests, compiled-route integration checks, TypeScript, bundled asset verification, and a production webpack build in cloud mode without accessing a database at build time. The restricted Windows filesystem required pre-created output directories and `FOREST_PRESERVE_BUILD_OUTPUT=true` for the final build; normal builds keep Next's output cleanup enabled. Previous generated output was preserved in the ignored cache directory.

No Atlas/Vercel credentials or target Pi are available in this workspace. Live MongoDB transaction behavior, deployment networking/secrets, browser WebGL behavior on field devices, offline cold boot, reboot recovery, and resource use alongside ML require checks on the actual deployment. The workspace's network isolation also limits local HTTP/browser preview testing; compiled route tests provide coverage without a socket.

The full HTTP smoke check was attempted: Next started successfully, but loopback requests failed with `connect EACCES`. The in-app browser also timed out reaching the local preview. These checks are environment-blocked and are not reported as passing.

## Remaining operational limits

- The map is regional and dated, with vector detail through zoom 15. There is no satellite imagery, routing, terrain elevation, or automatic map update. Update packages while connected and retain attribution/licenses.
- Use 64-bit Linux and Node.js 24.15+ within 24.x. SQLite should be on persistent local storage; maintain off-device backups and reserve resources for inference. A stable clock/RTC matters for sessions, incident timestamps, and offline reporting; precise TDoA timing belongs in the hardware pipeline.
- The mirror needs a MongoDB replica set/Atlas, because atomic transactions are part of its correctness. A standalone MongoDB server is insufficient for this receiver. Cloud accounts require index provisioning; the setup/account scripts handle it.
- This is one outpost per cloud dashboard and one-way synchronization. Multi-outpost tenancy, remote dispatch, two-way edits/conflict resolution, automatic restore reseeding, and recording uploads are outside this implementation.
- Long outages grow the durable outbox. Monitor disk use, and do not discard queued records to make status appear healthy. Raw audio should eventually have separate storage/retention rather than enter this queue.
- The existing incident UI/report API reads the full incident history. For sustained high event rates, add pagination, server-side report aggregation, retention, and load testing before field-scale ingestion. Node-event display queries are already limited to the latest 100; this does not silently truncate incident reports or exports.

## Primary references consulted

- PMTiles v3 format: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
- MapLibre integration: https://docs.protomaps.com/pmtiles/maplibre
- Regional extraction: https://docs.protomaps.com/pmtiles/cli
- Basemap styles/assets: https://github.com/protomaps/basemaps and https://github.com/protomaps/basemaps-assets
- MapLibre GL JS API: https://maplibre.org/maplibre-gl-js/docs/API/
- Vercel filesystem/runtime limits: https://vercel.com/docs/functions/limitations
- MongoDB transaction support: https://www.mongodb.com/docs/manual/core/transactions/

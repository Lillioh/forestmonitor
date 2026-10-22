import { getDatabase } from "../lib/server/database.mjs";
import { localSyncStatus } from "../lib/server/sync/local.mjs";
console.log(JSON.stringify(localSyncStatus(getDatabase()), null, 2));

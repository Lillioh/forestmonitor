import { isCloud } from "./deployment.mjs";

export async function databaseHealth() {
  if (isCloud()) {
    const { cloudDatabase } = await import("./cloud/database.mjs");
    const result = await (await cloudDatabase()).command({ ping: 1 }, { timeoutMS: 5000 });
    if (result.ok !== 1) throw new Error("Database health check failed.");
  } else {
    const { getDatabase } = await import("./database.mjs");
    getDatabase().prepare("SELECT 1").get();
  }
}

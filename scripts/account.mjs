import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { createAccount, resetPassword } from "../lib/server/account-store.mjs";
import { isCloud } from "../lib/server/deployment.mjs";

let rl;
async function question(prompt) {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  return (await rl.question(prompt)).trim();
}

async function password(prompt) {
  if (!process.stdin.isTTY) throw new Error("Run account management in an interactive terminal. Passwords are not accepted as command-line arguments.");
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function finish(error) {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    }
    function onKey(text, key) {
      if (key?.ctrl && key.name === "c") return finish(new Error("Canceled."));
      if (key?.name === "return" || key?.name === "enter") return finish();
      if (key?.name === "backspace") { value = value.slice(0, -1); return; }
      if (text && !key?.ctrl && !key?.meta && !/[\u0000-\u001f\u007f]/.test(text)) value += text;
    }
    process.stdin.on("keypress", onKey);
  });
}

try {
  const { values } = parseArgs({ options: { username: { type: "string" }, name: { type: "string" }, role: { type: "string" }, reset: { type: "boolean" }, "generate-password": { type: "boolean" } } });
  const reset = values.reset;
  const username = values.username || await question("Username: ");
  const name = reset ? username : values.name || await question("Display name: ");
  const role = reset ? "operator" : (values.role || await question("Role (admin/operator): ")).toLowerCase();
  rl?.close();
  const generated = values["generate-password"];
  const secret = generated ? randomBytes(24).toString("base64url") : await password("Password (12–128 characters, hidden): ");
  if (!generated && secret !== await password("Confirm password (hidden): ")) throw new Error("Passwords do not match.");
  if (isCloud()) await (await import("../lib/server/cloud/database.mjs")).createCloudIndexes();
  if (reset) { await resetPassword(username, secret); console.log("Password updated. Previous sessions were revoked."); }
  else { const user = await createAccount({ username, password: secret, name, role }); console.log(`${isCloud() ? "Cloud" : "Local"} ${user.role} account '${user.username}' created.`); }
  if (generated) console.log(`Generated password: ${secret}`);
} catch (error) {
  console.error(error.code === "ERR_SQLITE_ERROR" && error.message.includes("UNIQUE") ? "That username is already registered." : error.message);
  process.exitCode = 1;
} finally {
  rl?.close();
  if (isCloud()) await (await import("../lib/server/cloud/database.mjs")).closeCloudConnections();
}

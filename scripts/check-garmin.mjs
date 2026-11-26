// Checks your Garmin API key without deploying anything:
//   npm run check-garmin
// Reads GARMIN_API_KEY from .dev.vars (or the environment), gets an access token,
// and prints yesterday's step count.
import { readFileSync, existsSync } from "node:fs";

const BASE = "https://personal.connectapi.garmin.com";

function devVar(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".dev.vars")) return undefined;
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
  }
}

const key = devVar("GARMIN_API_KEY");
if (!key) {
  console.error("No GARMIN_API_KEY found. Run `cp .dev.vars.example .dev.vars` and fill it in.");
  process.exit(1);
}

const tokenRes = await fetch(`${BASE}/personalapitoken-service/personal-api/personal-api-key/token`, {
  method: "POST",
  headers: { Accept: "*/*", Authorization: `ApiKey ${key}` },
});
if (!tokenRes.ok) {
  console.error(`✗ Token exchange failed: HTTP ${tokenRes.status}. Is the key correct and not expired? Manage keys at https://connect.garmin.com/app/settings/personalApiToken`);
  process.exit(1);
}
const token = (await tokenRes.text()).trim();
const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp;
console.log(`✓ Got an access token (valid until ${new Date(exp * 1000).toISOString()})`);

const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const res = await fetch(`${BASE}/usersummary-service/stats/steps/daily/${day}/${day}`, {
  headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`✗ Data request failed: HTTP ${res.status}`);
  process.exit(1);
}
const data = await res.json();
const steps = Array.isArray(data) ? data[0]?.totalSteps : undefined;
console.log(`✓ Garmin data works. Steps on ${day}: ${steps ?? "(no data for that day)"}`);

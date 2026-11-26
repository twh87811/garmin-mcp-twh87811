import type { Env } from "./env";

// Garmin Connect Personal API (official, read-only).
// Reference: https://github.com/garmin/connect-personal-api-python
const BASE_URL = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const TOKEN_CACHE_KEY = "garmin:bearer";
const REFRESH_WINDOW_S = 60 * 60; // refresh when less than an hour is left, like Garmin's client

export class GarminError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function jwtExpiry(token: string): number {
  const part = token.split(".")[1];
  if (!part) throw new GarminError(502, "Garmin token endpoint did not return a JWT");
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4));
  const exp = Number(JSON.parse(json).exp);
  if (!Number.isFinite(exp)) throw new GarminError(502, "Garmin token has no exp claim");
  return exp;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bearerToken(env: Env, forceRefresh = false): Promise<string> {
  if (!env.GARMIN_API_KEY) throw new GarminError(500, "GARMIN_API_KEY secret is not set");
  // The cache entry is tied to the key, so rotating the key invalidates it.
  const fingerprint = await sha256(env.GARMIN_API_KEY);
  const now = Date.now() / 1000;

  if (!forceRefresh) {
    const cached = await env.OAUTH_KV.get<{ token: string; exp: number; fp: string }>(TOKEN_CACHE_KEY, "json");
    if (cached && cached.fp === fingerprint && cached.exp - now > REFRESH_WINDOW_S) return cached.token;
  }

  const res = await fetch(BASE_URL + TOKEN_PATH, {
    method: "POST",
    headers: { Accept: "*/*", Authorization: `ApiKey ${env.GARMIN_API_KEY}` },
  });
  if (!res.ok) {
    throw new GarminError(res.status, `Garmin token exchange failed (${res.status}). Check that the API key is valid and not expired.`);
  }
  const token = (await res.text()).trim();
  const exp = jwtExpiry(token);
  const ttl = Math.max(60, Math.floor(exp - now));
  await env.OAUTH_KV.put(TOKEN_CACHE_KEY, JSON.stringify({ token, exp, fp: fingerprint }), { expirationTtl: ttl });
  return token;
}

export type Query = Record<string, string | number | undefined>;

/** GET a Personal API path and return parsed JSON (null for an empty body). */
export async function garminGet(env: Env, path: string, query: Query = {}): Promise<unknown> {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));

  let token = await bearerToken(env);
  let res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    // Token revoked or expired early: get a fresh one and retry once.
    token = await bearerToken(env, true);
    res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new GarminError(res.status, `Garmin API ${res.status} for ${url.pathname}: ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

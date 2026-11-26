// Garmin's Personal API rejects date ranges longer than 28 days (HTTP 400). These helpers split a
// longer range into 28-day chunks and merge the chunk responses back into one result.

export const MAX_CHUNK_DAYS = 28;
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Inclusive number of days from start to end. */
export function daySpan(start: string, end: string): number {
  return Math.round((toMs(end) - toMs(start)) / DAY_MS) + 1;
}

/** Split an inclusive range into consecutive inclusive chunks of at most `size` days, oldest first. */
export function chunkRange(start: string, end: string, size = MAX_CHUNK_DAYS): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let s = toMs(start), last = toMs(end); s <= last; s += size * DAY_MS) {
    out.push([toDate(s), toDate(Math.min(s + (size - 1) * DAY_MS, last))]);
  }
  return out;
}

const DATE_KEYS = ["calendarDate", "summaryDate", "date"] as const;

/** Sort items oldest first by their calendar date, when every item has one; otherwise keep the order. */
function byDate(items: unknown[]): unknown[] {
  const key = DATE_KEYS.find((k) =>
    items.every((i) => i && typeof i === "object" && /^\d{4}-\d{2}-\d{2}/.test(String((i as Record<string, unknown>)[k]))),
  );
  if (!key) return items;
  const d = (i: unknown) => String((i as Record<string, unknown>)[key]);
  return [...items].sort((a, b) => (d(a) < d(b) ? -1 : d(a) > d(b) ? 1 : 0));
}

/**
 * Merge chunk responses in order. Arrays are concatenated. For objects, array-valued fields are
 * concatenated; any other field is kept only if every chunk agrees on it, because a per-chunk
 * aggregate (such as an average) would be wrong for the whole range.
 */
export function mergeChunks(parts: unknown[]): unknown {
  const present = parts.filter((p) => p !== null && p !== undefined);
  if (present.length <= 1) return present[0] ?? null;
  if (present.every(Array.isArray)) return byDate((present as unknown[][]).flat());
  if (!present.every((p) => typeof p === "object" && !Array.isArray(p))) return present;

  const objs = present as Record<string, unknown>[];
  const out: Record<string, unknown> = {};
  for (const key of new Set(objs.flatMap((o) => Object.keys(o)))) {
    const values = objs.map((o) => o[key]).filter((v) => v !== undefined);
    if (values.every(Array.isArray)) {
      out[key] = byDate((values as unknown[][]).flat());
    } else if (values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]))) {
      out[key] = values[0];
    }
  }
  return out;
}

// --- Offline action queue (Phase 4) --------------------------------------
// Persistent queue for article state changes (star / archive / read via
// setArticleState) taken while the network is unreachable. Reliability-
// first: an offline tap is never lost and never blocks the UI. The queue
// stores the latest desired state per article (coalesced, not a tap log),
// survives app restarts in localStorage alongside the Phase 2 cache, and
// is replayed on the `online` event and on app open. Brief feedback is
// deliberately NOT queued here — it has its own server path and is out of
// scope for this phase.

export type QueuedArticleState = {
  id: number;
  starred?: boolean;
  archived?: boolean;
  read?: boolean;
  updatedAt: number;
};

export type ArticleStateArgs = { id: number; read?: boolean; starred?: boolean; archived?: boolean };

const STORAGE_KEY = "news-offline-queue-v1";

let cached: QueuedArticleState[] | null = null;
const listeners = new Set<() => void>();

function load(): QueuedArticleState[] {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) { cached = []; return cached; }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) { cached = []; return cached; }
    cached = parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const r = item as Record<string, unknown>;
      if (typeof r.id !== "number") return [];
      const entry: QueuedArticleState = { id: r.id, updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now() };
      if (typeof r.starred === "boolean") entry.starred = r.starred;
      if (typeof r.archived === "boolean") entry.archived = r.archived;
      if (typeof r.read === "boolean") entry.read = r.read;
      // An entry with no state fields carries no intent; drop it.
      if (entry.starred === undefined && entry.archived === undefined && entry.read === undefined) return [];
      return [entry];
    });
    return cached;
  } catch {
    cached = [];
    return cached;
  }
}

function persist(): void {
  try {
    if (!cached || cached.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch { /* Storage unavailable: queue stays in memory for this session. */ }
}

function notify(): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* a listener must never break the queue */ }
  }
}

export function getOfflineQueue(): QueuedArticleState[] {
  return load();
}

export function subscribeOfflineQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Coalescing enqueue: the queue holds the latest desired state per
// article, not a log of taps. Fields present in `args` overwrite the
// stored values for that article; fields absent keep their stored value,
// so star-then-archive offline merges into one pending entry and
// star-then-unstar nets to the final value.
export function enqueueOfflineState(args: ArticleStateArgs): void {
  const queue = [...load()];
  const idx = queue.findIndex((e) => e.id === args.id);
  const now = Date.now();
  if (idx >= 0) {
    const existing = queue[idx] as QueuedArticleState;
    const merged: QueuedArticleState = { ...existing, updatedAt: now };
    if (args.starred !== undefined) merged.starred = args.starred;
    if (args.archived !== undefined) merged.archived = args.archived;
    if (args.read !== undefined) merged.read = args.read;
    queue[idx] = merged;
  } else {
    const entry: QueuedArticleState = { id: args.id, updatedAt: now };
    if (args.starred !== undefined) entry.starred = args.starred;
    if (args.archived !== undefined) entry.archived = args.archived;
    if (args.read !== undefined) entry.read = args.read;
    queue.push(entry);
  }
  cached = queue;
  persist();
  notify();
}

export function removeOfflineEntry(id: number): void {
  const queue = load();
  if (!queue.some((e) => e.id === id)) return;
  cached = queue.filter((e) => e.id !== id);
  persist();
  notify();
}

export function removeOfflineEntries(ids: readonly number[]): void {
  if (!ids.length) return;
  const set = new Set(ids);
  const queue = load();
  if (!queue.some((e) => set.has(e.id))) return;
  cached = queue.filter((e) => !set.has(e.id));
  persist();
  notify();
}

// After a successful online write for an article, the fields that write
// carried are no longer pending: the server now holds the user's latest
// intent for them (whether it matches or supersedes the queued value).
// Other queued fields for the same article stay pending.
export function removeOfflineFields(id: number, fields: readonly string[]): void {
  if (!fields.length) return;
  const queue = load();
  const idx = queue.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const existing = queue[idx] as QueuedArticleState;
  const next: QueuedArticleState = { ...existing };
  let touched = false;
  for (const field of fields) {
    if (field === "starred" && next.starred !== undefined) { delete next.starred; touched = true; }
    if (field === "archived" && next.archived !== undefined) { delete next.archived; touched = true; }
    if (field === "read" && next.read !== undefined) { delete next.read; touched = true; }
  }
  if (!touched) return;
  if (next.starred === undefined && next.archived === undefined && next.read === undefined) {
    cached = queue.filter((e) => e.id !== id);
  } else {
    const copy = [...queue];
    copy[idx] = next;
    cached = copy;
  }
  persist();
  notify();
}

// Distinguish "no answer" (offline / unreachable — queue and retry later)
// from "the server answered and refused" (a genuine rejection — surface
// it and reconcile, never retry forever). Server answers carry an HTTP
// status or arrive wrapped as a SpaceActionError by the SDK client; a
// failed fetch with no response rejects as a TypeError ("Failed to
// fetch" / "Load failed") or an abort/timeout.
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!error) return false;
  const anyErr = error as { status?: unknown; statusCode?: unknown };
  if (typeof anyErr.status === "number" && anyErr.status >= 400) return false;
  if (typeof anyErr.statusCode === "number" && anyErr.statusCode >= 400) return false;
  const name = error instanceof Error ? error.name : "";
  if (name === "SpaceActionError") return false;
  const message = error instanceof Error ? error.message : String(error);
  const lower = `${name} ${message}`.toLowerCase();
  if (lower.includes("spaceactionerror")) return false;
  if (name === "TypeError") return true;
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network error") ||
    lower.includes("load failed") ||
    lower.includes("fetch failed") ||
    lower.includes("network request failed") ||
    lower.includes("the internet connection appears to be offline")
  ) return true;
  return false;
}

// --- Persisted query cache (Phase 2: instant open, stale-while-revalidate)
// The SDK query client already keeps an in-memory cache, so within a
// session a reopened view renders from cache and revalidates in the
// background. This module extends that across app restarts: the dashboard,
// board, and article queries are snapshotted to local storage and hydrated
// back into the client synchronously at startup, so the first paint after
// a restart shows the last known inbox / board / article immediately while
// the (staleTime: 0) queries revalidate behind it.
//
// Bounds, so a stale snapshot can never be served as if it were fresh:
// - Snapshots older than 24 hours are discarded, never hydrated.
// - Hydrated data keeps its original dataUpdatedAt, and the persisted
//   queries run with staleTime 0, so every mount revalidates in the
//   background regardless of the snapshot's age; a failed revalidation
//   leaves the cached data on screen (the views only show their error
//   state when there is no data at all).
// - Only successful, non-search queries are persisted: dashboard views
//   with an empty search, the board with an empty search, and individual
//   articles. At most 20 articles and 48 queries total are kept, and the
//   serialized snapshot is capped near 3 MB (oldest articles drop first).
// Mutations keep working coherently: optimistic updates write through the
// query cache, so the next snapshot carries them; a deleted article's
// query is removed from the cache, so it disappears from the snapshot too.
import { dehydrate, hydrate, type QueryClient, type Query } from "@tanstack/react-query";

const STORAGE_KEY = "news-query-cache-v1";
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SNAPSHOT_CHARS = 3_000_000;
const MAX_ARTICLE_QUERIES = 20;
const MAX_TOTAL_QUERIES = 48;

// Query keys that were hydrated from the persisted snapshot at startup.
// App.tsx reads this to split the client perf metrics into cache-warm
// (restored) and cold (network-first) opens.
const restoredKeys = new Set<string>();
export function wasRestored(queryKey: readonly unknown[]): boolean {
  return restoredKeys.has(JSON.stringify(queryKey));
}

// --- Prefetch priority (Phase 3) ------------------------------------------
// Articles warmed by background prefetching share the persisted budget
// (20 articles / ~3 MB) with articles the user actually opened, but they
// rank below them: when the snapshot has to drop articles, prefetched
// ones go first. App.tsx marks an article prefetched when a prefetch
// starts and explicit when the user opens it (an opened prefetch is
// promoted). The set is session-only; after a restart every hydrated
// article counts as explicit, which is fine — it earned its place by
// surviving the previous session's trim.
const prefetchedArticleIds = new Set<number>();
export function markPrefetchedArticle(id: number): void {
  prefetchedArticleIds.add(id);
}
export function markExplicitArticle(id: number): void {
  prefetchedArticleIds.delete(id);
}
function articleIdOf(query: { queryKey: readonly unknown[] }): number | null {
  const key = query.queryKey as unknown[];
  return key[0] === "article" && typeof key[1] === "number" ? key[1] : null;
}

function isPersistableQuery(query: Query): boolean {
  if (query.state.status !== "success" || query.state.data === undefined) return false;
  const key = query.queryKey as unknown[];
  const head = key[0];
  if (head === "dashboard") {
    // ["dashboard", view, theme, feedId, search, limit] — persist only the
    // empty-search variants; search results are transient and can be huge.
    // The Library starred/archive variants are ["dashboard", view,
    // "library", search] and follow the same empty-search rule.
    if (key.length >= 6) return key[4] === "";
    if (key.length === 4) return key[3] === "";
    return false;
  }
  if (head === "board") return key[1] === "";
  if (head === "article") return typeof key[1] === "number";
  return false;
}

type StoredSnapshot = { version: 1; savedAt: number; state: ReturnType<typeof dehydrate> };

export function restorePersistedCache(client: QueryClient): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredSnapshot;
    if (parsed.version !== 1 || typeof parsed.savedAt !== "number" || !parsed.state) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (Date.now() - parsed.savedAt > SNAPSHOT_MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    for (const q of parsed.state.queries) restoredKeys.add(JSON.stringify(q.queryKey));
    hydrate(client, parsed.state);
  } catch {
    // Storage unavailable or corrupt: start cold rather than fail the app.
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    restoredKeys.clear();
  }
}

function snapshot(client: QueryClient): string | null {
  try {
    const state = dehydrate(client, { shouldDehydrateQuery: isPersistableQuery });
    const byAgeDesc = [...state.queries].sort((a, b) => (b.state.dataUpdatedAt ?? 0) - (a.state.dataUpdatedAt ?? 0));
    // Article budget: explicitly opened articles outrank prefetched ones
    // (Phase 3); newest first within each class.
    const articleQueries = byAgeDesc.filter((q) => articleIdOf(q) !== null);
    articleQueries.sort((a, b) => {
      const pa = prefetchedArticleIds.has(articleIdOf(a) ?? -1) ? 1 : 0;
      const pb = prefetchedArticleIds.has(articleIdOf(b) ?? -1) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return (b.state.dataUpdatedAt ?? 0) - (a.state.dataUpdatedAt ?? 0);
    });
    const articles = articleQueries.slice(0, MAX_ARTICLE_QUERIES);
    const articleSet = new Set(articles);
    let kept = byAgeDesc.filter((q) => (q.queryKey as unknown[])[0] !== "article" || articleSet.has(q)).slice(0, MAX_TOTAL_QUERIES);
    const wrap = (queries: typeof kept): string => JSON.stringify({ version: 1, savedAt: Date.now(), state: { mutations: [], queries } } satisfies StoredSnapshot);
    let out = wrap(kept);
    // Size cap: drop prefetched articles first (oldest first), then the
    // oldest persisted articles, then the oldest of everything else,
    // until the snapshot fits.
    while (out.length > MAX_SNAPSHOT_CHARS && kept.length > 1) {
      const articleIdx = kept.map((q, i) => [articleIdOf(q) !== null ? i : -1, (kept[i]?.state.dataUpdatedAt ?? 0), articleIdOf(q)] as const).filter(([i]) => i >= 0);
      const prefetchedIdx = articleIdx.filter(([, , id]) => id !== null && prefetchedArticleIds.has(id)).sort((a, b) => a[1] - b[1])[0]?.[0];
      const oldestArticleIdx = articleIdx.sort((a, b) => a[1] - b[1])[0]?.[0];
      const dropIdx = prefetchedIdx ?? oldestArticleIdx ?? kept.length - 1;
      kept = kept.filter((_, i) => i !== dropIdx);
      out = wrap(kept);
    }
    return out.length <= MAX_SNAPSHOT_CHARS * 1.4 ? out : null;
  } catch { return null; }
}

export function installCachePersister(client: QueryClient): () => void {
  let timer: number | undefined;
  const save = () => {
    timer = undefined;
    try {
      const out = snapshot(client);
      if (out !== null) window.localStorage.setItem(STORAGE_KEY, out);
    } catch { /* Quota or private-mode storage: persistence is best-effort. */ }
  };
  const schedule = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(save, 400);
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === "removed") { schedule(); return; }
    if (event.type === "updated" && event.query.state.status === "success" && isPersistableQuery(event.query)) schedule();
  });
  const onHide = () => { if (timer !== undefined) { window.clearTimeout(timer); save(); } };
  window.addEventListener("pagehide", onHide);
  return () => { unsubscribe(); window.removeEventListener("pagehide", onHide); if (timer !== undefined) window.clearTimeout(timer); };
}

import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const themes = sqliteTable("themes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const feeds = sqliteTable("feeds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  themeId: integer("theme_id").notNull().references(() => themes.id),
  title: text("title").notNull(),
  url: text("url").notNull().unique(),
  siteUrl: text("site_url"),
  description: text("description"),
  muted: integer("muted", { mode: "boolean" }).notNull().default(false),
  keepForever: integer("keep_forever", { mode: "boolean" }).notNull().default(false),
  fetchError: text("fetch_error"),
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const articles = sqliteTable("articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feedId: integer("feed_id").notNull().references(() => feeds.id),
  guid: text("guid").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  author: text("author"),
  excerpt: text("excerpt"),
  body: text("body"),
  // Plain-text word count of the stored body, computed once when the body is
  // written (ingest, refresh update, fetch_full_text) so list queries can
  // derive read_minutes from a plain column instead of scanning every body
  // per request (Phase 1 perf fix). Backfilled for existing rows by
  // migration 0014 with the SQL approximation the list queries used before.
  wordCount: integer("word_count"),
  imageBlobKey: text("image_blob_key"),
  // Resized list-view variant of imageBlobKey (Phase 5): a small copy
  // (480px wide) generated once via the privileged resizer and served to
  // inbox/board/Library lists; the reader always uses imageBlobKey at
  // full size. Equals imageBlobKey when the original is already small;
  // null until generated (lists fall back to the original meanwhile).
  thumbnailBlobKey: text("thumbnail_blob_key"),
  imageAlt: text("image_alt"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  ingestedAt: integer("ingested_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
}, (t) => [uniqueIndex("articles_feed_guid_unique").on(t.feedId, t.guid)]);

// Photos pulled on demand from an article's original page (the reader's
// "Pull photos" action), stored as owned blobs like feed images. One row per
// photo, in story order (position). Caption/credit come from the page
// (figcaption or the source's embedded image metadata) and the reader
// renders each photo at its caption's position in the body, replacing the
// caption paragraph the full-text fetch left behind.
export const articlePhotos = sqliteTable("article_photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: integer("article_id").notNull().references(() => articles.id),
  blobKey: text("blob_key").notNull(),
  // Resized variant of blobKey (Phase 5), generated like the article
  // thumbnail; the reader renders blobKey full-size, lists never render
  // pulled photos directly except through the article's lead thumbnail.
  thumbnailBlobKey: text("thumbnail_blob_key"),
  sourceUrl: text("source_url").notNull(),
  caption: text("caption"),
  credit: text("credit"),
  alt: text("alt"),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const articleTombstones = sqliteTable("article_tombstones", {
  feedId: integer("feed_id").notNull().references(() => feeds.id),
  guid: text("guid").notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [primaryKey({ columns: [t.feedId, t.guid] })]);

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: integer("article_id").notNull().references(() => articles.id),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const highlights = sqliteTable("highlights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: integer("article_id").notNull().references(() => articles.id),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const digests = sqliteTable("digests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  theme: text("theme").notNull(),
  markdown: text("markdown").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  archiveDays: integer("archive_days").notNull().default(7),
  retentionDays: integer("retention_days").notNull().default(30),
  perfPhase: text("perf_phase").notNull().default("baseline"),
});

// Lightweight performance samples (Phase 0 instrumentation). One row per
// timed action or client-measured interaction: metric name, duration,
// response payload size in bytes (null for client visual metrics), phase
// label (e.g. "baseline", "phase1"), and timestamp. No article content,
// titles, or user data is ever stored here.
export const perfEvents = sqliteTable("perf_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metric: text("metric").notNull(),
  durationMs: integer("duration_ms").notNull(),
  bytes: integer("bytes"),
  phase: text("phase").notNull().default("baseline"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const pullRuns = sqliteTable("pull_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  newCount: integer("new_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  status: text("status", { enum: ["running", "complete", "partial", "failed"] }).notNull(),
});

// Brief tab ("Top Things to Know"): story-cluster editions produced by the
// external pipeline and pushed in through the
// save_brief_edition action. Stories are stored as one JSON document per
// edition; only the last 8 editions (24 hours at the 3-hour cadence) are kept.
export const briefEditions = sqliteTable("brief_editions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
  windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
  windowEnd: integer("window_end", { mode: "timestamp_ms" }).notNull(),
  stories: text("stories").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// One row per in-app feedback event on a brief story (click / star / unstar /
// dismiss / downvote / undownvote). Each row is a timestamped event carrying
// the story's topic and lead feed so get_brief_feedback_stats can aggregate
// downrank/boost signal by topic and source over time. get_brief folds these
// into per-story counts and flags; dismiss hides the story from the tab,
// downvote is ranking signal only and does not hide. Kept after the edition
// ages out of the tab so the ranking weights can be tuned from accumulated
// signal later.
export const briefDossiers = sqliteTable("brief_dossiers", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  status: text("status").notNull().default("active"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const briefFeedback = sqliteTable("brief_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  editionId: integer("edition_id").notNull(),
  storyKey: text("story_key").notNull(),
  type: text("type", { enum: ["click", "star", "unstar", "dismiss", "downvote", "undownvote"] }).notNull(),
  topic: text("topic"),
  feed: text("feed"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// Per-dossier reading marks for the Brief tab: whether the reader has pinned
// the dossier and when they last viewed it (drives the "Since you last
// looked" header and NEW badges). Keyed by dossier id; rows are created
// lazily by set_mark and live independently of the dossier store itself.
export const briefMarks = sqliteTable("brief_marks", {
  dossierId: text("dossier_id").primaryKey(),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  viewedAt: text("viewed_at"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

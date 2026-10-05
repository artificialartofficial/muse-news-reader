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
  imageBlobKey: text("image_blob_key"),
  imageAlt: text("image_alt"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  ingestedAt: integer("ingested_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
}, (t) => [uniqueIndex("articles_feed_guid_unique").on(t.feedId, t.guid)]);

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
});

export const pullRuns = sqliteTable("pull_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  newCount: integer("new_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  status: text("status", { enum: ["running", "complete", "partial", "failed"] }).notNull(),
});

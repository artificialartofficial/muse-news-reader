DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL REFERENCES themes(id),
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  site_url TEXT,
  description TEXT,
  muted INTEGER NOT NULL DEFAULT 0,
  fetch_error TEXT,
  last_fetched_at INTEGER,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL REFERENCES feeds(id),
  guid TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  excerpt TEXT,
  body TEXT,
  published_at INTEGER,
  ingested_at INTEGER NOT NULL,
  read_at INTEGER,
  archived_at INTEGER,
  starred INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX articles_feed_guid_unique ON articles(feed_id, guid);
--> statement-breakpoint
CREATE INDEX articles_published_idx ON articles(published_at DESC);
--> statement-breakpoint
CREATE INDEX articles_state_idx ON articles(read_at, archived_at, starred);
--> statement-breakpoint
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme TEXT NOT NULL,
  markdown TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX digests_theme_idx ON digests(theme, created_at DESC);
--> statement-breakpoint
CREATE TABLE settings (
  id INTEGER PRIMARY KEY,
  archive_days INTEGER NOT NULL DEFAULT 7
);
--> statement-breakpoint
INSERT INTO settings(id, archive_days) VALUES (1, 7);
--> statement-breakpoint
CREATE TABLE pull_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  new_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL
);

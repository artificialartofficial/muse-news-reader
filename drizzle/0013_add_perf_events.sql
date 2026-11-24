CREATE TABLE `perf_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`metric` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`bytes` integer,
	`phase` text DEFAULT 'baseline' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `perf_phase` text DEFAULT 'baseline' NOT NULL;

ALTER TABLE `settings` ADD `retention_days` integer NOT NULL DEFAULT 30;
--> statement-breakpoint
ALTER TABLE `feeds` ADD `keep_forever` integer NOT NULL DEFAULT 0;

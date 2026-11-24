CREATE TABLE `brief_editions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`generated_at` integer NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`stories` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brief_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`edition_id` integer NOT NULL,
	`story_key` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `brief_feedback_edition_story_idx` ON `brief_feedback` (`edition_id`, `story_key`);

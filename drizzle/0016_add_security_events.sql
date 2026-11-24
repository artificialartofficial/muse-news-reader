CREATE TABLE `security_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`source` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL
);

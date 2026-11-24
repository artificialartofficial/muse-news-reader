CREATE TABLE `brief_marks` (
	`dossier_id` text PRIMARY KEY NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`viewed_at` text,
	`updated_at` integer NOT NULL
);

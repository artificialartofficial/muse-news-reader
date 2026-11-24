ALTER TABLE `articles` ADD COLUMN `thumbnail_blob_key` text;
--> statement-breakpoint
ALTER TABLE `article_photos` ADD COLUMN `thumbnail_blob_key` text;

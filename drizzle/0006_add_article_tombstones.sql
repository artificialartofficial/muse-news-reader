CREATE TABLE `article_tombstones` (
  `feed_id` integer NOT NULL,
  `guid` text NOT NULL,
  `deleted_at` integer NOT NULL,
  PRIMARY KEY (`feed_id`, `guid`),
  FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE no action
);

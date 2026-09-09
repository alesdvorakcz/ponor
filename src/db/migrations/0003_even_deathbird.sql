CREATE TABLE `dive_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`series` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`dirty` integer NOT NULL
);

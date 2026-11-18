PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_dive_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`country` text,
	`latitude` real,
	`longitude` real,
	`salinity` text,
	`water_body` text,
	`entry` text DEFAULT '[]' NOT NULL,
	`max_depth_m` real,
	`site_types` text DEFAULT '[]' NOT NULL,
	`suitable_for` text,
	`alt_names` text DEFAULT '[]' NOT NULL,
	`description` text,
	`wreck_name` text,
	`wreck_sunk_year` integer,
	`created_by` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`dirty` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_dive_sites`("id", "name", "country", "latitude", "longitude", "salinity", "water_body", "entry", "max_depth_m", "site_types", "suitable_for", "alt_names", "description", "wreck_name", "wreck_sunk_year", "created_by", "status", "merged_into", "created_at", "updated_at", "deleted_at", "dirty") SELECT "id", "name", "country", "latitude", "longitude", "salinity", "water_body", "entry", "max_depth_m", "site_types", "suitable_for", "alt_names", "description", "wreck_name", "wreck_sunk_year", "created_by", "status", "merged_into", "created_at", "updated_at", "deleted_at", "dirty" FROM `dive_sites`;--> statement-breakpoint
DROP TABLE `dive_sites`;--> statement-breakpoint
ALTER TABLE `__new_dive_sites` RENAME TO `dive_sites`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
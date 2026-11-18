ALTER TABLE `dive_centers` ADD `address` text;--> statement-breakpoint
ALTER TABLE `dive_centers` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `dive_centers` ADD `email` text;--> statement-breakpoint
ALTER TABLE `dive_centers` ADD `opening_hours` text;--> statement-breakpoint
ALTER TABLE `dive_centers` ADD `services` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `dive_centers` ADD `agencies` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `dive_centers` ADD `description` text;--> statement-breakpoint
ALTER TABLE `dive_sites` ADD `site_types` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `dive_sites` ADD `suitable_for` text;--> statement-breakpoint
ALTER TABLE `dive_sites` ADD `alt_names` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `dive_sites` ADD `description` text;--> statement-breakpoint
ALTER TABLE `dive_sites` ADD `wreck_name` text;--> statement-breakpoint
ALTER TABLE `dive_sites` ADD `wreck_sunk_year` integer;
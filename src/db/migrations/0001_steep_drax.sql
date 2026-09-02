CREATE TABLE `dive_centers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`country` text,
	`latitude` real,
	`longitude` real,
	`website` text,
	`created_by` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`dirty` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dive_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`country` text,
	`latitude` real,
	`longitude` real,
	`salinity` text,
	`water_body` text,
	`entry` text,
	`max_depth_m` real,
	`created_by` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`dirty` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`last_pulled_at` text
);
--> statement-breakpoint
-- The two ALTERs below carry `DEFAULT 1`, which drizzle-kit does not emit and which this
-- file will not run without. SQLite refuses "Cannot add a NOT NULL column with default value
-- NULL" on a table that HAS ROWS — and accepts it on an empty one, so the generated form
-- passes every test in this repository and fails on the first device that has ever logged a
-- dive. (Executed, not assumed: sqlite 3.53.4 accepted it empty and rejected it with one row.)
--
-- 1, not 0, and that is the meaning as well as the mechanism: no row on any device has ever
-- been pushed, because there is no push yet — so every row that predates this column really
-- is waiting to go up. It is also the fail-safe direction in general, a row wrongly dirty
-- costing one redundant push where a row wrongly clean is a diver's data that never leaves
-- the phone.
--
-- `src/db/schema.ts` deliberately declares the column with NO Drizzle default, so an insert
-- that forgets the flag does not compile; the default here is for the ALTER and for any
-- writer that is not Drizzle. See that file's `dirtyFlag`.
ALTER TABLE `dives` ADD `dirty` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `gear_presets` ADD `dirty` integer DEFAULT 1 NOT NULL;
-- §6's certification wallet, arriving on the device (M3b). The Postgres side has existed
-- since M2a and both sync RPCs have carried these rows since M2b; this is the table they
-- had nowhere to land in.
--
-- **A new table, not an ALTER, which is what keeps M2d's defect out of it.** That round
-- found `drizzle-kit` emitting `add column … not null` with no default — refused by SQLite
-- only on a table that ALREADY HAS ROWS, so it passed every test here and would have failed
-- on the first phone that had ever logged a dive. `create table` has no such rule: the
-- table is empty by construction, so `dirty integer not null` with no default is accepted,
-- and it is deliberately left without one. Every writer is `src/db/certifications.ts`
-- through Drizzle, whose insert type will not compile without the flag (see `dirtyFlag`,
-- src/db/schema.ts), so a SQL-side default here could only ever mask a writer that had
-- forgotten it.
--
-- §10's collapse of the migration history to a single `0000` was a one-time act, on the
-- explicit ground that the app had never run on hardware. That window is closed, so this is
-- an additive file and `0000`/`0001` are untouched.
CREATE TABLE `certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`agency` text,
	`course` text,
	`card_number` text,
	`issued_on` text,
	`expires_on` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`dirty` integer NOT NULL
);

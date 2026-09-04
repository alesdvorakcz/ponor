import { and, eq, isNotNull, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { newId } from '../domain/ids';
import { resolveMergeTargets, type MergeRow } from '../domain/merges';
import { ACTIVE_CATALOGUE_STATUS, type DiveCenter, type DiveSite } from '../domain/types';
import {
  applyPulledRows,
  clearDirtyFlags,
  countPendingRows,
  flagAllRows,
  pendingRows,
  stampLocalWrite,
  type PushableTable,
  type PushedRow,
} from './dirty';
import { diveCenters, diveSites } from './schema';
import { liveRows } from './tombstone';
import type { Db } from './types';
import { EVERY_ROW } from './wipe';

/**
 * The device's copy of the community catalogue — every read and every write of `dive_sites`
 * and `dive_centers`, the way `db/dives.ts` owns a dive and `db/gearPresets.ts` a preset
 * (§4.1).
 *
 * **Why the device has a copy at all.** §5: "the compact site/center catalogue syncs to every
 * device … so autocomplete works fully offline", and §2.3: typing a site searches your own
 * history and then "the on-device copy of the community catalogue — both instant and fully
 * offline". `pull_changes` has returned that catalogue since M2b and there was nowhere to put
 * it; §6's "Local only" line still says the device keeps `settings` and `sync_state` and
 * nothing else, which is the gap M2d closes in code and reports for the plan.
 *
 * ── Two writers, and the difference between them is structural ────────────────────────────
 *
 * A row here arrives one of two ways, and they carry opposite answers to "does this have to
 * go up?": a site created on the boat is this device's and is **dirty**, a row that came down
 * in a pull is the server's and is **clean**. Pushing a pulled row back is not harmless — it
 * asks the server to restamp `updated_at` on a row nothing changed, and under §7's whole-row
 * last-write-wins that is a device that did nothing winning against one that did.
 *
 * So the two are separate functions taking **different types**, rather than one function with
 * a `dirty` argument: `createDiveSite` takes the handful of facts §2.3 collects and cannot be
 * told a flag, and `applyPulledDiveSites` takes a whole server row *whose type has no flag at
 * all* (`PulledSite` below). Neither caller can pick the wrong one by passing the wrong
 * boolean, because neither caller passes a boolean.
 *
 * ── What a read offers ────────────────────────────────────────────────────────────────────
 *
 * Every read here applies `pickable`: live (`db/tombstone.ts`) **and** `status = 'active'`.
 * That is the local half of the line M2c drew on the server — "a pull delivers tombstoned,
 * merged and hidden rows because the device has to be told about them; a search offers
 * something to pick" — and offering a merged duplicate would re-create the duplicate an admin
 * just merged away. A dive that points at a site the catalogue no longer offers still reads
 * correctly, because §6 stores a `site_name` snapshot beside every `site_id` for exactly this.
 *
 * **`mergeTargets` is the one exception, and it is the other half of the same sentence** (M2r).
 * The device is *told* about a merged row so that something can act on it; `pickable` hides
 * exactly the rows that question is about, so that read deliberately does not apply it. It
 * offers nothing to a diver — its answer is where a dive's `site_id` has to move to.
 */

/** A catalogue table: pushable (id, clock, flag) plus the two columns a read filters on and the
 * one §5's merge points with. */
type CatalogueTable = PushableTable & {
  readonly status: SQLiteColumn;
  readonly deletedAt: SQLiteColumn;
  readonly mergedInto: SQLiteColumn;
};

/**
 * What a read may offer a diver: not tombstoned, and `active`.
 *
 * Built rather than written twice, and it **throws rather than returning `undefined`** for a
 * reason worth stating: Drizzle's `and()` is `SQL | undefined`, and `.where(undefined)` is not
 * a narrower query but *no filter at all* — every tombstoned and merged row in the table,
 * silently, in both readers at once. The condition below cannot be undefined (both operands
 * are), so the throw is unreachable; what it buys is that it cannot become reachable quietly.
 */
function pickable(table: CatalogueTable): SQL {
  const condition = and(liveRows(table), eq(table.status, ACTIVE_CATALOGUE_STATUS));
  if (condition === undefined) throw new Error('pickable: empty condition');
  return condition;
}

/**
 * The bookkeeping half of a row this device creates: a client-generated UUIDv7 (§6, so
 * offline creation never needs re-mapping), the clock, and the dirty flag — the last two from
 * one `stampLocalWrite` so they cannot come apart, exactly as `createDive` takes them.
 */
function newLocalRow() {
  const stamp = stampLocalWrite();
  return { id: newId(), createdAt: stamp.updatedAt, ...stamp, deletedAt: null };
}

/**
 * Columns a device never authors, stripped at runtime as well as excluded at the type level —
 * the same belt-and-braces `db/dives.ts` applies to `IMMUTABLE_FIELDS`, and here it is a
 * mirror of what the server itself refuses:
 *
 *   · `status` / `mergedInto`  §5 gives the merge queue to the admin in Studio, and
 *                              `push_changes` refuses both from a client outright. A device
 *                              that could write them would hold an opinion the server would
 *                              never accept — the row would push, be silently ignored on
 *                              those two columns, and read back different from what was sent.
 *   · `createdBy`              the server sets it from `auth.uid()`; the payload's is never
 *                              read (M2b). A locally invented one is fiction.
 *   · id / the stamps / dirty  as everywhere else: consequences of a write, never its subject.
 */
const SERVER_AUTHORED = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'dirty', 'status', 'mergedInto', 'createdBy'] as const;
type ServerAuthored = (typeof SERVER_AUTHORED)[number];

function withoutServerAuthored<T extends object>(input: T): Omit<T, ServerAuthored> {
  const safe = { ...input } as Record<string, unknown>;
  for (const field of SERVER_AUTHORED) delete safe[field];
  return safe as Omit<T, ServerAuthored>;
}

/**
 * What §2.3 collects when a diver adds a site from the boat: "creating a new site asks only
 * for a name; country is inferred, and a GPS pin can be set from the map or *use my
 * location*".
 *
 * `name` is required **here** while the column stays nullable, and the two are not in
 * conflict: the column mirrors Postgres, where it is nullable so that §7's one-transaction
 * push can never reject a diver's whole sync over one row (§1) — and nothing in this app has
 * any business creating a site nobody can see the name of.
 */
export type NewDiveSiteInput = Partial<Omit<DiveSite, ServerAuthored | 'name'>> & { name: string };
export type NewDiveCenterInput = Partial<Omit<DiveCenter, ServerAuthored | 'name'>> & { name: string };

/**
 * A row as `pull_changes` hands it over: everything the table has **except the flag**, which
 * is not the server's to have an opinion about. The type is the guarantee — a pulled row
 * cannot arrive dirty because there is nowhere in it to say so.
 */
export type PulledSite = Omit<DiveSite, 'dirty'>;
export type PulledCenter = Omit<DiveCenter, 'dirty'>;

/**
 * Type-level proof that each row and its domain type describe the same shape — `Mutual` in
 * `db/dives.ts`, twice more. If either stops compiling, `schema.ts` and `domain/types.ts`
 * have drifted; fix the drift rather than loosening the assertion.
 */
type Assert<T extends true> = T;
export type MutualDiveSite = Assert<
  (typeof diveSites.$inferSelect extends DiveSite ? true : false) extends true
    ? (DiveSite extends typeof diveSites.$inferSelect ? true : false)
    : false
>;
export type MutualDiveCenter = Assert<
  (typeof diveCenters.$inferSelect extends DiveCenter ? true : false) extends true
    ? (DiveCenter extends typeof diveCenters.$inferSelect ? true : false)
    : false
>;

// ──────────────────────────────────────────────────────────────────────────────────────
// Reads
// ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The site read, filtered by `pickable` and deliberately unsorted — the shape
 * `diveRowsQuery` and `gearPresetRowsQuery` take, and for the same reason: `listDiveSites`
 * awaits it and a `useLiveQuery` caller needs the builder. Ordering belongs to
 * `domain/suggest.ts`, which decides what autocomplete offers and in what order (§4.1).
 */
export function diveSiteRowsQuery(db: Db) {
  return db.select().from(diveSites).where(pickable(diveSites));
}

export function diveCenterRowsQuery(db: Db) {
  return db.select().from(diveCenters).where(pickable(diveCenters));
}

export async function listDiveSites(db: Db): Promise<DiveSite[]> {
  return diveSiteRowsQuery(db);
}

export async function listDiveCenters(db: Db): Promise<DiveCenter[]> {
  return diveCenterRowsQuery(db);
}

export async function getDiveSite(db: Db, id: string): Promise<DiveSite | null> {
  const rows = await db
    .select()
    .from(diveSites)
    .where(and(eq(diveSites.id, id), pickable(diveSites)))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function getDiveCenter(db: Db, id: string): Promise<DiveCenter | null> {
  const rows = await db
    .select()
    .from(diveCenters)
    .where(and(eq(diveCenters.id, id), pickable(diveCenters)))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * **Where every merged row in this table sends a dive** — the read half of §5's merge, and the
 * one read here that deliberately does *not* apply `pickable`.
 *
 * That is the point of it: `pickable` hides exactly the rows this question is about. A merged
 * row is not something to offer a diver, it is something to *follow*, and until M2r nothing
 * followed one (`domain/merges.ts` has the whole of what was silently broken).
 *
 * `resolveMergeTargets` owns the rule — which statuses are followed, how far a chain runs, and
 * what a circular one answers. The `where` below is a **narrowing, not a rule**: a row with no
 * `merged_into` cannot contribute an edge, so this is the same answer as reading the whole
 * catalogue and a great deal less of it on a device holding thousands of sites. Every status
 * that carries a pointer reaches the resolver, `hidden` included, because refusing that one
 * here would move the decision into a `where` clause and out of the module that is tested for
 * it.
 *
 * Tombstones are not filtered either, for the same reason `pendingRows` does not filter them:
 * the fact that A was merged into B does not stop being true because somebody later deleted A,
 * and the dives at A still belong with the dives at B.
 */
async function mergeTargets(db: Db, table: CatalogueTable): Promise<ReadonlyMap<string, string>> {
  const rows = await db
    .select({ id: table.id, status: table.status, mergedInto: table.mergedInto })
    .from(table)
    .where(isNotNull(table.mergedInto));
  return resolveMergeTargets(rows as MergeRow[]);
}

export async function diveSiteMergeTargets(db: Db): Promise<ReadonlyMap<string, string>> {
  return mergeTargets(db, diveSites);
}

/**
 * The same question for centres, and it is not a courtesy: §5 merges "a site or center" in one
 * breath, M2a put `merged_into` on `dive_centers` for exactly that reason ("a `status` that can
 * read `merged` with nowhere to point is a state with no repair"), and a dive carries
 * `center_id` beside `site_id`. A merged centre breaks `tripKeyOf` (domain/trips.ts) the same
 * silent way a merged site breaks the Map — one trip becomes two, and nothing says so.
 */
export async function diveCenterMergeTargets(db: Db): Promise<ReadonlyMap<string, string>> {
  return mergeTargets(db, diveCenters);
}

// ──────────────────────────────────────────────────────────────────────────────────────
// The first writer: a site or centre created on this device
// ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Adds a site the diver created — §5's "any signed-in user can add a site or center", and the
 * offline half of it, which is the whole reason the id is generated here rather than by the
 * server (§6).
 *
 * The row is **dirty**: it exists nowhere else, and until it goes up it is on one phone.
 */
export async function createDiveSite(db: Db, input: NewDiveSiteInput): Promise<DiveSite> {
  const rows = await db
    .insert(diveSites)
    .values({ ...withoutServerAuthored(input), ...newLocalRow() })
    .returning();
  const created = rows.at(0);
  if (created === undefined) throw new Error('createDiveSite: insert returned no row');
  return created;
}

/** `createDiveSite` for a centre — §5 covers "a site or center" in one sentence. */
export async function createDiveCenter(db: Db, input: NewDiveCenterInput): Promise<DiveCenter> {
  const rows = await db
    .insert(diveCenters)
    .values({ ...withoutServerAuthored(input), ...newLocalRow() })
    .returning();
  const created = rows.at(0);
  if (created === undefined) throw new Error('createDiveCenter: insert returned no row');
  return created;
}

// ──────────────────────────────────────────────────────────────────────────────────────
// The second writer: rows that came down in a pull
// ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Writes rows the server sent, **clean**, and only where they may safely replace what is here
 * — `applyPulledRows` (db/dirty.ts) is the rule and carries the three reasons. It lived here
 * until M2g, and moved when `dives` and `gear_presets` turned out to need exactly it.
 */
export async function applyPulledDiveSites(db: Db, rows: readonly PulledSite[]): Promise<string[]> {
  return applyPulledRows(db, diveSites, rows);
}

export async function applyPulledDiveCenters(db: Db, rows: readonly PulledCenter[]): Promise<string[]> {
  return applyPulledRows(db, diveCenters, rows);
}

// ──────────────────────────────────────────────────────────────────────────────────────
// The push set
// ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The sites this device created and has not sent yet (§7.1: "any sites or centers created
 * offline"). Tombstoned rows are not excluded, for the reason `pendingRows` (db/dirty.ts)
 * gives — though nothing on a device tombstones a community row, since §5 gives deletion to
 * nobody at all.
 */
export async function pendingDiveSites(db: Db): Promise<DiveSite[]> {
  return db.select().from(diveSites).where(pendingRows(diveSites));
}

export async function pendingDiveCenters(db: Db): Promise<DiveCenter[]> {
  return db.select().from(diveCenters).where(pendingRows(diveCenters));
}

/** Clears the flag on sites that have gone up — see `clearDirtyFlags` (db/dirty.ts). */
export async function clearDiveSiteDirtyFlags(db: Db, pushed: readonly PushedRow[]): Promise<string[]> {
  return clearDirtyFlags(db, diveSites, pushed);
}

export async function clearDiveCenterDirtyFlags(db: Db, pushed: readonly PushedRow[]): Promise<string[]> {
  return clearDirtyFlags(db, diveCenters, pushed);
}

/** How many sites this device still owes the server — `countPendingRows` (db/dirty.ts). */
export async function countPendingDiveSites(db: Db): Promise<number> {
  return countPendingRows(db, diveSites);
}

export async function countPendingDiveCenters(db: Db): Promise<number> {
  return countPendingRows(db, diveCenters);
}

// ──────────────────────────────────────────────────────────────────────────────────────
// What an account arriving and an account leaving do to this table (§7.4)
// ──────────────────────────────────────────────────────────────────────────────────────

/**
 * §7.4's adoption, for the catalogue — `flagAllRows` (db/dirty.ts) is the rule.
 *
 * Sites and centres are adopted along with everything else and are **not counted**: §7.4's
 * sentence is about dives, and `cloud/localLogbook.ts`'s `adopt` says why the number is
 * deliberately a subset. What is being adopted here is a site the diver created on the boat,
 * which is the only kind of catalogue row a device that has never pulled can hold — see
 * `wipeDiveSites` for why that stays true.
 */
export async function adoptDiveSites(db: Db): Promise<void> {
  await flagAllRows(db, diveSites);
}

export async function adoptDiveCenters(db: Db): Promise<void> {
  await flagAllRows(db, diveCenters);
}

/**
 * §7.4's sign-out erase, for the catalogue — and the least obvious of the four tables it
 * names, so the reason is worth repeating here rather than only in DESIGN.md.
 *
 * "The catalogue tables go too… they arrive by pull, so a guest never had them, and keeping
 * them would leave a site created offline sitting in the next account's dirty set to be pushed
 * as **their** creation." That second half is what makes this a correctness rule rather than a
 * tidy-up: `adoptDiveSites` above flags every row in this table, so a row left behind by one
 * diver is a row the next diver's first push claims authorship of.
 *
 * A hard `delete`, not a tombstone: §6's `deleted_at` exists so a deletion can *propagate*,
 * and nothing about this device forgetting the community catalogue is news for the server. A
 * tombstone here would be this device asking the server to delete everybody's sites.
 *
 * **`EVERY_ROW` is not decoration** — `db/wipe.ts` has the whole of it: without a WHERE, this
 * statement is SQLite's truncate optimisation, which deletes the rows without telling anything
 * on screen that it did.
 */
export async function wipeDiveSites(db: Db): Promise<void> {
  await db.delete(diveSites).where(EVERY_ROW);
}

/** The same erase for centres, and the same `EVERY_ROW` for the same reason (db/wipe.ts). */
export async function wipeDiveCenters(db: Db): Promise<void> {
  await db.delete(diveCenters).where(EVERY_ROW);
}

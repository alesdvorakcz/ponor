import { and, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { newId } from '../domain/ids';
import { ACTIVE_CATALOGUE_STATUS, type DiveCenter, type DiveSite } from '../domain/types';
import { clearDirtyFlags, pendingRows, stampLocalWrite, type PushableTable, type PushedRow } from './dirty';
import { diveCenters, diveSites } from './schema';
import { liveRows } from './tombstone';
import type { Db } from './types';

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
 */

/** A catalogue table: pushable (id, clock, flag) plus the two columns a read filters on. */
type CatalogueTable = PushableTable & {
  readonly status: SQLiteColumn;
  readonly deletedAt: SQLiteColumn;
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
 * Writes rows the server sent, **clean**, and only where they are newer than what is already
 * here.
 *
 * Two rules, both of them §7.2's ("the client upserts by comparing `updated_at`"), and both
 * of them silent when wrong:
 *
 * 1. **Never dirty.** A pulled row that arrived flagged would push itself straight back on
 *    the next sync, ask the server to restamp `updated_at`, and hand the conflict to whichever
 *    device echoed last. The flag is written here, from a type that cannot carry one.
 * 2. **Only if newer.** An older row must not overwrite a newer one — which includes not
 *    overwriting a *locally edited* one with a stale echo of itself, and would silently drop
 *    the diver's edit if it did. The comparison is `excluded.updated_at > <table>.updated_at`,
 *    a plain string comparison in the ISO-Z spelling §7 makes the RPCs return (M2a): the
 *    client's own `toISOString()` shape, so the two sides sort together.
 *
 * **The update set is derived from the table's own columns**, never listed here. §10 records
 * why in M2b's words — "a helper is only a single owner if its output cannot lose a column" —
 * and the failure a hand-written list produces is a column that quietly stops being updated by
 * pulls: it would arrive on first insert, look right, and then never change again.
 *
 * Returns the ids actually written, so a caller can tell what landed rather than assume its
 * own list did. (A very large catalogue should be handed over in batches: §9's web-spike note
 * puts a 1 MiB ceiling on a single synchronous result in the browser.)
 */
async function applyPulled(
  db: Db,
  table: CatalogueTable,
  rows: readonly Record<string, unknown>[],
): Promise<string[]> {
  if (rows.length === 0) return [];

  const columns = getTableColumns(table);
  const fromServer = Object.entries(columns)
    .filter(([key]) => key !== 'id' && key !== 'dirty')
    .map(([key, column]) => [key, sql.raw(`excluded.${column.name}`)] as const);
  const set: Record<string, unknown> = Object.fromEntries(fromServer);
  // Not from `excluded`: the server has no flag to send, and this is the rule — a row that
  // came down is a row that does not have to go up.
  set.dirty = false;

  const written = await db
    .insert(table)
    .values(rows.map((row) => ({ ...row, dirty: false })))
    .onConflictDoUpdate({
      target: table.id,
      set,
      setWhere: sql`excluded.updated_at > ${table.updatedAt}`,
    })
    .returning({ id: table.id });

  return written.flatMap((row) => (typeof row.id === 'string' ? [row.id] : []));
}

export async function applyPulledDiveSites(db: Db, rows: readonly PulledSite[]): Promise<string[]> {
  return applyPulled(db, diveSites, rows);
}

export async function applyPulledDiveCenters(db: Db, rows: readonly PulledCenter[]): Promise<string[]> {
  return applyPulled(db, diveCenters, rows);
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

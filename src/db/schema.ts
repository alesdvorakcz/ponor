import { sql } from 'drizzle-orm';
import { customType, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  ACTIVE_CATALOGUE_STATUS,
  type CatalogueStatus,
  type DiveStatus,
  type Entry,
  type Equipment,
  type Salinity,
  type Suit,
  type Tank,
  type Visibility,
  type WaterBody,
  type Weather,
  type WeightsFeel,
} from '../domain/types';

/**
 * Any JSON **array** column, stored as text: `tanks` on both tables, and `equipment` on a
 * dive.
 *
 * A custom type rather than `text(..., { mode: 'json' })` for one reason —
 * `mode: 'json'` decodes with a bare `JSON.parse`, and that runs inside
 * Drizzle's row mapper, before any repository code sees the value. A single
 * unparseable blob therefore threw out of `listDives` and took the entire dive
 * list down with it, not just its own row (executed: a truncated
 * `[{"sizeL":12` made both `getDive` and `listDives` throw a SyntaxError while
 * the other rows were perfectly healthy).
 *
 * Reachability is low today — every such column is NOT NULL with a `'[]'`
 * default and every write goes through `JSON.stringify` — and it stops being
 * low the moment M2's `pull_changes` starts writing these columns from a
 * network payload. Degrading one bad row to `[]` here fixes every read path at
 * once, including `RETURNING`, because there is no read path that does not go
 * through this decoder.
 *
 * **Generalised over the element type rather than copied per column** (M1h). It was
 * `tanksJson`, and `equipment` needs exactly the same protection for exactly the same
 * reason — so a second decoder would be §4.1's defining defect installed deliberately, and
 * the copy that got it wrong would be the one nobody tested, because "one corrupt row must
 * not take the list down" is not a thing a screen shows. The element type is a *label*
 * either way: `JSON.parse` cannot check it, which is why `db/dives.ts`'s `toDive` re-checks
 * `Array.isArray` on top of this rather than trusting `$type<>`.
 *
 * Emits `text`, exactly as `mode: 'json'` did.
 */
const jsonArray = <T>() =>
  customType<{ data: T[]; driverData: string }>({
    dataType() {
      return 'text';
    },
    toDriver(value: T[]): string {
      return JSON.stringify(value);
    },
    fromDriver(value: string): T[] {
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch {
        // Valid-JSON-of-the-wrong-shape and unparseable-garbage now degrade the
        // same way, which is the point: one corrupt row loses its cylinders,
        // and the logbook still opens.
        return [];
      }
    },
  });

const tanksJson = jsonArray<Tank>();
const equipmentJson = jsonArray<Equipment>();

/**
 * The name of the flag below, for the checks that have to say "this column never leaves the
 * device" without spelling it a second time.
 */
export const DIRTY_COLUMN = 'dirty';

/**
 * **"Rows flagged dirty go up" (DESIGN.md §7.1)** — this is that flag, on every table §7
 * pushes, and it is the one column here that is local by design rather than by accident.
 *
 * *An explicit flag rather than a derived one.* The tempting alternative is
 * `updated_at > last_pushed_at`, and it is wrong for a reason §7.3 already states about a
 * different value: those two timestamps come from different clocks — one the phone's, one
 * the server's — and divers change time zones constantly. A device whose clock is a minute
 * behind the server's would compare a freshly-written row as *already pushed* and never send
 * it again. Nothing raises; the row simply stays on the phone. §7 asks for a flag, and a flag
 * is what this is.
 *
 * *One builder for all four tables, and no `.default()`.* Drizzle makes a column with a
 * default OPTIONAL in an insert, so `.default(...)` here would let a new write path forget
 * the flag and still compile — which is a row that never syncs and never raises. Without one,
 * `dives.$inferInsert` requires it and `db/dives.ts`'s `createDive` does not build without
 * saying what it means. The SQL side carries `default 1` all the same (see the 0001
 * migration): SQLite cannot add a NOT NULL column to an existing table without one, and 1 is
 * the fail-safe direction — a row wrongly dirty costs one redundant push, a row wrongly clean
 * is a diver's data that never leaves the phone.
 *
 * `mode: 'boolean'` is not cosmetic either: it gives the column Drizzle's `SQLiteBoolean`
 * type rather than `SQLiteInteger`, which is what keeps it out of `db/dives.ts`'s
 * `INTEGER_COLUMNS` rounding pass — that file's own docblock predicted this column.
 */
const dirtyFlag = () => integer(DIRTY_COLUMN, { mode: 'boolean' }).notNull();

/**
 * One row per dive. SI units throughout (DESIGN.md §6): metres, bar, °C, kg, litres.
 *
 * Everything is nullable except id, status, date and the timestamps — a diver who
 * surfaces knowing only that they dived today must still be able to save.
 *
 * There is deliberately no dive_number column: numbers are computed from
 * chronology plus the dives_before offset (§2.5), so backfilling renumbers for
 * free with no sync churn. Do not add one.
 */
export const dives = sqliteTable('dives', {
  id: text('id').primaryKey(),
  // Every one of these `$type<>` labels names a domain type rather than spelling the
  // union out again. `suit` always did; `status`, `entry`, `salinity` and `water_body`
  // each carried their own copy, which made `domain/types.ts` the fourth place a closed
  // vocabulary was written down. `Mutual` (db/dives.ts) did catch a divergence, but as a
  // wall of Drizzle overload text about an insert, pointing nowhere near the list that had
  // gone stale — and a compile error nobody can read is one step from a compile error
  // somebody loosens. There is one list per vocabulary now, in domain/types.ts.
  status: text('status').$type<DiveStatus>().notNull().default('logged'),

  date: text('date').notNull(),
  timeIn: text('time_in'),
  /**
   * Hand-set order within a single date, used only when times are missing (§2.5).
   * A tie-break, not a position: it is compared between dives sharing a date and
   * never read on its own.
   */
  manualOrder: integer('manual_order'),
  durationMin: integer('duration_min'),
  title: text('title'),
  notes: text('notes'),
  rating: integer('rating'),

  siteId: text('site_id'),
  siteName: text('site_name'),
  centerId: text('center_id'),
  centerName: text('center_name'),
  entry: text('entry').$type<Entry>(),
  salinity: text('salinity').$type<Salinity>(),
  waterBody: text('water_body').$type<WaterBody>(),
  /**
   * Two columns rather than one, because SQLite has no point type. The Postgres
   * side composes them into a single PostGIS point in M2 — see DESIGN.md §6.
   */
  latitude: real('latitude'),
  longitude: real('longitude'),

  maxDepthM: real('max_depth_m'),
  avgDepthM: real('avg_depth_m'),
  waterTempC: real('water_temp_c'),
  airTempC: real('air_temp_c'),
  /**
   * The judgement and the number, side by side and both nullable — §10 records that this is
   * deliberate rather than a duplicate to be tidied away. `weights_kg`/`weights_feel` below
   * are the same pairing.
   */
  visibility: text('visibility').$type<Visibility>(),
  visibilityM: real('visibility_m'),
  waves: integer('waves'),
  current: integer('current'),
  surge: integer('surge'),
  weather: text('weather').$type<Weather>(),

  /**
   * JSON array of Tank, first entry = main cylinder. See DESIGN.md §6.
   *
   * NOT NULL, unlike almost everything else here, because an empty array
   * already means "no cylinders recorded". A nullable column would be a
   * second encoding of the same fact and would force every reader to handle
   * both — so the default is `'[]'`, never NULL.
   */
  tanks: tanksJson('tanks').notNull().default(sql`'[]'`),

  suit: text('suit').$type<Suit>(),
  /** Millimetres in both unit systems — a 5 mm suit is 5 mm everywhere (format/units.ts). */
  suitThicknessMm: real('suit_thickness_mm'),
  /**
   * The accessory token set (§6, §10) — hood, gloves, boots, torch, camera — replacing the
   * three boolean columns `hood`/`gloves`/`boots`. A set rather than more columns for the
   * reason §6 gives for `tanks`: adding "camera" must not cost a column.
   *
   * NOT NULL with a `'[]'` default, and through the same `jsonArray` decoder `tanks` uses,
   * for both of that column's stated reasons — an empty array already means "nothing
   * recorded", and one corrupt blob must lose its own row's accessories rather than throw
   * the whole dive list down.
   */
  equipment: equipmentJson('equipment').notNull().default(sql`'[]'`),
  weightsKg: real('weights_kg'),
  weightsFeel: text('weights_feel').$type<WeightsFeel>(),
  buddy: text('buddy'),
  guide: text('guide'),

  /** Reserved so a future dive-computer import can dedupe safely (§6). */
  importSource: text('import_source'),
  importId: text('import_id'),

  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  /** Tombstone. Rows are never hard-deleted, so sync can propagate the deletion. */
  deletedAt: text('deleted_at'),
  dirty: dirtyFlag(),
});

/**
 * Named cylinder sets — "twin 12 steel", "alu 80 nitrox" — applied to a dive in one tap
 * (DESIGN.md §2.1).
 *
 * **Cylinders and gas, and nothing else** (§10, owner's call in M1e). The table was
 * specified as "cylinder/gas/suit/weights" and shipped with `suit`, `hood`, `gloves`,
 * `boots` and `weights_kg` columns; a migration dropped all five, and M1h's collapse of the
 * migration history to a single `0000` (§10) means the schema below is now simply the only
 * record that they were ever there. They were the half that
 * did not need it: carry-over already fills every one of them from the previous dive
 * (§2.1), so a preset carrying them too would be a **second, staler source for fields
 * something else already fills correctly** — §4.1's defining defect arriving as a feature.
 * They are dropped rather than left unwritten because a column DESIGN.md no longer
 * describes is exactly the drift this project keeps paying for.
 *
 * **The name stays `gear_presets`.** §6 and §7 both name it that, and M2's `push_changes`
 * will push it by that name, so renaming buys a better word for the cost of a migration
 * plus a sync-protocol edit.
 *
 * `tanks` is the same `tanksJson` above the `dives` table uses, not a second decoder: one
 * corrupt blob must degrade to `[]` here for exactly the reason it must there — see that
 * type's own docblock for the list it once took down.
 *
 * **The pressures are not stored** — `startBar`/`endBar` are stripped on the way in by
 * `withoutPressures` (domain/carryOver.ts), the same rule carry-over applies. Nothing at
 * the schema level can say so, because a JSON blob's interior has no columns; `db/gearPresets.ts`
 * is the one write path, and it is where that is enforced.
 */
export const gearPresets = sqliteTable('gear_presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tanks: tanksJson('tanks').notNull().default(sql`'[]'`),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  dirty: dirtyFlag(),
});

/**
 * The diver's certification wallet — one row per card (DESIGN.md §3, §6).
 *
 * **Column for column the Postgres table** (`supabase/migrations/20260902090100_schema.sql`),
 * with the two differences every private synced table has: `user_id` is the server's alone
 * (§7.4 — a device holds one diver's logbook) and `dirty` is the device's alone (§7.1).
 * `src/db/schemaParity.test.ts` carries both as named exceptions and fails on any other.
 * That table has existed since M2a and `push_changes`/`pull_changes` have carried these rows
 * since M2b; this is the SQLite side they had nowhere to land in, so until M3b a diver could
 * neither enter a card nor receive one.
 *
 * **Every column nullable**, which is §6's rule and not laxity: a diver who remembers only
 * that they are an SSI Open Water diver must be able to say that and nothing else, and a card
 * arriving from another device may legitimately carry any subset.
 *
 * **`agency` is free text, not a vocabulary** (M3b). §6 writes it `PADI·SSI·CMAS·…` and the
 * ellipsis is the whole point — BSAC, NAUI, SDI/TDI, RAID, GUE, IANTD, FFESSM, AIDA,
 * Molchanovs and a long tail besides. `domain/types.ts` owns "every closed vocabulary a form
 * offers as a fixed list" (§4.1), and putting an open list there would make that file assert
 * something untrue; §10's store-and-flag ruling would then make a diver's own correct answer
 * wear a note saying this build does not know it, which that ruling's own last clause rejects
 * for exactly the fields "the diver could have typed himself". So there is no `$type<>` here
 * and no chip row on the editor.
 *
 * **`issuedOn` and `expiresOn` are calendar dates, not timestamps** — `text` on both sides for
 * the reason §6 gives for `dives.date`, and read only through `domain/datetime.ts` (§4.1).
 *
 * Card photos join with v1.1's photos (§6), so there is no path column here yet.
 */
export const certifications = sqliteTable('certifications', {
  id: text('id').primaryKey(),
  agency: text('agency'),
  course: text('course'),
  cardNumber: text('card_number'),
  issuedOn: text('issued_on'),
  expiresOn: text('expires_on'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  dirty: dirtyFlag(),
});

/**
 * The device's copy of the community dive-site catalogue (DESIGN.md §5, §2.3).
 *
 * **§6 said the device kept no catalogue and §5 and §2.3 both require one** — "the compact
 * site/center catalogue syncs to every device, so autocomplete works fully offline", and
 * "typing a site or center searches your own history first, then the on-device copy of the
 * community catalogue — both instant and fully offline". `pull_changes` has returned this
 * catalogue since M2b with nowhere on the device to put it. This is that place, and §6's
 * "Local only" line needs a sentence saying so (reported, not edited, per M2d's brief).
 *
 * **Column for column the Postgres table (`supabase/migrations/20260902090100_schema.sql`),
 * with exactly one difference:** SQLite has no point type, so the server's single PostGIS
 * `location` is the `latitude`/`longitude` pair here — precisely the rule §6 already states
 * for a dive's own GPS point, and precisely what `public.sync_site` puts on the wire in both
 * directions. `src/db/schemaParity.test.ts` carries that difference as a named exception and
 * fails on any other.
 *
 * **`merged_into` carries no foreign key**, for the reason §6 gives for `dives.site_id`: a
 * pull delivers rows in whatever order the server rendered them, so a self-reference to a
 * survivor that has not been written yet would reject the row — and a rejected community row
 * during a pull is a device that never gets the merge it was being told about. The server's
 * own copy keeps its FK, where the whole catalogue is written in one transaction.
 *
 * **`created_by` is here although the device has no `user_id` anywhere** (§7.4). Those are
 * different facts: `user_id` would repeat one value on every row of a one-diver device, where
 * `created_by` names *other* divers and is what §5's "the creator edits its facts, everyone
 * else suggests a correction" is decided by. It arrives with the pulled row and is never
 * written by this device — the server sets it from `auth.uid()` on push.
 */
export const diveSites = sqliteTable('dive_sites', {
  id: text('id').primaryKey(),
  name: text('name'),
  country: text('country'),
  /** The pair, not a point — see this table's docblock and §6. */
  latitude: real('latitude'),
  longitude: real('longitude'),
  salinity: text('salinity').$type<Salinity>(),
  waterBody: text('water_body').$type<WaterBody>(),
  entry: text('entry').$type<Entry>(),
  /** The site's own depth, not a dive's — §6 names it as one of the facts a site prefills. */
  maxDepthM: real('max_depth_m'),
  createdBy: text('created_by'),
  status: text('status').$type<CatalogueStatus>().notNull().default(ACTIVE_CATALOGUE_STATUS),
  mergedInto: text('merged_into'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  dirty: dirtyFlag(),
});

/**
 * The device's copy of the community dive-centre catalogue — the same model as `diveSites`
 * above, and §5 covers "a site or center" in one sentence. See that table's docblock for the
 * point/pair difference, the missing foreign key and `created_by`.
 */
export const diveCenters = sqliteTable('dive_centers', {
  id: text('id').primaryKey(),
  name: text('name'),
  country: text('country'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  website: text('website'),
  createdBy: text('created_by'),
  status: text('status').$type<CatalogueStatus>().notNull().default(ACTIVE_CATALOGUE_STATUS),
  mergedInto: text('merged_into'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  dirty: dirtyFlag(),
});

/** Local-only key/value settings: units, locale, hidden field groups, dives_before. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/**
 * Where §7's pull watermark lives (DESIGN.md §6, "Local only": `sync_state`).
 *
 * **One row with typed columns, not a second key/value table.** `settings` is key/value and
 * §4.1 says of it that "a second key/value path is the defect this table exists to name" —
 * so this is deliberately the other shape. Three reasons it is the right one here. The value
 * is not a diver's preference but protocol state, and mixing the two would put the watermark
 * in reach of anything that clears, exports or resets settings. It has one type and one
 * meaning, so `db/settings.ts`'s whole coercion apparatus — what a stored string is allowed
 * to mean — reduces here to "a non-empty string or nothing". And a misspelled key in a
 * key/value store reads as *never pulled*, which is survivable, while a misspelled key on the
 * WRITE side means a watermark that never advances and a device that re-pulls the world
 * forever; a column cannot be misspelled at runtime.
 *
 * `id` exists only to make the single row addressable, and `db/syncState.ts` is the one
 * writer that knows its value — see that module for what a missing or unreadable row must
 * degrade to, which is the same question `db/settings.ts` answers for its own table.
 */
export const syncState = sqliteTable('sync_state', {
  id: text('id').primaryKey(),
  /**
   * **The server's timestamp, never this phone's** (§7.3): the watermark `pull_changes`
   * returned, stored exactly as it was received and handed back to the next pull unread.
   * Nothing here parses it, compares it to a local clock, or invents one.
   */
  lastPulledAt: text('last_pulled_at'),
});

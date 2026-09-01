import { sql } from 'drizzle-orm';
import { customType, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  DiveStatus,
  Entry,
  Equipment,
  Salinity,
  Suit,
  Tank,
  Visibility,
  WaterBody,
  Weather,
  WeightsFeel,
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
});

/** Local-only key/value settings: units, locale, hidden field groups, dives_before. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

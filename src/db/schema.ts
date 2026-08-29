import { sql } from 'drizzle-orm';
import { customType, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Suit, Tank } from '../domain/types';

/**
 * The `tanks` column: a JSON array of Tank, stored as text.
 *
 * A custom type rather than `text(..., { mode: 'json' })` for one reason —
 * `mode: 'json'` decodes with a bare `JSON.parse`, and that runs inside
 * Drizzle's row mapper, before any repository code sees the value. A single
 * unparseable blob therefore threw out of `listDives` and took the entire dive
 * list down with it, not just its own row (executed: a truncated
 * `[{"sizeL":12` made both `getDive` and `listDives` throw a SyntaxError while
 * the other rows were perfectly healthy).
 *
 * Reachability is low today — the column is NOT NULL with a `'[]'` default and
 * every write goes through `JSON.stringify` — and it stops being low the
 * moment M2's `pull_changes` starts writing this column from a network
 * payload. Degrading one bad row to `[]` here fixes every read path at once,
 * including `RETURNING`, because there is no read path that does not go
 * through this decoder.
 *
 * Emits `text`, exactly as `mode: 'json'` did, so the migration and the
 * drizzle-kit snapshot are unchanged.
 */
const tanksJson = customType<{ data: Tank[]; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value: Tank[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): Tank[] {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Tank[]) : [];
    } catch {
      // Valid-JSON-of-the-wrong-shape and unparseable-garbage now degrade the
      // same way, which is the point: one corrupt row loses its cylinders,
      // and the logbook still opens.
      return [];
    }
  },
});

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
  status: text('status').$type<'logged' | 'planned'>().notNull().default('logged'),

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
  entry: text('entry').$type<'shore' | 'boat' | 'other'>(),
  salinity: text('salinity').$type<'salt' | 'fresh' | 'brackish'>(),
  waterBody: text('water_body').$type<'ocean' | 'lake' | 'river' | 'quarry' | 'cave' | 'pool'>(),
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
  visibilityM: real('visibility_m'),
  waves: integer('waves'),
  current: integer('current'),
  surge: integer('surge'),

  /** JSON array of Tank, first entry = main cylinder. See DESIGN.md §6. */
  tanks: tanksJson('tanks').notNull().default(sql`'[]'`),

  suit: text('suit').$type<Suit>(),
  hood: integer('hood', { mode: 'boolean' }),
  gloves: integer('gloves', { mode: 'boolean' }),
  boots: integer('boots', { mode: 'boolean' }),
  weightsKg: real('weights_kg'),
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

/** Named equipment sets — "cold water", "tropical" — applied to a dive in one tap (§2.1). */
export const gearPresets = sqliteTable('gear_presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tanks: tanksJson('tanks').notNull().default(sql`'[]'`),
  suit: text('suit').$type<Suit>(),
  hood: integer('hood', { mode: 'boolean' }),
  gloves: integer('gloves', { mode: 'boolean' }),
  boots: integer('boots', { mode: 'boolean' }),
  weightsKg: real('weights_kg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

/** Local-only key/value settings: units, locale, hidden field groups, dives_before. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

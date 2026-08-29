import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Suit, Tank } from '../domain/types';

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
   * DESIGN.md §6 calls this one `location` (a PostGIS point on the server). SQLite
   * has no point type, so it is two columns here; the Postgres side composes them
   * into a point in M2. Update §6 to say so rather than letting the two drift.
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
  tanks: text('tanks', { mode: 'json' }).$type<Tank[]>().notNull().default(sql`'[]'`),

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
  tanks: text('tanks', { mode: 'json' }).$type<Tank[]>().notNull().default(sql`'[]'`),
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

import { type Dive } from './types';

let seq = 0;

/**
 * A `Dive` with only the fields a test cares about, for tests that have no
 * database. Every other field is `null`, which is both the schema's default
 * and the case most likely to break a component (§6: everything except `date`
 * is nullable).
 *
 * Ids come from a counter, never from the fields, so two fixtures built with
 * identical arguments are still distinct. That matters more than it looks:
 * `assignDiveNumbers` deliberately SKIPS a repeated id (a duplicate would
 * otherwise consume a dive number and shift every later dive), so a fixture
 * that derived its id from the arguments would make `dive({ date: d })` twice
 * silently yield one numbered dive — a test failure with no obvious cause.
 *
 * Ids sort in creation order, matching UUIDv7's ordering property, so the
 * last tier of `compareDiveOrder` behaves here as it does in the app.
 */
export const dive = (over: Partial<Dive> = {}): Dive =>
  ({
    id: `fixture-${String(seq++).padStart(6, '0')}`,
    status: 'logged',
    date: '2026-08-16',
    timeIn: null, manualOrder: null, durationMin: null, title: null, notes: null,
    rating: null, siteId: null, siteName: null, centerId: null, centerName: null,
    entry: null, salinity: null, waterBody: null, latitude: null, longitude: null,
    maxDepthM: null, avgDepthM: null, waterTempC: null, airTempC: null,
    visibilityM: null, waves: null, current: null, surge: null, tanks: [],
    suit: null, hood: null, gloves: null, boots: null, weightsKg: null,
    buddy: null, guide: null, importSource: null, importId: null,
    createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
    deletedAt: null,
    ...over,
  }) as Dive;

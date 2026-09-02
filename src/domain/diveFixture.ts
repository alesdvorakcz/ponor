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
export const dive = (over: Partial<Dive> = {}): Dive => {
  // `base` is annotated as `Dive`, not cast — that's what makes a field
  // missing from this literal a compile error (TS2741/TS2322) rather than a
  // silently incomplete fixture. Only the merge below, whose `...over` spread
  // widens overridden keys to include `undefined`, needs the cast.
  const base: Dive = {
    id: `fixture-${String(seq++).padStart(6, '0')}`,
    status: 'logged',
    date: '2026-08-16',
    timeIn: null, manualOrder: null, durationMin: null, title: null, notes: null,
    rating: null, siteId: null, siteName: null, centerId: null, centerName: null,
    entry: null, salinity: null, waterBody: null, latitude: null, longitude: null,
    maxDepthM: null, avgDepthM: null, waterTempC: null, airTempC: null,
    visibility: null, visibilityM: null, waves: null, current: null, surge: null,
    weather: null, tanks: [],
    suit: null, suitThicknessMm: null, equipment: [], weightsKg: null, weightsFeel: null,
    buddy: null, guide: null, importSource: null, importId: null,
    createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
    deletedAt: null,
    // A fixture dive has never been written by the repository, so it has never been flagged
    // (§7.1). `false` is also the value that makes an accidental assertion about the flag
    // fail here rather than pass by accident — a real created dive is dirty.
    dirty: false,
  };
  return { ...base, ...over } as Dive;
};

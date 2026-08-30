import { calendarDateToUtcMs } from './datetime';
import { diveFormSchema, type DiveFormValues } from './diveFormSchema';
import type { Dive, Tank } from './types';

/**
 * DESIGN.md §2.1, "Carried over from the last dive": the gear and location a
 * diver reuses trip to trip — dive center and site · entry · salinity and
 * water body · cylinders (material, size, count, working pressure) · gas
 * mixture per cylinder (O₂/He %) · weights · suit, hood, gloves, boots ·
 * buddy and guide.
 *
 * `tanks` is named here, but carries only *most* of itself: `carryOverFrom`
 * still zeroes each cylinder's `startBar`/`endBar` (see `carryOverTank`).
 * §2.1 puts pressures in the "fresh every dive" half explicitly, and the
 * decision log (§10) records it as a deliberate owner call: a stale 200 bar
 * would silently become a wrong gas-consumption figure for the next dive.
 *
 * This is the *only* hand-maintained field list in this module. Every other
 * `DiveFormValues` field — `date` aside, which has its own 48h rule, below —
 * is fresh, derived as "whatever this array does not name" (`FRESH_FIELDS`
 * below) rather than written out a second time. A field added to the form
 * later is therefore fresh the moment it exists, which is the safe default
 * on the same reasoning as pressure, rather than silently absent from both
 * lists until someone notices — the "hand-maintained second list" defect
 * this codebase has hit more than once.
 */
export const CARRIED_FIELDS: readonly (keyof DiveFormValues)[] = [
  'siteId', 'siteName',
  'centerId', 'centerName',
  'entry', 'salinity', 'waterBody',
  'tanks',
  'suit', 'hood', 'gloves', 'boots', 'weightsKg',
  'buddy', 'guide',
];

const CARRIED_FIELD_SET: ReadonlySet<string> = new Set(CARRIED_FIELDS);

/**
 * Every `DiveFormValues` key `CARRIED_FIELDS` does not name, other than
 * `date`. Read straight off `diveFormSchema`'s own shape rather than typed
 * out here a second time, so this can never quietly fall out of step with
 * either the schema or `CARRIED_FIELDS` — there is nothing left to forget to
 * update. `Object.keys` always returns `string[]`; the cast is safe because
 * every key it can possibly produce here is one `diveFormSchema` itself
 * declared.
 */
const FRESH_FIELDS: readonly (keyof DiveFormValues)[] = (
  Object.keys(diveFormSchema.shape) as (keyof DiveFormValues)[]
).filter((field) => field !== 'date' && !CARRIED_FIELD_SET.has(field));

const HOURS_48_MS = 48 * 60 * 60 * 1000;

/**
 * One cylinder carried from the previous dive: the hardware and the gas in
 * it, never what was left in it. See `CARRIED_FIELDS`'s docblock for why the
 * pressures specifically must not survive the copy.
 */
function carryOverTank(tank: Tank): Tank {
  return { ...tank, startBar: null, endBar: null };
}

/**
 * §2.1: "the date stays on the previous dive's date when it is less than
 * 48 h old, otherwise today." Both sides of that comparison are computed in
 * UTC — `calendarDateToUtcMs` for the previous dive's date, `toISOString`
 * (always UTC, by spec) for today's — never a local-time `Date` getter.
 * `new Date('2026-01-01')` parses as UTC midnight but *renders* as
 * 31 Dec 2025 through `getDate()` west of Greenwich, and that exact class of
 * bug has already been caught twice in this codebase (see `datetime.ts`'s
 * own docblock). `datetime.ts` owns what a date string means; this function
 * only calls it, never reimplements it.
 *
 * A previous date `calendarDateToUtcMs` cannot parse — not just malformed
 * text but a rolled-forward impossible date like '2026-02-30', which
 * `Date.parse` would silently accept two days late — cannot be proven "less
 * than 48h old", so this falls back to today rather than trusting a value it
 * cannot read. Same refuse-rather-than-guess rule `surfaceIntervalMin`
 * applies in `derived.ts`.
 */
function carryOverDate(previousDate: string, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const previousMs = calendarDateToUtcMs(previousDate);
  if (previousMs === null) return today;
  return now.getTime() - previousMs < HOURS_48_MS ? previousDate : today;
}

/**
 * The dive-form prefill for DESIGN.md §2.1's carry-over: what a diver
 * starting a new log entry inherits from their last dive, and what starts
 * blank because it changes every dive. `previous` is ordinarily the diver's
 * most recent dive by chronological order (§2.5), but this function only
 * ever reads it — it has no opinion on which dive that is.
 *
 * Returns `{}` — no keys at all, not a wall of nulls — when there is no
 * previous dive, so a first-ever entry does not overwrite whatever default
 * the form already holds for every field.
 *
 * `now` takes a default so the 48h rule is testable without mocking the
 * system clock; it is the only thing here that reads the clock at all.
 */
export function carryOverFrom(previous: Dive | null, now: Date = new Date()): Partial<DiveFormValues> {
  if (previous === null) return {};

  const result: Partial<DiveFormValues> = { date: carryOverDate(previous.date, now) };

  for (const field of FRESH_FIELDS) {
    (result as Record<string, unknown>)[field] = null;
  }
  for (const field of CARRIED_FIELDS) {
    (result as Record<string, unknown>)[field] =
      field === 'tanks' ? previous.tanks.map(carryOverTank) : (previous as unknown as Record<string, unknown>)[field];
  }

  return result;
}

import { calendarDateToUtcMs, todayCalendarDate } from './datetime';
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
 * The two form fields this module carries neither forward nor blank, because
 * "fresh" here means **`null`** and neither of them can hold one: `date` and
 * `status` are two of the three columns DESIGN.md §6 makes non-nullable, so
 * each owns a rule of its own instead. `date`'s is the 48-hour rule below;
 * `status`'s belongs to the form, which opens every new entry on `logged`
 * (`blankFormValues`, DiveFormScreen.tsx) and lets the diver say otherwise
 * with §2.4's control.
 *
 * That is a decision, not an omission. A planned dive is the exception, not a
 * mode: a diver who queues up one dive on a boat does not want every later
 * entry defaulting to planned, and inheriting the last dive's status is
 * exactly how that would happen. Naming them here — rather than letting
 * `FRESH_FIELDS` blank them — is also what keeps `carryOverFrom`'s result
 * parseable by `diveFormSchema`, since a `status: null` would be a value the
 * form's own default then has to guess its way back out of.
 */
const NOT_CARRIED_OR_BLANKED: ReadonlySet<string> = new Set(['date', 'status']);

/**
 * Every `DiveFormValues` key `CARRIED_FIELDS` does not name, other than the
 * two above. Read straight off `diveFormSchema`'s own shape rather than typed
 * out here a second time, so this can never quietly fall out of step with
 * either the schema or `CARRIED_FIELDS` — there is nothing left to forget to
 * update. `Object.keys` always returns `string[]`; the cast is safe because
 * every key it can possibly produce here is one `diveFormSchema` itself
 * declared.
 */
const FRESH_FIELDS: readonly (keyof DiveFormValues)[] = (
  Object.keys(diveFormSchema.shape) as (keyof DiveFormValues)[]
).filter((field) => !NOT_CARRIED_OR_BLANKED.has(field) && !CARRIED_FIELD_SET.has(field));

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
 * 48 h old, otherwise today." Those are two different questions about time
 * and they get two different answers, both from `datetime.ts`:
 *
 * - **How long ago was the previous dive** is elapsed hours, so both sides of
 *   the comparison are UTC (`calendarDateToUtcMs`, and `now`'s own epoch
 *   time). A fixed zone counts elapsed time correctly and the device's does
 *   not, since divers change zones constantly (DESIGN.md §7).
 * - **What is today** is a question about the calendar the diver is looking
 *   at, so it comes from `todayCalendarDate`, which reads local components.
 *   This line used to be `now.toISOString().slice(0, 10)` — the UTC day —
 *   which handed a diver in Prague logging a night dive at 00:30 the
 *   *previous* day's date. That spelling is right for an `updated_at`
 *   timestamp and wrong for a calendar day, and DESIGN.md §10 records the
 *   trap; `datetime.ts` owns the conversion and this function only calls it.
 *
 * A previous date `calendarDateToUtcMs` cannot parse — not just malformed
 * text but a rolled-forward impossible date like '2026-02-30', which
 * `Date.parse` would silently accept two days late — cannot be proven "less
 * than 48h old", so this falls back to today rather than trusting a value it
 * cannot read. Same refuse-rather-than-guess rule `surfaceIntervalMin`
 * applies in `derived.ts`.
 */
function carryOverDate(previousDate: string, now: Date): string {
  const today = todayCalendarDate(now);
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

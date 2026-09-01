import { calendarDateToUtcMs, todayCalendarDate } from './datetime';
import { diveFormSchema, type DiveFormValues } from './diveFormSchema';
import type { Dive, Tank } from './types';

/**
 * DESIGN.md §2.1, "Carried over from the last dive": the gear and location a
 * diver reuses trip to trip — dive center and site · entry · salinity and
 * water body · cylinders (material, configuration, size, working pressure) ·
 * gas mixture per cylinder (O₂/He %) · weights · suit and its thickness ·
 * the equipment set · buddy and guide.
 *
 * `tanks` is named here, but carries only *most* of itself: `carryOverFrom`
 * still zeroes each cylinder's `startBar`/`endBar` (see `withoutPressures`).
 * §2.1 puts pressures in the "fresh every dive" half explicitly, and the
 * decision log (§10) records it as a deliberate owner call: a stale 200 bar
 * would silently become a wrong gas-consumption figure for the next dive.
 *
 * **M1h's five new fields split three-to-two across this line, and the split is the
 * point.** `suitThicknessMm` and `equipment` are gear: the diver who owned a 5 mm suit and
 * a torch yesterday owns them today, and `equipment` replaces `hood`/`gloves`/`boots`,
 * which were carried for exactly that reason. `weather`, `visibility` and `weightsFeel` are
 * **fresh**, and are not named here — they describe one dive's conditions and one dive's
 * outcome, so a carried one is the same lie §2.1 already names for a stale starting
 * pressure: a value that looks like data and is not. A weighting that felt right in a
 * 7 mm suit in fresh water is the single most misleading thing this form could offer to
 * prefill.
 *
 * This is the *only* hand-maintained field list in this module. Every other
 * `DiveFormValues` field — `date` aside, which has `carryOverDate`'s own
 * rule below — is fresh, derived as "whatever this array does not name" (`FRESH_FIELDS`
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
  'suit', 'suitThicknessMm', 'equipment', 'weightsKg',
  'buddy', 'guide',
];

const CARRIED_FIELD_SET: ReadonlySet<string> = new Set(CARRIED_FIELDS);

/**
 * The two form fields this module carries neither forward nor blank, because
 * "fresh" here means **`null`** and neither of them can hold one: `date` and
 * `status` are two of the three columns DESIGN.md §6 makes non-nullable, so
 * each owns a rule of its own instead. `date`'s is `carryOverDate` below;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The two cylinder fields that describe **what was left in the cylinder**, as opposed to
 * what the cylinder is. Named as a list rather than written into `withoutPressures` below,
 * because two other places need to know exactly which fields that rule touches: the dive
 * form preserves a pressure the diver has already typed when a preset is applied over it,
 * and it leaves those same two fields out of the §0.6 carried marks it drops on the way
 * (DiveFormScreen.tsx). Three copies of "startBar and endBar" would be three chances to
 * disagree about which fields a preset has no opinion on.
 */
export const TANK_PRESSURE_FIELDS = ['startBar', 'endBar'] as const satisfies readonly (keyof Tank)[];

/**
 * One cylinder without its pressures: the hardware and the gas in it, never what was left
 * in it. See `CARRIED_FIELDS`'s docblock for why the pressures specifically must not
 * survive the copy — a stale 200 bar is a wrong gas-consumption figure for the next dive,
 * and §2.1 puts both pressures in the "fresh every dive" half explicitly.
 *
 * **Two mechanisms need it, and it lives here because both are §2.1's.** Carry-over is the
 * first, and this function was private to it (as `carryOverTank`). Cylinder presets are the
 * second: DESIGN.md §10 settles that a preset stores no pressures "on precisely §2.1's
 * reasoning for carry-over: a preset that filled in 200 bar would be inventing a reading.
 * One rule strips them, shared with carry-over's own — not a second copy." So
 * `db/gearPresets.ts` imports this rather than writing the same two nulls again, which is
 * §4.1's "a second implementation is a defect, not a style preference" applied to the one
 * rule this milestone was most likely to duplicate.
 *
 * Named for the rule rather than for either caller, which is what makes it readable in
 * both: a preset repository calling something named `carryOverTank` would read as a
 * mechanism borrowing another mechanism's helper, rather than as two mechanisms sharing
 * one rule.
 */
export function withoutPressures(tank: Tank): Tank {
  const next = { ...tank };
  for (const field of TANK_PRESSURE_FIELDS) next[field] = null;
  return next;
}

/**
 * §2.1: "the date stays on the previous dive's date when it is less than
 * 48 h old, otherwise today."
 *
 * **This implements that window as "the previous dive was today or
 * yesterday", and the whole comparison happens between two calendar dates.**
 * That is a deliberate reading of §2.1, not a paraphrase of it, so it is
 * worth saying why it is the only one available. A dive stores a *calendar
 * date*, not an instant — `timeIn` is optional and most dives have none — so
 * "48 h old" has to be measured from somewhere, and the only anchor a date
 * offers is its own midnight where the diver was. Measured from there the two
 * readings are the same rule written twice: the previous dive is under 24 h
 * old if it is today, under 48 h if it is yesterday, and 48 h or more the
 * moment it is the day before that. Stating it in days is what makes it
 * exact — a calendar day is 23 or 25 hours across a DST transition, where an
 * hours-based window would carry or drop a date purely because the clocks
 * changed.
 *
 * **Both sides are one frame now**, which is the defect this replaced. The
 * comparison used to be `now.getTime() - calendarDateToUtcMs(previousDate)`:
 * a real instant on one side and UTC midnight of a calendar date on the
 * other, which measures 48 h from local midnight *plus the device's UTC
 * offset*. In Manila (UTC+8) a diver tapping `+` on Wednesday the 19th at
 * 07:00, after a dive on Monday the 17th, got 47 h — so the form opened on
 * the **17th**, two days stale, while `todayCalendarDate` in this same
 * function was correctly reporting the 19th. Two date rules in one function,
 * disagreeing.
 *
 * `todayCalendarDate` reads the device's LOCAL components (its own docblock
 * gives the history: `now.toISOString().slice(0, 10)` is the UTC day, and it
 * handed a diver in Prague logging a night dive at 00:30 the *previous* day's
 * date). `calendarDateToUtcMs` then puts both dates on one fixed frame purely
 * to subtract them — it is not asking what time it is anywhere, only how many
 * midnights apart two calendar dates are, which is a job any fixed zone does
 * exactly and a shifting one does not.
 *
 * A previous date the parser refuses — not just malformed text but a
 * rolled-forward impossible date like '2026-02-30', which `Date.parse` would
 * silently accept two days late — cannot be placed in the window at all, so
 * this falls back to today rather than trusting a value it cannot read. Same
 * refuse-rather-than-guess rule `surfaceIntervalMin` applies in `derived.ts`.
 *
 * **The window has two ends, and the near one is today.** A previous date
 * *ahead* of today does not carry: it falls back to today like any date
 * outside the window. This is the second defect this function has had, and it
 * only became reachable when §2.4's Logged/Planned control shipped and divers
 * could finally create a planned dive — completing one planned for 5 Sep made
 * every new dive after it open on 5 Sep while the real date was 31 Aug, and it
 * stayed 5 Sep however many days passed, because a future date's difference is
 * *negative* and every negative number is `<= DAY_MS`. One-sided, the test
 * really is "the previous dive is not more than 48 h old", which a dive that
 * has not happened yet passes trivially — for ever.
 *
 * §2.1's rule is not a staleness test, though; it is "your last dive was
 * recent, so you are probably still on the same trip", and a dive in the
 * future is not recent. So the window is stated as what it means — the
 * previous dive was **today or yesterday** — and a date on either side of that
 * pair gets today. A future date is exactly the case where deferring to the
 * stored value is worst: it is either a plan for a trip that has not started
 * or a typo, and both are dates the diver is demonstrably not diving on now.
 *
 * Note this is the one branch where carry-over and the date part company: the
 * gear, site and centre of a dive dated tomorrow still carry (that is
 * `carryOverFrom`'s business, and they are as likely to be right as any
 * other), while the date does not. §2.1 gives the date its own rule precisely
 * so it can differ.
 */
function carryOverDate(previousDate: string, now: Date): string {
  const today = todayCalendarDate(now);
  const previousMs = calendarDateToUtcMs(previousDate);
  const todayMs = calendarDateToUtcMs(today);
  if (previousMs === null || todayMs === null) return today;
  const behindByMs = todayMs - previousMs;
  return behindByMs >= 0 && behindByMs <= DAY_MS ? previousDate : today;
}

/**
 * One carried field's value, read off the previous dive.
 *
 * **The two array fields are copied rather than referenced, and that is not tidiness.** A
 * carried value becomes the live form's own state, and handing it the very array object the
 * previous dive is holding would let an edit to this dive's cylinders or accessories reach
 * back and alter the dive it was carried from — a dive already saved, which nothing on
 * screen says is being touched. `tanks` was always copied, because
 * `withoutPressures` had to build new cylinders anyway; `equipment` needs the copy stated
 * out loud, since a bare read would have aliased it silently and looked identical.
 *
 * Everything else a dive carries is a string, a number or `null`, none of which anything can
 * mutate, so a plain read is a copy already.
 */
function carriedValue(previous: Dive, field: keyof DiveFormValues): unknown {
  if (field === 'tanks') return previous.tanks.map(withoutPressures);
  if (field === 'equipment') return [...previous.equipment];
  return (previous as unknown as Record<string, unknown>)[field];
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
 * `now` takes a default so `carryOverDate`'s window is testable without mocking the
 * system clock; it is the only thing here that reads the clock at all.
 */
export function carryOverFrom(previous: Dive | null, now: Date = new Date()): Partial<DiveFormValues> {
  if (previous === null) return {};

  const result: Partial<DiveFormValues> = { date: carryOverDate(previous.date, now) };

  for (const field of FRESH_FIELDS) {
    (result as Record<string, unknown>)[field] = null;
  }
  for (const field of CARRIED_FIELDS) {
    (result as Record<string, unknown>)[field] = carriedValue(previous, field);
  }

  return result;
}

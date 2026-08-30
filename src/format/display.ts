import { timeOut } from '../domain/derived';
import { isCalendarDate } from '../domain/datetime';
import { type DiveStatus, type Entry, type Salinity, type Suit, type WaterBody } from '../domain/types';

/**
 * The SI-to-diver-facing conversion boundary (DESIGN.md §6: "SI units
 * stored, converted at display"). M1b ships metric only — the unit
 * *setting* (m/ft, bar/psi, °C/°F, kg/lb) arrives in M1c and will live
 * here — so that adding it later touches this module instead of every
 * screen that currently would have formatted a raw number itself.
 *
 * Every formatter returns null for a field that was never recorded (null)
 * or cannot be a real reading (NaN, ±Infinity — e.g. a value that reached
 * the database from an older or buggy client). §1's "only the fields you
 * use" / no-form-shaming stance applies to reading as much as to writing:
 * a caller gets null so it can omit the element entirely, never a
 * placeholder like "— m" and never the literal string "NaN m".
 */

/**
 * Same finiteness guard every numeric formatter below uses. `typeof value
 * === 'number'` is what lets this double as a type predicate; the
 * behaviour that actually matters is Number.isFinite, which — unlike a
 * bare typeof check — also rejects NaN (typeof NaN === 'number' is true)
 * and ±Infinity.
 */
function isFiniteNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Depth to one decimal place, e.g. "32.4 m" — the precision a gauge reads to. */
export function formatDepth(metres: number | null): string | null {
  if (!isFiniteNumber(metres)) return null;
  return `${metres.toFixed(1)} m`;
}

/** Duration to the whole minute, e.g. "72 min" — how divers log it, never h:mm. */
export function formatDuration(minutes: number | null): string | null {
  if (!isFiniteNumber(minutes)) return null;
  return `${Math.round(minutes)} min`;
}

/** Temperature to the whole degree, e.g. "-1 °C" — sign kept for sub-zero water. */
export function formatTemperature(celsius: number | null): string | null {
  if (!isFiniteNumber(celsius)) return null;
  return `${Math.round(celsius)} °C`;
}

/** Cylinder pressure to the whole bar, e.g. "208 bar". */
export function formatPressure(bar: number | null): string | null {
  if (!isFiniteNumber(bar)) return null;
  return `${Math.round(bar)} bar`;
}

const MONTH_NAMES: readonly string[] = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * A dive's `date` for display, e.g. "16 Aug 2026".
 *
 * Deliberately never hands the stored string to `new Date()`. A bare
 * `new Date('2026-01-01')` parses as UTC midnight, and in any timezone
 * west of Greenwich `toLocaleDateString` on that value renders 31 Dec
 * 2025 — a real dive silently moved to the wrong year on screen. This
 * instead reads the year, month, and day back out of the string itself,
 * which sidesteps the problem entirely rather than working around it:
 * there is no Date object built from the stored value, so there is
 * nothing for a timezone (or locale/ICU support on-device) to shift.
 *
 * `date` is required on every dive (DESIGN.md §6) and the write boundary
 * in db/dives.ts canonicalises it before it is ever stored, but this is
 * the display boundary, not that one — it does not get to assume the
 * value in front of it is clean (a hand-edited row, a future migration).
 * isCalendarDate, datetime.ts's single owner of what a valid date string
 * looks like, is what actually decides that; an uninterpretable value is
 * handed back unchanged rather than an invented date, the same
 * never-block-never-invent stance datetime.ts itself takes at the write
 * boundary.
 */
export function formatDiveDate(date: string): string {
  if (!isCalendarDate(date)) return date;
  const [yearStr, monthStr, dayStr] = date.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const monthName = Number.isInteger(month) ? MONTH_NAMES[month - 1] : undefined;
  // isCalendarDate has already proven `date` names a real calendar date in
  // canonical YYYY-MM-DD form, so this split always yields three integers
  // and month is always 1-12 in practice. The guard below doesn't lean on
  // that holding after some future edit to either function — same
  // reasoning datetime.ts itself gives for re-checking Number.isInteger
  // after a regex that already looks like it guarantees it.
  if (!Number.isInteger(year) || !Number.isInteger(day) || monthName === undefined) return date;
  return `${day} ${monthName} ${year}`;
}

/**
 * Entry time and computed exit, e.g. "09:30 – 10:14" (en dash). Delegates
 * the exit-time arithmetic to derived.ts's timeOut rather than
 * recomputing it — see that module for why a duration of a day or more
 * refuses instead of wrapping into a plausible-looking clock time.
 */
export function formatTimeRange(timeIn: string | null, durationMin: number | null): string | null {
  if (timeIn === null) return null;
  const exit = timeOut(timeIn, durationMin);
  return exit === null ? timeIn : `${timeIn} – ${exit}`;
}

/**
 * Categorical fields — entry, salinity, water body, suit — are stored as the closed
 * lowercase vocabulary `domain/types.ts` declares (`Entry`, `Salinity`, `WaterBody`,
 * `Suit`): the database's vocabulary, not the diver's. This module is the one other place
 * a stored value becomes a displayed string in this app, so that's where these live too,
 * rather than each screen capitalising inline.
 *
 * Every member of those four unions is a single lowercase word, so one shared
 * capitalise-first-letter helper covers all of them — no per-value table that could fall
 * out of sync as a union grows a new member; a new value just capitalises like the rest.
 * English-only, like every other string this file returns: the app has no i18n framework
 * yet (a later milestone), so this is not a translation boundary.
 */
function capitalize<T extends string>(value: T): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** How the diver entered the water, e.g. "Shore". */
export function formatEntry(entry: Entry | null): string | null {
  return entry === null ? null : capitalize(entry);
}

/** The water's salinity, e.g. "Brackish". */
export function formatSalinity(salinity: Salinity | null): string | null {
  return salinity === null ? null : capitalize(salinity);
}

/** The kind of water body, e.g. "Quarry". */
export function formatWaterBody(waterBody: WaterBody | null): string | null {
  return waterBody === null ? null : capitalize(waterBody);
}

/** The exposure suit worn, e.g. "Semidry". */
export function formatSuit(suit: Suit | null): string | null {
  return suit === null ? null : capitalize(suit);
}

/**
 * A dive's status, "Logged" or "Planned". Unlike the four formatters above, `status` is
 * never null (domain/types.ts: the one exception alongside `id` and `date`), so this takes
 * and returns a plain string rather than threading a null case that can't occur.
 */
export function formatDiveStatus(status: DiveStatus): string {
  return capitalize(status);
}

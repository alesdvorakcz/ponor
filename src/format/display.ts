import { timeOut } from '../domain/derived';
import { isCalendarDate } from '../domain/datetime';
import { type Dive, type DiveStatus, type Entry, type Salinity, type Suit, type WaterBody } from '../domain/types';

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

/**
 * Depth split into its numeral and unit, e.g. `{ value: '32.4', unit: 'm' }`.
 *
 * M1c task 1 review, Important: `DepthValue` needs the unit styled more quietly than the
 * number, and used to get there by taking `formatDepth`'s string and splitting it on the
 * space it happened to always contain — a parse with no fallback, so a future formatDepth
 * change (this file's own top docblock names the m/ft unit setting arriving "in M1c" —
 * this exact function, this same milestone) could silently turn a missing unit into the
 * literal text "undefined" on screen. This is the structured form instead: a caller that
 * wants the two pieces separately takes them from here, never by re-parsing a formatted
 * string. `formatDepth` below is now defined in terms of this, not the other way round, so
 * there remains exactly one place — this one — that decides a depth's numeral and unit;
 * whatever formatDepth ends up being ("32.4 m", "106.3 ft", ...) is only ever this value
 * and this unit joined with a space.
 *
 * M1c closing fixes, Important #3: also refuses a negative depth, which `isFiniteNumber`
 * alone does not catch (unlike temperature, a depth cannot physically be below the
 * surface). This function used to disagree here with `depthColorOrNull` (theme/depth.ts),
 * which already rejected negative — two independently-coded answers to "can this depth be
 * shown?" that only visibly differed on this one input: a screen gating on
 * `formatDepth(...) !== null` (DiveDetailScreen.tsx, DiveRow.tsx's accessibility label)
 * said yes, while `DepthValue` — which renders from `depthColorOrNull` — said no, so a
 * negative max depth drew a dangling "Max depth" label with nothing beside it, and an
 * accessibility label naming a depth the screen never actually drew. `depthColorOrNull` now
 * defers its own finiteness/sign check to this function instead of re-deriving it, so there
 * is exactly one owner of "is this depth displayable" and a future edit here can't quietly
 * desync the two again. This matters beyond that one screen: M1d's form is what will
 * actually produce out-of-range numeric input, and negative is the third case after NaN
 * and 0.
 */
export function formatDepthParts(metres: number | null): { value: string; unit: string } | null {
  if (!isFiniteNumber(metres) || metres < 0) return null;
  return { value: metres.toFixed(1), unit: 'm' };
}

/** Depth to one decimal place, e.g. "32.4 m" — the precision a gauge reads to. */
export function formatDepth(metres: number | null): string | null {
  const parts = formatDepthParts(metres);
  return parts === null ? null : `${parts.value} ${parts.unit}`;
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

/**
 * Review task 7, Important #1: the formatters below close the gap that let
 * `DiveDetailScreen.tsx` build seven fields' worth of unit-suffixed strings
 * itself, inline, bypassing every guard above — and rendering the literal
 * string "NaN" for exactly the input DESIGN.md §10's COERCION CONTRACT
 * requires M1d's form to produce (an empty numeric field reaching the domain
 * as `NaN`, never `0`). Each one is the same `isFiniteNumber` guard the
 * formatters above already use, so a `NaN`, `Infinity`, or wrong-typed value
 * disappears the same way an absent one does, rather than reaching the
 * screen as text. None of these round or clamp beyond what the screen was
 * already doing — this closes WHERE the string is built, not what precision
 * it's built at; that is a separate decision for whoever adds the M1c/M3
 * unit-conversion setting this module's own top docblock already earmarks
 * this file for.
 */

/** A weight belt's load, e.g. "6.5 kg" — unrounded, since weighting is often set in half-kilos. */
export function formatWeight(kg: number | null): string | null {
  if (!isFiniteNumber(kg)) return null;
  return `${kg} kg`;
}

/** A cylinder's water capacity, e.g. "12 l" or "11.1 l" — unrounded, since a real cylinder size can be fractional. */
export function formatVolume(litres: number | null): string | null {
  if (!isFiniteNumber(litres)) return null;
  return `${litres} l`;
}

/**
 * Total gas used across every cylinder (derived.ts's `gasUsedLitres`), to the whole litre —
 * unlike `formatVolume` above, this is a computed aggregate rather than a diver-recorded
 * spec, so it gets the same whole-unit treatment `formatPressure` gives an aggregate
 * reading. `gasUsedLitres` itself already guards its own `Number.isFinite`, so this guard
 * is a second, independent line of defence rather than the only one — the same belt-and-
 * braces stance every other formatter in this file takes toward its input.
 */
export function formatGasUsed(litres: number | null): string | null {
  if (!isFiniteNumber(litres)) return null;
  return `${Math.round(litres)} l`;
}

/** Respiratory minute volume, e.g. "18.4 l/min". */
export function formatRmv(litresPerMin: number | null): string | null {
  if (!isFiniteNumber(litresPerMin)) return null;
  return `${litresPerMin.toFixed(1)} l/min`;
}

/** A gas fraction, e.g. "32 %" — O₂ or He content, unrounded. */
export function formatPercent(pct: number | null): string | null {
  if (!isFiniteNumber(pct)) return null;
  return `${pct} %`;
}

/** How many cylinders of one kind, e.g. "2" — a plain count, no unit. */
export function formatCount(count: number | null): string | null {
  if (!isFiniteNumber(count)) return null;
  return `${count}`;
}

/** A waves/current/surge reading, e.g. "1" — the bare 0–3 scale DESIGN.md §10 keeps
 * unclamped (a future client's out-of-range value is a runtime reality, same as `rating`
 * below), shown as the diver recorded it rather than a formatted scale. */
export function formatConditionScale(value: number | null): string | null {
  if (!isFiniteNumber(value)) return null;
  return `${value}`;
}

/** A dive site's GPS position, e.g. "50.12345, 14.56789". Null unless BOTH coordinates are
 * real — a lone latitude or longitude isn't a point a diver could read, so a finite
 * latitude paired with a non-finite longitude (or vice versa) omits the row entirely
 * rather than rendering half of it. */
export function formatCoordinates(latitude: number | null, longitude: number | null): string | null {
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null;
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/** A dive's star rating, e.g. "4 / 5". DESIGN.md §10 keeps `rating` as `number | null`
 * rather than a `1|2|3|4|5` literal union — a future client can still deliver an
 * out-of-range value — so this only guards finiteness; clamping the *displayed marks* to a
 * legal range is `DiveRow.tsx`'s `filledDotCount`, not this module's job. */
export function formatRating(rating: number | null): string | null {
  if (!isFiniteNumber(rating)) return null;
  return `${rating} / 5`;
}

/**
 * Minutes on the surface, in a shape a diver would actually read (review task 7, Important
 * #2). Below an hour, a plain minute count is the natural reading — the same judgement
 * `formatDuration` makes for a dive itself. At or above an hour it switches to hours (and,
 * unless they're exactly zero, minutes): "22 h 20 min" reads as roughly a day; "1340 min"
 * does not, even though it is the same number. `derived.ts`'s `surfaceIntervalMin` already
 * refuses anything a day or over, so this never has to decide what a multi-day gap should
 * look like — by the time a value reaches here it is always under 24 h.
 *
 * Deliberately its own formatter rather than a call to `formatDuration`: that function's
 * own docblock records the opposite decision for a dive's own duration ("renders an
 * hour-plus dive in minutes, which is how divers log it") — a 72-minute dive is not the
 * same kind of number as a 1340-minute gap between two dives, and conflating them would
 * make one of the two read wrong.
 */
export function formatSurfaceInterval(minutes: number | null): string | null {
  if (!isFiniteNumber(minutes) || minutes < 0) return null;
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

/**
 * What a dive is called when it has no name of its own. Exported so `groupIntoTrips`
 * (domain/trips.ts) can title an unplaced TRIP with the same words a row uses for an
 * unplaced dive — the words are shared; the rules that reach them are not (see below).
 */
export const UNNAMED_SITE = 'Unnamed site';

/**
 * What a dive is CALLED on screen: its site, or its centre when no site was recorded, or
 * `UNNAMED_SITE` when it has neither. The single owner of that choice — `DiveRow.tsx`'s
 * site line, `DiveDetailScreen.tsx`'s hero heading, and anything added later.
 *
 * This exists because the two call sites each answered it themselves and had already
 * drifted: the row showed "Unnamed site" for a dive with no site name while that same
 * dive's detail page rendered no title at all, so a diver could tap a named row and land on
 * a heading-less screen. Neither may keep its own copy.
 *
 * Site first, because that is the name a diver recognises a dive by — "Blue Hole", not the
 * shop that took them there. Always a string, never null: a row or a hero with no heading
 * is a blank line, which is the defect itself.
 *
 * Deliberately NOT the same rule as `tripKeyOf` (domain/trips.ts), which is centre-first
 * and may be null. That one is a grouping KEY, where the centre is what stays constant
 * across a trip's several sites and where "no place recorded" has to stay distinguishable
 * from every real place — a key that fell back to these words would merge unplaced dives
 * with any dive someone actually named "Unnamed site". This one is a display LABEL that
 * must always produce text. The two look similar and answer different questions; do not
 * "unify" them.
 */
export function diveSiteLabel(dive: Pick<Dive, 'siteName' | 'centerName'>): string {
  return dive.siteName ?? dive.centerName ?? UNNAMED_SITE;
}

/**
 * How many dives, as a phrase: "1 dive", "3 dives". The single owner of that singular/plural
 * choice, because there are two callers for it — the "Up next" header's trailing slot
 * (TripHeader.tsx) and a day strip's own sentence (DayStrip.tsx, "18 Aug 2026 · 2 dives, no
 * times") — and the strip previously carried an inline copy. English needs one comparison;
 * Czech (i18next, en + cs, a later milestone) needs three forms and does not split on
 * `=== 1`, so a second copy would be a second place to find and fix.
 *
 * Takes and returns non-null, unlike every formatter above: `count` is something the app
 * counts (an array length), never a nullable field read back out of the database, so there
 * is no absent case to thread through. The guards above exist for stored values; this has
 * none.
 */
export function formatDiveCount(count: number): string {
  return `${count} ${count === 1 ? 'dive' : 'dives'}`;
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

import { formatDiveDate } from '../format/display';
import { calendarDateToUtcMs } from './datetime';
import { type Dive } from './types';

const MS_PER_DAY = 86_400_000;

/** The title (and place-equality value) for a dive with neither `siteName`
 * nor `centerName` set. DESIGN.md §1's no-form-shaming stance means an
 * unnamed dive is a normal, expected case — never dropped, never blocked —
 * so it needs a real label, not an empty string a list row would render as
 * a blank line. */
const UNNAMED_SITE = 'Unnamed site';

/**
 * A trip as the Dives list shows it — DESIGN.md §3: "auto-grouped into trips
 * (consecutive days, same place)". There is deliberately no trip entity in
 * the data model (§9, §10): this is a view recomputed from a dive list on
 * every render, never persisted, and `key` is not a database id — see
 * `groupIntoTrips`.
 */
export interface Trip {
  /** Unique among the trips one `groupIntoTrips` call returns; stable enough
   * to use as a list key, not a stored id. */
  key: string;
  /** The place name, or `'Unnamed site'` when the trip's dives have none. */
  title: string;
  /** `'16 Aug 2026'` for a single day, `'16–18 Aug 2026'` (en dash) for a span. */
  dateRange: string;
  /** This trip's dives, in the same order (newest-first) as the input. */
  dives: Dive[];
}

/**
 * The place a dive groups by. `siteName` wins when set; `centerName` is the
 * fallback for a dive logged against a dive center with no specific site
 * recorded. `null` means genuinely unnamed — distinct from any string value,
 * including `UNNAMED_SITE` itself, so two unnamed dives group with each other
 * (`null === null`) but a named dive can never accidentally match one by
 * sharing that display text.
 */
function placeOf(dive: Dive): string | null {
  return dive.siteName ?? dive.centerName ?? null;
}

/**
 * Whole days between two calendar dates, via `calendarDateToUtcMs` — never by
 * subtracting the date strings or by local-time `Date` arithmetic. A bare
 * `new Date('2026-01-01')` is UTC midnight, so in any timezone west of
 * Greenwich a naive read of it renders 31 Dec 2025 (proven by execution in
 * Task 2); the same class of bug here would silently split or merge trips
 * depending on the diver's timezone.
 *
 * `date` is non-nullable and canonicalised at the write boundary
 * (`storedCalendarDate` in db/dives.ts), so `calendarDateToUtcMs` returning
 * null is not expected in practice — but this module doesn't get to assume
 * the value in front of it is clean any more than the display boundary does
 * (see `formatDiveDate`'s docblock). Returning `Infinity` for that case,
 * rather than letting `null - number` arithmetic silently coerce `null` to
 * `0`, means an uninterpretable date simply never merges — the same
 * unusable-value-becomes-a-sentinel shape `manualOrderKey` in diveNumber.ts
 * uses, for the same reason: a real, self-equal number that can never
 * accidentally satisfy `<= 1`.
 */
function daysApart(a: string, b: string): number {
  const aMs = calendarDateToUtcMs(a);
  const bMs = calendarDateToUtcMs(b);
  if (aMs === null || bMs === null) return Infinity;
  return Math.abs(aMs - bMs) / MS_PER_DAY;
}

/**
 * DESIGN.md §3's whole grouping rule: two dives belong to the same trip when
 * their place matches and their dates are the same day or one day apart. This
 * one comparison, applied to each dive and its immediate predecessor down a
 * sorted list, is the entire feature — see `groupIntoTrips`.
 */
function sameTrip(a: Dive, b: Dive): boolean {
  return placeOf(a) === placeOf(b) && daysApart(a.date, b.date) <= 1;
}

/**
 * `'16 Aug 2026'` for a trip confined to one calendar date, `'16–18 Aug 2026'`
 * (en dash) for a span. `tripDives` is a slice of the newest-first input in
 * the same order, so its first entry holds the latest date in the trip and
 * its last entry the earliest — reusing that order rather than computing
 * min/max avoids a second sort here.
 *
 * The month/year half always comes from `formatDiveDate`, the single owner of
 * turning a `YYYY-MM-DD` string into diver-facing text (see its docblock for
 * the timezone bug it exists to avoid). The leading day number of a span is
 * read back out of `formatDiveDate`'s OWN output rather than re-split from
 * the raw date string a second time, so `formatDiveDate` stays the only
 * function in the codebase that parses a calendar-date string for display —
 * including how it degrades an uninterpretable date, which this inherits for
 * free rather than needing its own guard.
 */
function dateRangeOf(tripDives: readonly Dive[]): string {
  const newest = tripDives.at(0);
  const oldest = tripDives.at(-1);
  if (newest === undefined || oldest === undefined) return '';
  const end = formatDiveDate(newest.date);
  if (oldest.date === newest.date) return end;
  return `${leadingToken(formatDiveDate(oldest.date))}–${end}`;
}

/** The `'16'` in `formatDiveDate`'s own `'16 Aug 2026'` — the text before the
 * first space, or the whole string when there isn't one. */
function leadingToken(formatted: string): string {
  const spaceIndex = formatted.indexOf(' ');
  return spaceIndex === -1 ? formatted : formatted.slice(0, spaceIndex);
}

/**
 * Splits `dives` (planned first, DESIGN.md §2.4) or logged (numbered,
 * grouped into trips). Order is preserved within each half — this does not
 * sort, so callers get back whatever order `dives` was already in.
 *
 * Checks for `'logged'` specifically, the same exact-match convention
 * `assignDiveNumbers` uses for the same status field: anything that isn't
 * affirmatively logged — `'planned'`, or a status this type shouldn't allow —
 * belongs with "Up next", not mixed into a numbered trip.
 */
export function splitPlanned(dives: Dive[]): { planned: Dive[]; logged: Dive[] } {
  const planned: Dive[] = [];
  const logged: Dive[] = [];
  for (const d of dives) {
    (d.status === 'logged' ? logged : planned).push(d);
  }
  return { planned, logged };
}

/**
 * DESIGN.md §3: the Dives list auto-groups into trips — consecutive days at
 * the same place — with no trip entity anywhere in the data model (§9, §10).
 * A trip is therefore computed fresh from a dive list on every render, and
 * this is the one place that computes it.
 *
 * `dives` MUST already be sorted newest-first, the order `toDives` produces.
 * This never re-sorts: doing so here would be a second, competing place that
 * decides dive order, and `compareDiveOrder` (via `toDives`) is already the
 * single owner of that. Each dive is compared only to the one immediately
 * before it in the given order — so three same-place dives one day apart
 * each still form one trip even though the first and last are two days
 * apart, and an out-of-order input produces a grouping with no defined
 * meaning rather than being silently corrected.
 */
export function groupIntoTrips(dives: Dive[]): Trip[] {
  const trips: Trip[] = [];
  let current: Dive[] = [];

  const flushCurrent = () => {
    const first = current.at(0);
    if (first === undefined) return; // current is empty; nothing to flush.
    trips.push({
      key: first.id,
      title: placeOf(first) ?? UNNAMED_SITE,
      dateRange: dateRangeOf(current),
      dives: current,
    });
  };

  for (const d of dives) {
    const previous = current.at(-1);
    if (previous !== undefined && !sameTrip(previous, d)) {
      flushCurrent();
      current = [];
    }
    current.push(d);
  }
  flushCurrent();

  return trips;
}

import { formatDiveDate, UNNAMED_SITE } from '../format/display';
import { calendarDateToUtcMs, normaliseTimeOfDay } from './datetime';
import { type Dive } from './types';

const MS_PER_DAY = 86_400_000;

// `UNNAMED_SITE` is the title for a trip whose dives have neither `centerName`
// nor `siteName` set — `tripKeyOf` returns null for those, and this is what
// that null renders as. Never used for the grouping comparison itself (see
// `tripKeyOf`). DESIGN.md §1's no-form-shaming stance means an unnamed dive is
// a normal, expected case — never dropped, never blocked — so it needs a real
// label, not an empty string a list row would render as a blank line.
//
// Imported from format/display.ts rather than restated here: an unplaced trip
// header and an unplaced row must read the same, and the words had been written
// out in three places. Only the WORDS are shared. The rule that reaches them is
// not — `diveSiteLabel` is site-first and always produces text, `tripKeyOf` is
// centre-first and may be null; both docblocks say why.

/**
 * A trip as the Dives list shows it — DESIGN.md §3: "auto-grouped into trips
 * (same dive centre, gaps up to 3 days)". There is deliberately no trip entity
 * in the data model (§9, §10): this is a view recomputed from a dive list on
 * every render, never persisted, and `key` is not a database id — see
 * `groupIntoTrips`.
 */
export interface Trip {
  /** Unique among the trips one `groupIntoTrips` call returns; stable enough
   * to use as a list key, not a stored id. */
  key: string;
  /** `tripKeyOf`'s value for this trip's dives — the centre, or the site for
   * dives with no centre — or `'Unnamed site'` when they have neither. */
  title: string;
  /** `'16 Aug 2026'` for a single day, `'16–18 Aug 2026'` (en dash) for a span. */
  dateRange: string;
  /** This trip's dives, in the same order (newest-first) as the input. */
  dives: Dive[];
}

/**
 * The value a dive groups by — DESIGN.md §10, "A trip is one dive centre, with
 * gaps of up to 3 days". `centerName` wins when set, because the centre is what
 * stays CONSTANT across a trip whose dives are at several different sites: a
 * boat day out of Subic visits two to four wrecks, and keying on the site
 * fragmented one week into a dozen one-dive "trips". `siteName` is the fallback
 * for a dive with no centre recorded, so shore diving groups exactly as it did
 * before. `null` means genuinely unplaced — distinct from any string value,
 * including `UNNAMED_SITE` itself, so two unplaced dives group with each other
 * (`null === null`) but a named dive can never accidentally match one by
 * sharing that display text.
 *
 * This is the GROUPING KEY, and deliberately NOT the same rule as
 * `diveSiteLabel` (format/display.ts), the display label a dive row and the
 * detail hero show: that one is site-first and always produces text, because a
 * row with no heading is a blank line. This one is centre-first and may be
 * null, because "no place recorded" has to stay distinguishable from every
 * real place — a key that fell back to the words "Unnamed site" would merge
 * unplaced dives with any dive someone actually named that. The two rules look
 * similar and answer different questions; do not "unify" them.
 *
 * Because the key IS the place, every dive in a trip shares it by construction,
 * so `groupIntoTrips` titles a trip with the key and nothing more. There is no
 * most-dived-site heuristic and no "5 sites" fallback to add here — §10 rejects
 * both explicitly.
 */
function tripKeyOf(dive: Dive): string | null {
  return dive.centerName ?? dive.siteName ?? null;
}

/**
 * The largest gap, in whole days, that still leaves two dives in one trip
 * (DESIGN.md §10). Three, not one: a rest day mid-week is an ordinary part of a
 * diving holiday, and at one day a single day off split whatever the old
 * site-based key had not already fragmented. Named rather than inlined into
 * `sameTrip` below so the number carries its reason with it.
 */
const MAX_TRIP_GAP_DAYS = 3;

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
 * accidentally satisfy `<= MAX_TRIP_GAP_DAYS`.
 */
function daysApart(a: string, b: string): number {
  const aMs = calendarDateToUtcMs(a);
  const bMs = calendarDateToUtcMs(b);
  if (aMs === null || bMs === null) return Infinity;
  return Math.abs(aMs - bMs) / MS_PER_DAY;
}

/**
 * DESIGN.md §3/§10's whole grouping rule: two dives belong to the same trip when
 * their `tripKeyOf` matches and their dates are no more than
 * `MAX_TRIP_GAP_DAYS` apart. This one comparison, applied to each dive and its
 * immediate predecessor down a sorted list, is the entire feature — see
 * `groupIntoTrips`.
 */
function sameTrip(a: Dive, b: Dive): boolean {
  return tripKeyOf(a) === tripKeyOf(b) && daysApart(a.date, b.date) <= MAX_TRIP_GAP_DAYS;
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
 * DESIGN.md §3: the Dives list auto-groups into trips — one dive centre, with
 * gaps of up to `MAX_TRIP_GAP_DAYS` — with no trip entity anywhere in the data
 * model (§9, §10). A trip is therefore computed fresh from a dive list on every
 * render, and this is the one place that computes it.
 *
 * A trip's `title` is simply `tripKeyOf`'s value for its first dive: every dive
 * in the trip shares that key by construction, since it is what put them in one
 * trip. §10 rejects the two things that might otherwise look like improvements
 * here — a most-dived-site heuristic and an "N sites" fallback — so neither
 * belongs in this function.
 *
 * `dives` MUST already be sorted newest-first, the order `toDives` produces.
 * This never re-sorts: doing so here would be a second, competing place that
 * decides dive order, and `compareDiveOrder` (via `toDives`) is already the
 * single owner of that. Each dive is compared only to the one immediately
 * before it in the given order — so four dives at one centre spaced three days
 * apart each still form one trip even though the first and last are nine days
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
      title: tripKeyOf(first) ?? UNNAMED_SITE,
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

/**
 * Splits `dives` into consecutive runs sharing one exact calendar date — the
 * unit hand-ordering (`canReorder` below, `reorderDivesForDate` in
 * db/dives.ts) operates on. DESIGN.md §2.5: "same-day dives order by time
 * in; when times are missing the diver can order them by hand" — a *day*,
 * not a `Trip`, since one trip can span several dates (`groupIntoTrips`
 * merges nearby days at one centre) and `manual_order` is only ever
 * a tie-break within a single `date`.
 *
 * Same single-pass, compare-only-to-the-immediately-previous-entry shape as
 * `groupIntoTrips`, and for the same reason: `dives` must already be in the
 * order `toDives` produces (any order is fine here, actually — unlike
 * `sameTrip`, exact-date equality does not depend on which direction the
 * list runs — but this still never re-sorts, so a caller's order, whichever
 * way it runs, comes back unchanged within each group).
 */
export function sameDateGroups(dives: Dive[]): Dive[][] {
  const groups: Dive[][] = [];
  let current: Dive[] = [];

  for (const d of dives) {
    const previous = current.at(-1);
    if (previous !== undefined && previous.date !== d.date) {
      groups.push(current);
      current = [];
    }
    current.push(d);
  }
  if (current.length > 0) groups.push(current);

  return groups;
}

/**
 * True only when a group of same-date dives can actually be moved by hand.
 * §2.5's tiers (owned by `compareDiveOrder`, diveNumber.ts — never restated
 * here) rank `timeIn` above `manualOrder`, so on a day where every dive
 * already carries an entry time, `reorderDivesForDate` still writes the
 * requested order but the day sorts exactly as it did before (see that
 * function's own docblock: `applied` is how it reports that). A control that
 * offers reordering there looks like it works and silently does not — this
 * is the one gate the UI needs to avoid that, checked with `applied` as the
 * backstop it cannot rely on alone (see `ReorderControls.tsx`).
 *
 * "Has a time" is read through `normaliseTimeOfDay` — the same predicate
 * `compareDiveOrder` itself uses for its timeIn tier — rather than a bare
 * `!== null` check, so a `timeIn` value that could not sort by time either
 * (an empty string, something unparseable) does not block reordering here
 * when it would not have outranked `manualOrder` there.
 *
 * A single dive has no sibling to move relative to, so the floor is two.
 * This does not check that every dive actually shares one date — callers
 * pass it one `sameDateGroups` entry, the same "trust the caller's grouping"
 * contract `groupIntoTrips` documents for `sameTrip`.
 */
export function canReorder(dives: Dive[]): boolean {
  return dives.length >= 2 && dives.every((d) => normaliseTimeOfDay(d.timeIn) === null);
}

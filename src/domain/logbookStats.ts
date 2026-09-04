import { isDisplayableDepth } from '../format/display';
import { daysBetweenCalendarDates } from './datetime';
import { rmv } from './derived';
import { compareDiveOrder, type DiveOrdering } from './diveNumber';
import { siteIdentityOf } from './siteIdentity';
import { type Dive, type DiveSite } from './types';

/**
 * **What a logbook adds up to** — every figure DESIGN.md §3 gives the Stats tab, computed in
 * one place, in SI, with no formatting and no unit system in sight.
 *
 * `logbookStats` below is the first three — *"total dives, hours underwater, deepest dive"* —
 * and it exists as a domain owner rather than as a `useMemo` inside `DivesScreen` because there
 * are already two callers for it: the summary line under the Dives title (§0.6 — `128 dives ·
 * 96 h 12 min · deepest 41.2 m`), and M3's Stats screen, which renders the same three numbers
 * on a screen of its own. §4.1's defining defect is one rule written in two places and then
 * drifting; two independent counts of "how many dives have I done" that disagree by the
 * planned dive a diver set up on the boat is exactly the shape that table exists to name.
 *
 * **The rest of §3's bullet joined it in M3a** — *"countries and sites visited; RMV trend;
 * currency"* — as siblings rather than as fields on `LogbookStats`, and the split is
 * deliberate. `LogbookStats` is exactly the §0.6 header line's three figures, so it stays the
 * shape both of that line's owners already agree on; the four functions below each need
 * something the header does not have (a second table, an order, or today's date) and would
 * have made every caller pay for a figure only one screen draws. One module either way,
 * because they are one subject and the same population rule runs through all of them: **a
 * planned dive is not a dive that happened** (§2.4), tested by `status === 'logged'` in every
 * one of them.
 *
 * `format/display.ts` turns these into the sentences a diver reads (`formatLogbookSummary`,
 * `formatRmvTrend`, `formatDaysSince`), and `format/units.ts` decides what a metre reads as.
 * Nothing here knows either.
 */

/**
 * The only fields the figures depend on — the same `Pick` shape `DiveOrdering`
 * (domain/diveNumber.ts) uses, and for the same reason: a caller holding whole `Dive` rows
 * satisfies it structurally, while the type states exactly what this rule reads.
 */
export type DiveStats = Pick<Dive, 'status' | 'durationMin' | 'maxDepthM'>;

/**
 * What a logbook adds up to. Every figure is SI or a plain count; the two nullable ones are
 * null when **no dive contributed a reading at all**, which a caller must be able to tell from
 * a real zero — a logbook of ten dives none of which recorded a duration is not a logbook with
 * zero minutes in it.
 */
export interface LogbookStats {
  /**
   * How many **logged** dives. Not `dives_before` (§2.5), and that is the deliberate half:
   * a diver with 100 pre-Ponor dives and 28 in the app has a top row reading `#128` above a
   * list of 28, so a header claiming `128 dives` would be describing one population in the
   * numbers and a different one in the list directly beneath it. The dive NUMBER answers
   * "how many dives have I ever done"; this line answers "what is in this logbook", which is
   * the only question a summary sitting on top of the logbook can be asking.
   *
   * "The big number should match the big number" is a change somebody will propose, and this
   * is why it is wrong: adding the offset here would make the count the one figure of the
   * three that includes dives the other two cannot see — no pre-Ponor dive carries a duration
   * or a depth — so one line would silently mix two populations.
   */
  dives: number;
  /** Total recorded bottom time, in minutes, or `null` when no logged dive records one. */
  minutes: number | null;
  /** The deepest recorded max depth, in metres, or `null` when no logged dive records one. */
  deepestM: number | null;
}

/**
 * True for a duration that can be added up: finite, and not negative.
 *
 * `Number.isFinite` never coerces and never throws whatever it is handed, so every corrupt
 * shape a stored `duration_min` could take — null, undefined, NaN, ±Infinity, a leftover
 * string — collapses into one "no reading here" case rather than each poisoning the sum a
 * different way. A single NaN would otherwise make the whole total NaN and blank the figure
 * for a diver whose other 127 dives are perfectly recorded.
 *
 * Negative is refused for the reason `isDisplayableDepth` refuses a negative depth: a dive
 * cannot have lasted less than no time, and a negative would quietly subtract from the total
 * rather than being visibly ignored.
 */
function isUsableDuration(value: unknown): value is number {
  return Number.isFinite(value) && (value as number) >= 0;
}

/**
 * The three figures for a list of dives.
 *
 * **Planned dives are excluded** (§2.4: a planned dive is *"excluded from stats and dive
 * numbering"*). That is the rule most likely to be lost, and it is not a rounding
 * consideration: a plan has no duration and usually no depth, so including it would leave the
 * count describing a bigger population than the two figures beside it — `129 dives` over the
 * same 96 hours, one dive that has not happened yet. `status === 'logged'` specifically, the
 * exact-match convention `assignDiveNumbers` and `splitPlanned` already use, so a status
 * neither `Dive` nor this build knows about is treated as not-logged rather than counted.
 *
 * Called during render (`DivesScreen`), so — exactly as `assignDiveNumbers` records — nothing
 * here may throw and the answer may not depend on the array's order:
 *  - `dives` may not be an array, or may hold a null/undefined entry (a bad join, a
 *    partially-hydrated row); either is "no dive there" rather than something to dereference.
 *  - `durationMin` and `maxDepthM` are typed nullable numbers and a corrupt row can hand back
 *    anything, so each goes through a predicate rather than into the arithmetic.
 *  - A depth is judged by `isDisplayableDepth` (format/display.ts), the app's one owner of
 *    "can this depth be shown", rather than by a second finite-and-not-negative check written
 *    here. The deepest dive is a depth the screen is about to print, so the figure this
 *    reports and the figure the screen can draw are the same question; two answers to it is
 *    how a dangling "Max depth" label with nothing beside it shipped once already.
 *  - `DiveStats` carries no `deletedAt`. A soft-deleted dive that reaches here is counted,
 *    exactly as it would be numbered — filtering tombstones is the caller's job (db/
 *    tombstone.ts), before this ever sees them.
 *
 * The nullable figures stay null when nothing contributed, rather than collapsing to 0: `0 h`
 * under a list of dives would be a claim that they were all instantaneous, where "nothing
 * recorded" is the truth and is what §1's never-shame-the-form stance expects the app to say.
 * A dive that genuinely records `durationMin: 0` does contribute, and the total is then a real
 * `0` — the app shows what was recorded.
 */
export function logbookStats(dives: readonly DiveStats[]): LogbookStats {
  if (!Array.isArray(dives)) return { dives: 0, minutes: null, deepestM: null };

  let count = 0;
  let minutes: number | null = null;
  let deepestM: number | null = null;

  for (const d of dives) {
    if (!d || d.status !== 'logged') continue;
    count += 1;
    if (isUsableDuration(d.durationMin)) minutes = (minutes ?? 0) + d.durationMin;
    if (isDisplayableDepth(d.maxDepthM) && (deepestM === null || d.maxDepthM > deepestM)) {
      deepestM = d.maxDepthM;
    }
  }

  return { dives: count, minutes, deepestM };
}

/** The fields "sites visited" depends on: the population rule, and §6's snapshot/id pair. */
export type DiveSitesVisited = Pick<Dive, 'status' | 'siteId' | 'siteName'>;

/**
 * **§3's *"sites visited"*** — how many distinct places this logbook has dives at.
 *
 * Identity is `siteIdentityOf` (domain/siteIdentity.ts) and not a rule of this module's own,
 * which is the entire point: §3's Map tab groups its markers by the same function, so "12
 * sites" here and twelve markers there are the same twelve. That module carries the argument
 * for `site_id` before the folded `site_name` and names the cost of it.
 *
 * **A dive that names no place at all contributes nothing**, because `siteIdentityOf` answers
 * `null` for it. Counting such dives would invent a site out of an absence, and counting
 * several of them as one would invent a shared place out of a shared absence — the map adds a
 * per-dive tier for exactly those, and it is a tier about where to draw a marker rather than
 * about how many places a diver has been.
 *
 * **Planned dives are excluded** (§2.4), like every figure in this module: a site you intend to
 * dive is not a site visited, and a count that included them would say a diver had been
 * somewhere they have not been — a stronger claim than any of the other figures make, since it
 * is about the diver's life rather than about their arithmetic.
 */
export function sitesVisited(dives: readonly DiveSitesVisited[]): number {
  if (!Array.isArray(dives)) return 0;
  const places = new Set<string>();
  for (const d of dives) {
    if (!d || d.status !== 'logged') continue;
    const identity = siteIdentityOf(d);
    if (identity !== null) places.add(identity);
  }
  return places.size;
}

/** A dive, as far as its country is knowable: the population rule and the one link to a site. */
export type DiveCountry = Pick<Dive, 'status' | 'siteId'>;
/** The catalogue side of that link — §6's `dive_sites`, of which only two columns matter here. */
export type SiteCountry = Pick<DiveSite, 'id' | 'country'>;

/**
 * **§3's *"countries visited"*** — and the figure whose honest answer is usually **none known**.
 *
 * A country reaches a dive down exactly one path and this function refuses to invent a second:
 * `dive.site_id` names a catalogue row, and that row carries a `country` (§6). §2.3 is explicit
 * that the country *"is derived from the row's own pin and from nothing else, so a site created
 * out of signal has `null` and stays correct"* — so a site can be perfectly real and still know
 * no country, and this reports that as not knowing rather than as the diver having been
 * nowhere. Nothing here reads a dive's own pin, its site NAME, or its centre: a name is not a
 * place on the earth, `platform/geocode.ts` is §4.1's owner of turning a pin into a country,
 * and a guess dressed as a count is the one thing a figure may not be.
 *
 * **`0` therefore means "the app knows of none", not "you have dived in no countries"**, and
 * the caller is what has to keep those apart — the Stats screen draws an em dash and says where
 * countries come from, rather than printing a zero a diver could disprove by looking out of the
 * window. Stated here because a bare `number` cannot say it.
 *
 * **Codes, compared as codes.** §2.3 stores ISO 3166-1 alpha-2 rather than a localized name,
 * so this trims and upper-cases before counting: `hr` and `HR` are one country. It deliberately
 * does **not** use `foldForMatching` (domain/search.ts), which is the fold for *names* a diver
 * typed — a two-letter code is not text with accents in it, and borrowing that rule here would
 * tie a country count to a decision about search.
 *
 * `sites` is whatever the device holds; `db/catalogue.ts` has already filtered it to live,
 * `status = 'active'` rows, so a duplicate an admin merged away cannot be counted beside the
 * row it was merged into. A dive pointing at a site the device has not pulled contributes
 * nothing, which is correct: the app does not know that site's country yet.
 */
export function countriesVisited(
  dives: readonly DiveCountry[],
  sites: readonly SiteCountry[],
): number {
  if (!Array.isArray(dives) || !Array.isArray(sites)) return 0;

  const visited = new Set<string>();
  for (const d of dives) {
    if (!d || d.status !== 'logged') continue;
    if (typeof d.siteId === 'string' && d.siteId !== '') visited.add(d.siteId);
  }
  if (visited.size === 0) return 0;

  const countries = new Set<string>();
  for (const site of sites) {
    if (!site || !visited.has(site.id)) continue;
    const code = typeof site.country === 'string' ? site.country.trim().toUpperCase() : '';
    if (code !== '') countries.add(code);
  }
  return countries.size;
}

/**
 * How many recent dives an RMV figure is averaged over, and how far back the comparison window
 * reaches.
 *
 * Five, because a trip is four to ten dives: it is enough that one cold, over-weighted dive
 * does not become "your RMV", and few enough that the figure moves within a single week of
 * diving rather than lagging a season behind. There is no right number here and the caption
 * under the figure states the one actually used (`formatRmvWindow`, format/display.ts), so a
 * diver is never guessing what "recent" means.
 */
const RMV_WINDOW = 5;

/** §3's *"RMV trend"*, as far as counters go: where the diver is now, and where they were. */
export interface RmvTrend {
  /** Mean RMV over the most recent window, in l/min. Always a real, positive number. */
  recent: number;
  /**
   * **The dives that mean is over, oldest to newest** — 1 to `RMV_WINDOW` real, positive
   * l/min values, and never more.
   *
   * It was a `recentCount: number` until M3d, and the series replaced the count rather than
   * joining it because §4.1 computes a list from another rather than keeping two: the caption
   * asks for `recentValues.length` and cannot then disagree with what is drawn from the same
   * array. What wanted the values is the sparkline beside the figure (`RmvSparkline`,
   * components/RmvSparkline.tsx), and giving it a window of its own was the alternative — a
   * drawing and the number beside it computed from two different populations, which is the
   * drift this module exists to prevent, arriving as a picture.
   *
   * `recent` above stays even though it is the mean of exactly these values: the Stats screen
   * does no arithmetic of its own (its docblock says so), and a caller that had to average
   * this array would be the second implementation of a figure two screens already share.
   */
  recentValues: readonly number[];
  /**
   * Mean RMV over the window before it, or `null` when no dive earlier than the recent window
   * has one — in which case there is no trend to state, only a figure.
   */
  previous: number | null;
}

/** Everything an RMV trend reads: the ordering tiers (§2.5) plus `rmv`'s own three fields. */
export type DiveRmv = DiveOrdering & Pick<Dive, 'tanks' | 'avgDepthM' | 'durationMin'>;

/**
 * **§3's *"RMV trend"*, and §3 also says *"charts later, counters first"*** — so a trend here is
 * a **direction and a recent average**, not a series. Two means: the last `RMV_WINDOW` dives
 * that have an RMV, and the `RMV_WINDOW` before those. `format/display.ts` turns the pair into
 * a direction (`formatRmvTrend`); this returns only numbers.
 *
 * **`rmv` (domain/derived.ts) is the one owner of the figure itself** and is called rather than
 * re-derived — the same relationship this module has with `isDisplayableDepth`. That matters
 * more here than anywhere else in this file, because RMV has real guards behind it: a stage
 * bottle carried and never opened gives zero litres and no RMV, an average depth or duration
 * that is missing gives none, and understating RMV is the unsafe direction for gas planning.
 * A second implementation of that arithmetic would be a safety-relevant number computed twice.
 *
 * **Many dives will have no RMV at all**, since it needs average depth, duration and cylinder
 * size together, and §1 asks a diver for none of them. Those dives are skipped rather than
 * counted as zero — a zero would drag the mean toward a value no diver ever breathed — so the
 * window is "your last five dives **with gas recorded**", which is what the caption says.
 *
 * **The order is this function's own, not the caller's.** Every other figure in this module is
 * order-independent by construction and says so; a trend cannot be, so it sorts by
 * `compareDiveOrder` (domain/diveNumber.ts, §4.1's owner of dive ordering) instead of trusting
 * the array it was handed. That is the difference between a trend and a coincidence: `useDives`
 * hands back newest-first today, and a function that read the ends of the array would silently
 * invert the day anything re-sorted it — including `MapScreen`, which passes one site's dives.
 * `recentValues` comes back in that same order, **oldest first**, which since M3d is drawn as
 * well as averaged: a mean survives a reversed array and a sparkline does not, so the direction
 * is part of what this returns rather than a detail of how it slices.
 *
 * `null` when no logged dive has an RMV at all, which is an ordinary logbook rather than an
 * error: nothing to say, and the caller says nothing.
 */
export function rmvTrend(dives: readonly DiveRmv[]): RmvTrend | null {
  if (!Array.isArray(dives)) return null;

  const logged = dives.filter((d): d is DiveRmv => Boolean(d) && d.status === 'logged');
  const values: number[] = [];
  for (const d of [...logged].sort(compareDiveOrder)) {
    const value = rmv(d);
    if (value !== null) values.push(value);
  }
  if (values.length === 0) return null;

  const recentValues = values.slice(-RMV_WINDOW);
  const previous = values.slice(
    Math.max(0, values.length - RMV_WINDOW * 2),
    values.length - recentValues.length,
  );
  return {
    recent: mean(recentValues),
    recentValues,
    previous: previous.length === 0 ? null : mean(previous),
  };
}

/** The arithmetic mean of a non-empty list of real numbers — every caller guards emptiness
 * itself, because what an empty window means differs between them. */
function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * **How long it has been since the diver was in the water**, and whether §3's refresher nudge is
 * due.
 */
export interface Currency {
  /** The date of the most recent logged dive that has actually happened, as it is stored. */
  lastDate: string;
  /** Whole days from that date to today — `0` is today, `1` is yesterday. Never negative. */
  days: number;
  /** §3's *"refresher nudge after 6 months"*: true once `days` has passed that mark. */
  refresher: boolean;
}

/** The two fields currency reads: the population rule, and when the dive was. */
export type DiveCurrency = Pick<Dive, 'status' | 'date'>;

/**
 * Six months, as days.
 *
 * 180 rather than six calendar months, and the difference is real: six calendar months is 181
 * to 184 days depending on which half of the year a diver sat out, so a nudge keyed on it would
 * appear on a different day for two divers with the same gap. The industry's own copy says "six
 * months" and means "about half a year", so the figure is stated in the unit the app actually
 * counts in (`daysBetweenCalendarDates`) rather than converted twice.
 */
const REFRESHER_AFTER_DAYS = 180;

/**
 * **§3's *currency*** — *"days since your last dive, refresher nudge after 6 months"*.
 *
 * **A planned dive is not a dive** (§2.4), and this is the figure where getting that wrong is
 * worst: a plan set up for next week's trip would make the app say "you dived yesterday" to a
 * diver who has not been wet in a year — the difference between currency and a booking. So the
 * population is `status === 'logged'`, the same exact-match every figure in this module uses.
 *
 * **And a logged dive dated ahead of today does not count either.** §10 has already ruled on
 * this shape for carry-over — *"a dive that has not happened yet is not recent"* — and currency
 * is that sentence's own question. A logged dive dated tomorrow is a typo or a plan filed under
 * the wrong status, and either way it cannot answer "how long since you were in the water", so
 * this reads the most recent logged dive **on or before `today`** rather than the maximum date
 * outright. Without that the figure would be negative, and a diver would be told they had
 * dived in the future.
 *
 * `today` is a parameter and not a call to `todayCalendarDate()`, so this stays a pure function
 * of two values and its tests need no clock — the same shape `carryOverFrom` uses for the same
 * reason. The screen passes the device's own answer.
 *
 * A date this build cannot read is skipped rather than guessed at (`daysBetweenCalendarDates`
 * refuses `'2026-02-30'`, which `Date.parse` would silently accept two days late), and `null`
 * comes back when no logged dive is left — a logbook of plans only, which is a real state and
 * not an error.
 */
export function currency(dives: readonly DiveCurrency[], today: string): Currency | null {
  if (!Array.isArray(dives)) return null;

  let lastDate: string | null = null;
  let days = 0;
  for (const d of dives) {
    if (!d || d.status !== 'logged') continue;
    const gap = daysBetweenCalendarDates(d.date, today);
    if (gap === null || gap < 0) continue;
    if (lastDate === null || gap < days) {
      lastDate = d.date;
      days = gap;
    }
  }
  if (lastDate === null) return null;
  return { lastDate, days, refresher: days >= REFRESHER_AFTER_DAYS };
}

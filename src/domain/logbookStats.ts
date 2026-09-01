import { isDisplayableDepth } from '../format/display';
import { type Dive } from './types';

/**
 * **The three figures DESIGN.md §3 gives the Stats tab** — *"total dives, hours underwater,
 * deepest dive"* — computed in one place, in SI, with no formatting and no unit system in
 * sight.
 *
 * It exists as a domain owner rather than as a `useMemo` inside `DivesScreen` because there
 * are already two callers for it: the summary line under the Dives title (§0.6 — `128 dives ·
 * 96 h 12 min · deepest 41.2 m`), and M3's Stats screen, which renders the same three numbers
 * on a screen of its own. §4.1's defining defect is one rule written in two places and then
 * drifting; two independent counts of "how many dives have I done" that disagree by the
 * planned dive a diver set up on the boat is exactly the shape that table exists to name.
 *
 * `format/display.ts` turns this into the sentence a diver reads (`formatLogbookSummary`), and
 * `format/units.ts` decides what a metre reads as. Nothing here knows either.
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

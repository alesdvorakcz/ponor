import { type NewSiteFacts } from './diveFormSchema';
import { type DiveSite } from './types';

/**
 * **What a site tells the dive logged at it** — DESIGN.md §2.1's *"picking a site prefills
 * entry, salinity, and water body from the site's own defaults — and those win over
 * carry-over when you switch sites"*, as the one rule that decides it.
 *
 * §2.3 built the other direction first: `siteFactsFrom` (domain/diveFormSchema.ts) decides
 * what a dive may tell a brand-new community record. This is the return trip, and M2r found
 * that it did not exist — the plan has read as done since M0 while nothing read a site's
 * three columns back.
 *
 * **Its siblings, named because §4.1 asks a near-duplicate to name them.** `carryOverFrom`
 * (domain/carryOver.ts) owns *what carries from the previous dive*, and this module never
 * decides that — it is handed carry-over's answer and only decides what outranks it.
 * `db/catalogue.ts` owns *reading* the site row, and this module never reads one: it takes
 * the three columns and nothing else, so it is pure and a test needs no database.
 */

/**
 * **The three columns a site speaks for.**
 *
 * They are §2.2's own list — *"Entry, salinity and water body… are properties of the place"* —
 * and they are exactly the facts a new site inherits from the dive that created it (§2.3),
 * **minus the pin**. That asymmetry is the decision rather than an oversight, and the tie
 * below is what keeps it one: a dive's pin goes UP to a site it creates, because a site with
 * no location is a site nobody can find, and a site's pin never comes DOWN to a dive, because
 * §2.1 puts the exact GPS point in the fresh half — *"the site carries, which is the right
 * granularity, but the exact entry position is a claim of precision that a stale value would
 * make falsely"*. Nor `max_depth_m`: §6 calls that the site's own depth, and a site is not
 * making a claim about how deep this dive went.
 *
 * `as const`, so the members stay literals and `SiteDefaultField` below *is* this list rather
 * than a second copy of it — the pattern `SUGGESTED_FIELDS` (domain/suggest.ts) records.
 */
export const SITE_DEFAULT_FIELDS = ['entry', 'salinity', 'waterBody'] as const;

export type SiteDefaultField = (typeof SITE_DEFAULT_FIELDS)[number];

/** The part of a catalogue row this rule reads, and the whole of it. `Pick`ed off `DiveSite`,
 * so a column that changes type breaks the build here rather than being read as the wrong
 * thing — the same tie `NewSiteFacts` draws for the opposite direction. */
export type SiteDefaults = Pick<DiveSite, SiteDefaultField>;

/**
 * Type-level proof that the two directions name one list — what a dive tells a new site
 * (`NewSiteFacts`) minus its `name` and its pin **is** what a site tells a dive.
 *
 * §4.1's *"derive, or tie at compile time"*, and the tie rather than the derivation because a
 * fourth site fact is a decision in both directions and neither answer follows from the other:
 * adding one to `NewSiteFacts` should make somebody choose, and a compile error is how they
 * are asked. Without this the two lists agree today and drift the day either grows — which is
 * exactly how this half came to be unbuilt while §2.1 read as done.
 */
type SpokenSiteFact = Exclude<keyof NewSiteFacts, 'name' | 'latitude' | 'longitude'>;
type Assert<T extends true> = T;
export type SiteDefaultsAreSiteFactsWithoutThePin = Assert<
  (SiteDefaultField extends SpokenSiteFact ? true : false) extends true
    ? (SpokenSiteFact extends SiteDefaultField ? true : false)
    : false
>;

/** What one row should hold once the dive is paired to a site, and where that came from. */
export interface SiteDefaultFill {
  readonly field: SiteDefaultField;
  /** The value to write. `null` where neither the site nor carry-over says anything, which is
   * a real blank rather than an absence — the row genuinely holds nothing. */
  readonly value: string | null;
  /**
   * Whether the **site** is what put it there, as opposed to carry-over.
   *
   * It is deliberately false when the site and carry-over say the *same* thing, and that is
   * the point of it rather than an accident of the comparison: §0.6's return mark means "this
   * came from your last dive", §0.6 drops it on *overwriting*, and a site agreeing with
   * carry-over has overwritten nothing. The value is still the diver's last dive's value and
   * the row is still right to say so.
   */
  readonly fromSite: boolean;
}

/** Everything carry-over put in these three rows, as the form holds it — `unknown` because
 * `DiveFormInput`'s picked fields are (a value from a client this build does not know is
 * stored and flagged, never refused: §10, `optionalPicked`). Read through `stated` below
 * rather than trusted. */
export type InheritedValues = { readonly [F in SiteDefaultField]?: unknown };

/**
 * **What a nullable text column actually says**, or `null` for every way of saying nothing.
 *
 * A `null` default means *the catalogue does not know*, not *the answer is empty* — so a site
 * with nothing to say must not be read as saying "none". Whitespace is the same silence
 * written differently, and a non-string is a row the database handed back that this build
 * cannot read: it costs that one column's opinion rather than the gesture, the rule
 * `nearMatches` and `suggestFrom` (domain/suggest.ts) already follow over the same tables.
 *
 * **Its sibling** is `hasCarriedValue` (DiveFormScreen.tsx), which asks the same shape of
 * question of *any* form value and answers **true** for `0`, `false` and `[]` — because a
 * diver who dove with zero weight really did answer that. None of the three can reach these
 * columns, which is why this one is narrower and states so rather than being widened to match.
 */
function stated(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * **§2.1's precedence, in the three tiers it really has**, for a dive that has just been
 * paired to `site` (or unpaired from one, which is `site === null`).
 *
 * 1. **What the diver typed wins over everything**, so a typed field gets no fill at all — it
 *    is absent from the answer rather than present and unchanged, because "leave this alone"
 *    and "write this same value again" are different instructions to the form. `typed` is
 *    `SeedState.typed` (DiveFormScreen.tsx), which counts *clearing* as a gesture too: a diver
 *    who threw the water body away on purpose does not get it back by picking a site.
 * 2. **A site default beats a carried value** — §2.1's own sentence, and the reason the rule
 *    exists: the site is a better authority on its own water than last week's dive somewhere
 *    else.
 * 3. **Carry-over fills what is left.**
 *
 * **The answer is a function of those three and of nothing else** — not of which sites the
 * diver visited on the way here. That is what makes switching sites work: a value the first
 * site supplied and the second does not falls back to *carry-over*, never to the first site's
 * leftovers. A rule that accumulated would make the form depend on the order sites were
 * picked in — picking A then B would give a different dive from picking B — and it would seed
 * a site created afterwards (§2.3, `siteFactsFrom`) with a *neighbouring catalogue row's*
 * defaults under the diver's name, which is a worse thing to publish than a stale one.
 *
 * A `site` of `null` is therefore not a special case but the same rule with tier 2 empty: the
 * dive has no site, so carry-over answers. It covers both the diver typing over the name and
 * every way the row cannot be read at all — never pulled, tombstoned, merged or hidden — which
 * is what §1 needs of it (*"never block a save"*): there is no arrangement of catalogue rows
 * that makes this fail rather than answer.
 */
export function siteDefaultFills(
  site: SiteDefaults | null,
  inherited: InheritedValues,
  typed: ReadonlySet<string>,
): SiteDefaultFill[] {
  const fills: SiteDefaultFill[] = [];
  for (const field of SITE_DEFAULT_FIELDS) {
    if (typed.has(field)) continue;
    const carried = stated(inherited[field]);
    const supplied = site === null || site === undefined ? null : stated(site[field]);
    fills.push({ field, value: supplied ?? carried, fromSite: supplied !== null && supplied !== carried });
  }
  return fills;
}

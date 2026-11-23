import { type NewSiteFacts } from './diveFormSchema';
import { type DiveSite } from './types';
import { wordsOf } from './words';

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
 * the same tie `NewSiteFacts` draws for the opposite direction. **It does not by itself break the
 * build when a column changes type**: `stated` reads every value as `unknown`, so when #31 made a
 * site's entry a set this compiled unchanged and read the list as silence. The entry is read by
 * `siteDefaultValue` below, by name, for that reason. */
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
  /**
   * Whether the **water body** is what put it there (#53): the salinity a water body implies when
   * nothing said otherwise for that same water — fresh for every water body but the ocean. The
   * form says so at the row's end (*from the water body*) rather than with a carried mark, because
   * the value is not the last dive's. Only ever true for `salinity`, and never together with
   * `fromSite`.
   */
  readonly fromWaterBody: boolean;
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
 * **What a site says about one of the dive's three rows** — the column through `stated`, except
 * the entry, which on a site is a set (#31, §6): every way in it offers, where the dive's entry is
 * the one way it used.
 *
 * **Exported because the site's own page reads it too** (`DiveSiteScreen`'s note under *The site*):
 * the note names a row only when this answers for it, so it can never say picking the site fills in
 * a row the prefill below leaves alone.
 *
 * **A set answers only when it holds exactly one way in.** *"The site offers what is possible; the
 * dive logs which one was done"* (the owner, #31): a site entered from the shore and from a boat
 * cannot say which of the two this dive was, so it says nothing, as a site that knows nothing
 * does, and the row is left to the diver and to carry-over. A set of one word is the site's answer.
 *
 * **What is counted is the set's words** (`wordsOf`, domain/words.ts), the reading the site's page
 * draws its ways-in tiles from, so the page and the prefill cannot count the same set differently
 * (PR #72's review): `['', 'shore']` is one way in on both, *Shore*. Its one word may be a word
 * this build does not know; a member that is not a word (a number, a `null`, a blank) is not
 * counted; and a set of no words, or anything that is not a list, says nothing — a pulled row is
 * whatever the server sent. **A word stored twice counts twice** (`['shore', ' shore']`), as the
 * page draws it twice (`siteTiles` keys its tiles by position, #6), so the two still agree: two
 * tiles, no answer. No writer in this app stores one, since `TokenChips` toggles a set, so
 * deduplicating here would answer for a page that does not (PR #72's re-review, left as is).
 * (Picking the dive's entry from the site's options is #63's, not this rule's.)
 */
export function siteDefaultValue(site: SiteDefaults, field: SiteDefaultField): string | null {
  if (field !== 'entry') return stated(site[field]);
  const ways = wordsOf(site.entry);
  return ways.length === 1 ? ways[0]! : null;
}

/** Where a salinity came from: the diver's own hand, the site, what the dive inherited
 * (carry-over, the stored dive, or the dive handed to *New dive site*), or the water body. */
export type SalinitySource = 'typed' | 'site' | 'inherited' | 'waterBody';

/** What the Salinity row holds, where it came from, and whether it is drawn at all. */
export interface SalinityAnswer {
  /** The salinity, or `null` for a row that holds nothing. */
  readonly value: string | null;
  /** Where it came from; `null` exactly when `value` is. */
  readonly source: SalinitySource | null;
  /** `false` for the ocean, whose row is not drawn: its salinity is salt and nothing to ask. */
  readonly shown: boolean;
}

/**
 * **The water body sets the salinity** (#53, the owner's call of 2026-11-19): whatever sets the
 * water body — the diver tapping one, a site, or carry-over — sets the salinity with it.
 *
 * Decided in this order, and the first that answers wins:
 *
 * 1. **The ocean is salt**, and its row is not drawn. Nothing outranks it, not even a value set by
 *    hand: a hidden row holding *fresh* would be a fact the diver can neither see nor change.
 * 2. **The site's own salinity**, when it states one for this water body or names no water body at
 *    all. A site that says *Lake · Salt* is a salt lake, and the dive logged there is in one. Above
 *    a value set by hand, because a site sets what it knows (the owner's call of 2026-11-23); a
 *    site that says salt about a lake says nothing about the river the diver tapped instead.
 * 3. **A salinity the diver set by hand and still in force** — `typed` is `undefined` when none
 *    is. The caller decides whether it is still in force: it lasts until the water body changes.
 *    A cleared one is in force too, as an empty row.
 * 4. **What the dive inherited**, when it was for this same water body: a salt lake carries over as
 *    Lake · Salt, and the same salt does not follow the diver into a river.
 * 5. **Fresh**, for any water body nothing above spoke for — every one but the ocean is fresh
 *    unless somebody says otherwise (a sea cave, a salt lake).
 * 6. **No water body is today's rule**: the inherited salinity, whatever water it was for, or
 *    nothing.
 *
 * Pure, and a function of its four inputs alone — the same shape `siteDefaultFills` keeps, for
 * the same reason (M2s): a rule that remembered which water bodies the form had passed through
 * would answer differently for the same dive depending on the order of taps.
 */
export function salinityFor({
  waterBody,
  typed,
  site,
  inherited,
}: {
  waterBody: unknown;
  typed: unknown;
  site: SiteDefaults | null;
  inherited: InheritedValues;
}): SalinityAnswer {
  const water = stated(waterBody);
  if (water === 'ocean') return { value: 'salt', source: 'waterBody', shown: false };
  const siteSalinity = site === null || site === undefined ? null : stated(site.salinity);
  const siteWater = site === null || site === undefined ? null : stated(site.waterBody);
  if (siteSalinity !== null && (siteWater === null || siteWater === water)) {
    return { value: siteSalinity, source: 'site', shown: true };
  }
  if (typed !== undefined) return { value: stated(typed), source: 'typed', shown: true };
  const inheritedSalinity = stated(inherited.salinity);
  if (inheritedSalinity !== null && stated(inherited.waterBody) === water) {
    return { value: inheritedSalinity, source: 'inherited', shown: true };
  }
  if (water !== null) return { value: 'fresh', source: 'waterBody', shown: true };
  return inheritedSalinity === null
    ? { value: null, source: null, shown: true }
    : { value: inheritedSalinity, source: 'inherited', shown: true };
}

/** What a site pick writes, and which of the diver's own values it overrode. */
export interface SiteDefaultAnswer {
  /** One per row the pick writes. A row it leaves to the diver is absent, not present and unchanged. */
  readonly fills: SiteDefaultFill[];
  /** The rows the diver had set by hand that this pick overrode — the caller stops counting them as
   * the diver's, so the next pick reads them as the site's or carry-over's like any other. */
  readonly released: SiteDefaultField[];
}

/**
 * **Site, water body and salinity are a hierarchy, and setting a parent sets its children** — the
 * owner's call on #53 (2026-11-19, and widened to the site on 2026-11-23), for a dive that has just
 * been paired to `site` (or unpaired from one, which is `site === null`).
 *
 * 1. **A site sets what it knows** — its water body, its entry when it offers exactly one way in,
 *    its salinity — over a value the diver set by hand. This reverses §2.1's tier one, which kept
 *    every typed value whatever the site said, and §10 records why: the diver who picks a site has
 *    said where they are, and a value set for the place they were before belongs to that place.
 * 2. **What the site doesn't know, the diver's value keeps.** A site that says nothing about a row
 *    leaves a value set by hand where it is.
 * 3. **Carry-over fills what is left** (`inherited`: the previous dive in create mode, the stored
 *    dive in edit mode). A value the previous site filled falls back to it, never to that site's
 *    leftovers — the M2s property, unchanged.
 * 4. **The salinity follows the water body that leaves** (`salinityFor`). A salinity set by hand
 *    lasts only while the water body is the one it was set for.
 *
 * `current` is what the form holds now, for the rows the diver set (it defaults to `inherited`,
 * which is what an untouched form holds). `keep` names the rows the diver touched after the pick
 * began, while the site read was out: the latest gesture wins, so the site overrides none of them,
 * and a kept salinity stays in force whatever the water body.
 *
 * **The answer is a function of these inputs and of nothing else** — not of which sites the diver
 * visited on the way here — which is what makes switching sites work and what keeps a site created
 * afterwards (§2.3, `siteFactsFrom`) from being seeded with a neighbouring catalogue row's
 * defaults under the diver's name.
 *
 * A `site` of `null` is not a special case but the same rule with the site's tier empty: it covers
 * the diver typing over the name and every way the row cannot be read at all — never pulled,
 * tombstoned, merged or hidden — which is what §1 needs of it (*"never block a save"*).
 */
export function siteDefaultFills(
  site: SiteDefaults | null,
  inherited: InheritedValues,
  typed: ReadonlySet<string>,
  current: InheritedValues = inherited,
  keep: ReadonlySet<string> = new Set<string>(),
): SiteDefaultAnswer {
  const fills: SiteDefaultFill[] = [];
  const released: SiteDefaultField[] = [];
  for (const field of ['entry', 'waterBody'] as const) {
    const supplied = site === null || site === undefined || keep.has(field) ? null : siteDefaultValue(site, field);
    const carried = stated(inherited[field]);
    if (supplied !== null) {
      if (typed.has(field)) released.push(field);
      fills.push({ field, value: supplied, fromSite: supplied !== carried, fromWaterBody: false });
    } else if (!typed.has(field)) {
      fills.push({ field, value: carried, fromSite: false, fromWaterBody: false });
    }
  }
  const waterFill = fills.find((fill) => fill.field === 'waterBody');
  const water = waterFill === undefined ? stated(current.waterBody) : waterFill.value;
  const handSet = typed.has('salinity');
  const inForce = handSet && (keep.has('salinity') || water === stated(current.waterBody));
  // A salinity tapped while the read was out is the latest gesture and outranks the site — but not
  // the ocean, which `salinityFor` answers before anything else.
  const answer =
    keep.has('salinity') && water !== 'ocean'
      ? { value: stated(current.salinity), source: 'typed' as const, shown: true }
      : salinityFor({ waterBody: water, typed: inForce ? current.salinity : undefined, site, inherited });
  if (answer.source !== 'typed') {
    if (handSet) released.push('salinity');
    fills.push({
      field: 'salinity',
      value: answer.value,
      fromSite: answer.source === 'site' && answer.value !== stated(inherited.salinity),
      fromWaterBody: answer.source === 'waterBody',
    });
  }
  released.sort();
  return { fills, released };
}

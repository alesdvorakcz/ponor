import { compareDiveOrder } from './diveNumber';
import { foldForMatching } from './search';
import { type Dive, type DiveSite } from './types';

/**
 * The fields autocomplete covers, as **values** — DESIGN.md §2.3 names exactly these four:
 * "Typing a site or center searches your own history first... Buddies and guides autocomplete
 * from your own past entries only."
 *
 * A list and the union of its members are one fact, so the type below is *derived* from this
 * array rather than written beside it — the pattern `domain/types.ts` records at length for
 * its own `*_VALUES` arrays, where three hand-kept copies of one vocabulary produced a chip
 * the diver never saw and no build error to say so. `SuggestedField` cannot disagree with
 * `SUGGESTED_FIELDS` because it *is* `SUGGESTED_FIELDS`.
 *
 * `title` and `notes` are deliberately absent, and that is the whole difference between this
 * list and `SEARCHABLE_FIELDS` (domain/search.ts), which does include them. Those two are
 * prose a diver writes once about one dive; these four are *names* a diver reuses, and only a
 * name is worth offering back. Suggesting a past dive's notes would put a whole sentence
 * about a different dive into this one.
 *
 * `as const`, so the members stay literals — without it every one widens to `string` and the
 * derived type says nothing at all.
 */
export const SUGGESTED_FIELDS = ['siteName', 'centerName', 'buddy', 'guide'] as const;

export type SuggestedField = (typeof SUGGESTED_FIELDS)[number];

/**
 * One offer: the text to put in the field, and the id that belongs with it.
 *
 * `id` is the second half of DESIGN.md §6's `site_id` + `site_name` **snapshot pair**, and
 * it is the reason this is an object rather than a bare string. §10's own entry for this
 * task: "picking a suggestion sets both together and typing over a name clears the id —
 * otherwise a dive carries one site's id under another's name, which is latent while every
 * id is null and becomes wrong the day M2 fills them in."
 *
 * Always `null` for `buddy` and `guide`, which have no id column at all — §2.3: "they stay
 * private text, not user accounts."
 */
export interface Suggestion {
  value: string;
  id: string | null;
}

/**
 * The id column that pairs with each suggested field, or `null` for a field that has none.
 *
 * A `Record` keyed by `SuggestedField` rather than a lookup written per call site, and typed
 * so the compiler fills the gap the day a fifth field joins `SUGGESTED_FIELDS` above:
 * omitting an entry here is a build error, not a suggestion that silently carries somebody
 * else's id. That is §4.1's "derive, or tie at compile time" — the tie, since which column
 * pairs with which cannot be computed from the name.
 */
const PAIRED_ID_FIELD: Record<SuggestedField, 'siteId' | 'centerId' | null> = {
  siteName: 'siteId',
  centerName: 'centerId',
  buddy: null,
  guide: null,
};

const SUGGESTED_FIELD_SET: ReadonlySet<string> = new Set(SUGGESTED_FIELDS);

/**
 * Whether a form field is one of the four that autocomplete, and which one — so a caller
 * wiring up a row asks this about the field name it already has rather than repeating that
 * name a second time beside it.
 *
 * `DiveFormScreen`'s own `CarryOverControls` docblock draws the same line for the same reason:
 * "asking each call site to repeat its own field name a second time as a plain string next
 * to the `name` prop it already has" is the hand-maintained second list §4.1 warns about,
 * one call site over from the module that owns it. A row can therefore neither claim
 * autocomplete for a field §2.3 does not name, nor draw from the wrong column.
 *
 * Takes a plain `string` rather than a form-field type, so `domain/` does not have to know
 * what a `FieldPath` is; the narrowing is what the caller wanted anyway.
 */
export function asSuggestedField(name: string): SuggestedField | null {
  return SUGGESTED_FIELD_SET.has(name) ? (name as SuggestedField) : null;
}

/**
 * The column holding a suggested field's paired id, or `null` for the two fields that have
 * none. The public half of `PAIRED_ID_FIELD` above — a caller writing the id back into a
 * form needs the same pairing this module reads it with, and a second answer to "which id
 * goes with which name" is exactly the mismatch §10 records for this task.
 */
export function pairedIdField(field: SuggestedField): 'siteId' | 'centerId' | null {
  return PAIRED_ID_FIELD[field];
}

/** How many offers a caller gets unless it asks for a different number. Five is what fits
 * under a focused row without pushing the next field off a phone screen; it is the default
 * rather than a hard cap because the number is a layout judgement, not a rule about what a
 * suggestion is. */
export const SUGGESTION_LIMIT = 5;

/** One distinct value while it is being counted: the spelling and id that won it, how many
 * dives carry it, and how far down the newest-first list its winning dive sat. */
interface Tally {
  value: string;
  id: string | null;
  count: number;
  /** Index in the newest-first pass — smaller is more recent. A position rather than a date,
   * so the recency tier compares one number and never re-derives §2.5's ordering itself. */
  recency: number;
}

/**
 * The id on one dive, as a `Suggestion` carries it: **whatever the dive stores, verbatim.**
 *
 * This deliberately applies no rule about what an empty id means, and that is a correction.
 * It used to normalise `''` to `null` on the reasoning that an empty string is not an id —
 * true, but not this module's rule to state, and stating it here made two answers to one
 * question: `carryOverFrom` copies `siteId`/`centerId` straight across, so a dive with `''`
 * would have carried `''` into a form field and been offered back as `null` by the row
 * directly beneath it. That is §4.1's defect in miniature, and the invented half is this one.
 *
 * There already is an owner. `diveFormSchema.ts`'s `optionalText` turns `''` into `null` at
 * the **write boundary**, which is where "empty means absent" belongs for every text column
 * this form has — so a picked `''` is stored as `null` whatever this function hands back, and
 * one rule decides it for the id, the name, the buddy and the notes alike.
 *
 * The `typeof` check is not that rule wearing a disguise. It is a type guard: `Dive` types
 * both columns as `string | null`, this runs during render over whatever the database handed
 * back, and a column holding a number would otherwise make a `Suggestion` whose `id` is typed
 * `string | null` and is neither.
 */
function pairedId(dive: Dive, field: SuggestedField): string | null {
  const idField = pairedIdField(field);
  if (idField === null) return null;
  const id = dive[idField];
  return typeof id === 'string' ? id : null;
}

/**
 * **Whether the diver has already dived this name at a place the catalogue knows** — that is,
 * whether any dive in `dives` spells `name` the same way (folded) *and* carries a paired id
 * for it.
 *
 * §5 lets any signed-in diver add a site, and M2o gives the form the gesture. This is the half
 * that keeps that gesture from manufacturing the duplicate §2.3's fuzzy check exists to
 * prevent: a name the diver has used before **with an id** already names a community row, so
 * offering to create a second one would publish a duplicate of a site this very logbook can
 * see. A name used before with **no** id is the opposite case and gets no answer from here —
 * it is exactly the site worth adding, and every dive logged before M2o is one of them.
 *
 * ── The sibling, named because §4.1 asks a near-duplicate to name one ─────────────────────
 *
 * `suggestFrom` below walks the same column of the same dives and answers a different
 * question, so the two must not be merged. It asks *which spelling and which id win* — newest
 * dive first, one tally per folded value — because an offer has to be one row with one id.
 * This asks *does any dive at all pair this name*, which is deliberately the stricter reading:
 * a duplicate guard that only consulted the most recent dive would let an older, paired dive
 * be re-created because a newer unpaired one spelled the name the same way.
 *
 * Folding is `foldForMatching`'s (domain/search.ts), so `zelezna` and `Železná` are the same
 * place here exactly as they are everywhere else (§2.3, M2j). An empty or whitespace-only
 * name pairs nothing: there is no such site, and folding it would match every row.
 *
 * Runs during render over the diver's own logbook, like `suggestFrom`, so it may not throw on
 * a row it cannot read — a null entry or a column holding something that is not a string costs
 * one dive's opinion rather than the form.
 */
export function hasPairedId(dives: readonly Dive[], field: SuggestedField, name: string): boolean {
  const wanted = foldForMatching(name);
  if (wanted === '') return false;
  return dives.some((d) => {
    if (d === null || d === undefined) return false;
    const raw = d[field];
    return typeof raw === 'string' && foldForMatching(raw) === wanted && pairedId(d, field) !== null;
  });
}

/**
 * DESIGN.md §2.3's autocomplete, over the diver's own history and nothing else — the one
 * place that decides what a suggestion is and what order suggestions come in.
 *
 * `dives` is the caller's own list, ordinarily `useDives()`'s (the one read every screen
 * uses). This function has no opinion on which dives belong in it: excluding the dive being
 * edited, or a tombstoned row, is the caller's business, exactly as `carryOverFrom` reads
 * whichever dive it is handed without deciding which one that is.
 *
 * **Matching** goes through `foldForMatching` (domain/search.ts) on both sides — trimmed,
 * `toLowerCase()`d, never `toLocaleLowerCase()`, so a match never depends on the viewing
 * device's OS locale, and since M2j **accent-folded**, so a diver typing `zelezna` is offered
 * `Železná` (§10). That last part arrived here for free, and that is the point of reading the
 * shared function rather than writing `trim().toLowerCase()` out again: the fold moved once
 * and both features moved with it. Still a plain substring, deliberately — §10's other half,
 * the fuzzy "did you mean" that stops duplicate sites, is `similar_sites` on the server (§5),
 * where `pg_trgm` lives and where the community catalogue this list cannot see already is.
 *
 * **An empty query is not "no suggestions."** It returns the diver's most-used values for the
 * field — §2.1's "the app learns: pickers order options by your usage frequency" applied to a
 * text field. This is the common case rather than an edge one: carry-over prefills the site,
 * so a focused *empty* site field means the diver has already cleared it and is changing
 * sites.
 *
 * **Ranking, in three tiers.**
 *  1. A value whose folded form *starts with* the query outranks one that merely contains
 *     it. A diver types toward the front of a name.
 *  2. Then usage: how many dives in `dives` carry the value.
 *  3. Then recency, most recent dive first — which is also the only live tier for an empty
 *     query, since every value trivially starts with an empty needle and the counts are what
 *     separate them.
 *
 * Recency is `compareDiveOrder`'s (domain/diveNumber.ts), reversed, and not a fourth
 * hand-written tier list: §2.5's ordering has exactly one owner, and the last time a second
 * one existed (a SQL `ORDER BY` in `listDives`) it had already drifted — missing the
 * `manualOrder` tier and reversing NULL placement for `timeIn`. Sorting here rather than
 * trusting the caller's order is what makes the result a fact about the dives instead of a
 * fact about which screen called: `useDives()` hands its list back newest-first today, and a
 * caller that filters, concatenates or reverses it would silently invert every tie-break.
 *
 * **Distinct values, case-insensitively.** Two dives at "Blue Hole" are one suggestion. When
 * the spellings differ ("blue hole" / "Blue Hole") the one from the **most recent** dive is
 * shown — the diver's latest spelling is the one they have settled on — and both dives count
 * toward its usage, so the site they visit most does not sink below a rival simply for having
 * been typed two ways. **The `id` comes from that same winning dive and never from another
 * one**: the pair is a snapshot of one dive's site (§6), and taking the name from one dive
 * and the id from another manufactures exactly the mismatch the pairing exists to prevent. A
 * winning dive whose own id is `null` therefore yields `null`, even when an older dive
 * spelled the same name and did have one.
 *
 * **The value the field already holds is never offered back — matched on the RAW text.** The
 * query *is* the field's own text, so a carried "Blue Hole" offering "Blue Hole" would be a
 * row of nothing under a field already saying it. That is the whole of the rule, and §2.3
 * states the reason it stops there: *a suggestion is offered when picking it would do
 * something*, which is not the same as when it differs from what was typed.
 *
 * Comparing the **folded** forms said more than that, and cost two offers worth making (M2j
 * found the first and named the second). `zelezna` typed in full folds to the stored
 * `Železná` and was suppressed; `blue hole` had never been offered `Blue Hole` at all. Picking
 * either does something — it sets the paired `site_id` (§6), which typing cleared on the first
 * keystroke, and it writes the catalogue's own spelling into the field. So the suppression is
 * on the raw text and the fold is left to decide matching alone.
 *
 * Both sides are trimmed, because the stored side already is (above) and a trailing space is
 * not a different spelling — that is the one thing the raw comparison still normalises, and it
 * is the same trim `foldForMatching` opens with rather than a second rule about whitespace.
 *
 * `null` and whitespace-only stored values are skipped, never coerced: `String(null)` is
 * `"null"`, which would offer the word "null" as a site and match a diver typing "ull" —
 * `domain/search.ts` documents this exact trap for the same columns.
 *
 * Called during render, like `assignDiveNumbers` over the same array, so nothing here may
 * throw on a row it cannot read: a null/undefined entry (a bad join, a partially-hydrated
 * row) and a field holding something that is not a string both cost one suggestion rather
 * than the whole form.
 */
export function suggestFrom(
  dives: readonly Dive[],
  field: SuggestedField,
  query: string,
  limit: number = SUGGESTION_LIMIT,
): Suggestion[] {
  const needle = foldForMatching(query);
  // The field's own text as it is actually spelled — the *only* thing compared raw. Trimmed,
  // and no further: lowercasing or folding it here would be the folded suppression back under
  // another name, which is what §2.3 moved off.
  const held = query.trim();

  // Newest first, so the FIRST time a folded value is seen is its most recent dive — which
  // is what makes the spelling, the id and the recency rank below all come from one dive
  // without any of them having to be re-decided later.
  const newestFirst = dives.filter((d) => d !== null && d !== undefined).sort((a, b) => compareDiveOrder(b, a));

  const tallies = new Map<string, Tally>();
  newestFirst.forEach((d, index) => {
    const raw = d[field];
    if (typeof raw !== 'string') return;
    const value = raw.trim();
    if (value === '') return;
    const key = foldForMatching(value);
    const seen = tallies.get(key);
    if (seen === undefined) {
      tallies.set(key, { value, id: pairedId(d, field), count: 1, recency: index });
    } else {
      seen.count += 1;
    }
  });

  // Two conditions about two different things, deliberately not one expression: the folded key
  // decides what MATCHES, the raw spelling decides only what is worth OFFERING. Written the
  // other way round — one comparison serving both — is precisely how the fold reached the
  // suppression in the first place.
  const matches = [...tallies].filter(([key, tally]) => key.includes(needle) && tally.value !== held);

  matches.sort(([aKey, a], [bKey, b]) => {
    const aStarts = aKey.startsWith(needle);
    const bStarts = bKey.startsWith(needle);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.recency - b.recency;
  });

  return matches.slice(0, Math.max(limit, 0)).map(([, tally]) => ({ value: tally.value, id: tally.id }));
}

/**
 * **§2.3's fuzzy check, as the list of sites the diver is asked about** — *"before saving a
 * new entry, a fuzzy check suggests near-matches: **Did you mean Shark Point?** One tap picks
 * the existing site instead"* (M2p).
 *
 * Two sources answer that question and this is where they become one list, because they are
 * one question and a screen that merged them itself would be a second place deciding what a
 * duplicate is (§4.1).
 *
 * ── The device's own answer, and why it is exact rather than fuzzy ────────────────────────
 *
 * `onDevice` is the on-device copy of the community catalogue (§5: *"the compact site/center
 * catalogue syncs to every device"*), and a row of it is a near-match here **only when its
 * folded name equals the folded query**. That is deliberately the cheapest possible check and
 * it is the one that works at sea:
 *
 * · It costs one `foldForMatching` per catalogue row — the fold this app already runs over
 *   every dive on every keystroke of §3's search — and no network at all. §1 and §5 both make
 *   a site created out of signal the ordinary case rather than the exceptional one, and this
 *   is the only duplicate check such a diver gets.
 * · It catches exactly what the fold is for: `kotelna` against `Kotelna`, and — since M2j —
 *   `Divoka Sarka` against `Divoká Šárka`, which is the duplicate §5 names.
 * · It **misses** `Sharks Point` against `Shark Point`, and that is the trade rather than an
 *   oversight. Trigram similarity is `pg_trgm`'s, it lives on the server behind
 *   `similar_sites`, and a JavaScript approximation of it would be a second implementation of
 *   the rule that decides what a duplicate *is* — drifting from `public.name_match_floor()`
 *   silently, in the direction nobody can observe. `domain/search.ts` records the same refusal
 *   about `unaccent`'s rule table for the same reason.
 *
 * A substring match would be the tempting middle ground and is wrong: `Kotelna` would be
 * offered as a near-match for `Kotelna II`, which is a different site with a longer name, and
 * the offer would be at its most confident exactly where it was wrong.
 *
 * ── The server's answer ───────────────────────────────────────────────────────────────────
 *
 * `fromServer` is whatever `similar_sites` returned (`cloud/similarSites.ts`), already fuzzy,
 * already folded on both sides, and already narrowed by the dive's pin where it has one. It is
 * **empty whenever the check could not run**, which is a state this function neither knows nor
 * needs to: a diver out of signal gets the device's answer and nothing else.
 *
 * ── Merging ───────────────────────────────────────────────────────────────────────────────
 *
 * The device goes first: a row it can see is a row it can prove exists, and an exact name
 * match is a stronger claim than a trigram score. Then the server's, in its own order (score
 * first — `similar_sites` sorts, and re-sorting here would be a second ranking of the same
 * rows).
 *
 * **Distinct by id**, because the two sources overwhelmingly answer with the *same rows* — the
 * device's copy came down from the server that is being asked. Two rows reading `Did you mean
 * “Kotelna”?` would be one site asked about twice. A candidate with no usable id is dropped
 * rather than kept: the whole point of the one tap is to pair the dive with §6's `site_id`,
 * and a row that cannot supply one has nothing to offer.
 *
 * Capped at `SUGGESTION_LIMIT` for that constant's own reason — these rows sit in the slot the
 * suggestion list owns (§0.6), so how many fit under a focused row is one layout judgement,
 * not two.
 *
 * ── Its siblings, named because §4.1 asks a near-duplicate to name them ───────────────────
 *
 * `hasPairedId` above asks the *same shape* of question — "does this name already name a
 * community row?" — of the diver's **own history**, and is what decides whether the offer to
 * create appears at all. This asks it of the **catalogue**, and is what happens after the
 * diver has pressed that offer. They must not be merged: a name the diver has dived with an
 * id needs no question asked, and a name the catalogue holds needs one asked *and answered
 * with a row to tap*.
 *
 * `suggestFrom` below matches on a **substring** and this on **equality**, over different
 * populations, and that difference is the paragraph above.
 *
 * Runs over rows the database handed back, so a row it cannot read costs one candidate rather
 * than the whole gesture — the rule `suggestFrom` and `hasPairedId` both follow.
 */
export function nearMatches(
  name: string,
  onDevice: readonly DiveSite[],
  fromServer: readonly Suggestion[],
  limit: number = SUGGESTION_LIMIT,
): Suggestion[] {
  const wanted = foldForMatching(name);
  // An empty name names no site, and folding it would equal every empty stored name. The same
  // guard `hasPairedId` carries, for the same reason.
  if (wanted === '') return [];

  const local: Suggestion[] = [];
  for (const site of onDevice) {
    if (site === null || site === undefined) continue;
    const value = typeof site.name === 'string' ? site.name.trim() : '';
    if (value === '' || foldForMatching(value) !== wanted) continue;
    local.push({ value, id: typeof site.id === 'string' ? site.id : null });
  }

  const seen = new Set<string>();
  const merged: Suggestion[] = [];
  for (const candidate of [...local, ...fromServer]) {
    const id = candidate.id;
    if (id === null || id === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(candidate);
  }

  return merged.slice(0, Math.max(limit, 0));
}

import { dive } from './diveFixture';
import { foldForMatching, searchDives } from './search';

describe('searchDives', () => {
  // Review task 7, cannot-fail #1: `toHaveLength(2)` can't tell "returned `dives` itself,
  // unfiltered" apart from "filtered with an empty needle" when every fixture dive has a
  // non-null searchable field — mutating `if (trimmed === '')` to `if (query === '')` (so a
  // whitespace query is no longer treated as inactive) survived, because `''.includes('')`
  // is still true for every dive here. `toBe(all)` pins the actual documented contract —
  // "an empty or whitespace-only query returns dives itself, unfiltered" (this file's own
  // docblock) — which is a claim about identity, not just count, and which the mutation
  // above genuinely breaks: a whitespace query would then run the real filter and return a
  // freshly-allocated array instead of the original reference.
  it('returns everything for an empty or whitespace query', () => {
    const all = [dive({ siteName: 'Blue Hole' }), dive({ siteName: 'Shark Reef' })];
    expect(searchDives(all, '')).toBe(all);
    expect(searchDives(all, '   ')).toBe(all);
  });

  it('matches a site name case-insensitively', () => {
    const all = [dive({ siteName: 'Blue Hole' }), dive({ siteName: 'Shark Reef' })];
    expect(searchDives(all, 'blue')).toHaveLength(1);
  });

  it('matches buddy, centre, title and notes as well as site', () => {
    expect(searchDives([dive({ buddy: 'Petra' })], 'petra')).toHaveLength(1);
    expect(searchDives([dive({ centerName: 'Dive Centre' })], 'centre')).toHaveLength(1);
    expect(searchDives([dive({ title: 'Night dive' })], 'night')).toHaveLength(1);
    expect(searchDives([dive({ notes: 'saw a turtle' })], 'turtle')).toHaveLength(1);
  });

  it('matches Czech diacritics case-insensitively', () => {
    expect(searchDives([dive({ siteName: 'Šenkýřův lom' })], 'šenkýřův')).toHaveLength(1);
    expect(searchDives([dive({ siteName: 'Šenkýřův lom' })], 'ŠENKÝŘŮV')).toHaveLength(1);
  });

  // §10's rule, at the level a diver meets it: the accents are typed on neither side, or on
  // one side, or on the other, and all four spellings find the dive. **Both directions are
  // asserted deliberately** — a fold applied to the needle alone passes the first line and
  // fails the third, and that is the half that would ship, because the query is the string a
  // developer is thinking about while they write it.
  it('finds a Czech name typed without its accents, in either direction (§10)', () => {
    const zelezna = [dive({ siteName: 'Železná' })];
    expect(searchDives(zelezna, 'zelezna')).toHaveLength(1);
    expect(searchDives(zelezna, 'Železná')).toHaveLength(1);
    expect(searchDives([dive({ siteName: 'Zelezna' })], 'Železná')).toHaveLength(1);
    // Two accents rather than one, which is the case §5's server half measured as falling
    // through the trigram floor: `Sarka`/`Šárka` scored 0.333 against a cut-off of 0.3.
    expect(searchDives([dive({ siteName: 'Divoká Šárka' })], 'divoka sarka')).toHaveLength(1);
  });

  it('folds the accents off notes and buddies too, not only site names', () => {
    // The fold belongs to `foldForMatching`, so it reaches every one of SEARCHABLE_FIELDS at
    // once. Asserted on a second field so that "the fold is in the shared function" is what is
    // under test rather than "siteName happens to fold".
    expect(searchDives([dive({ buddy: 'Tomáš Růžička' })], 'ruzicka')).toHaveLength(1);
  });

  it('matches a dive whose fields are all null without throwing', () => {
    expect(searchDives([dive({})], 'anything')).toHaveLength(0);
  });

  it('preserves the input order', () => {
    const all = [dive({ date: '2026-08-18', siteName: 'Reef' }), dive({ date: '2026-08-16', siteName: 'Reef' })];
    expect(searchDives(all, 'reef').map((d) => d.date)).toEqual(['2026-08-18', '2026-08-16']);
  });

  it('folds case without depending on the device locale', () => {
    // toLocaleLowerCase() reads the host device's OS locale, which is
    // independent of the app's content languages — that makes matching
    // non-deterministic across devices for identical, synced data. Asserting
    // the locale-sensitive method is never called pins the implementation to
    // toLowerCase() without needing a locale-specific (e.g. Turkish) fixture.
    const spy = jest.spyOn(String.prototype, 'toLocaleLowerCase');
    try {
      expect(searchDives([dive({ siteName: 'Blue Hole' })], 'BLUE')).toHaveLength(1);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('foldForMatching — §10\'s diacritic fold, and exactly where it stops', () => {
  it('drops the accents Czech is written with', () => {
    expect(foldForMatching('Železná')).toBe('zelezna');
    expect(foldForMatching('Divoká Šárka')).toBe('divoka sarka');
    expect(foldForMatching('Šenkýřův lom')).toBe('senkyruv lom');
  });

  it('reads a decomposed spelling as the same text as a precomposed one', () => {
    // The same name, two byte sequences: an iOS keyboard gives the precomposed form and a
    // paste out of macOS gives the decomposed one. Without the `normalize('NFD')` call the
    // second folds to `zelezna` and the FIRST folds to `železná` — the marks are not there to
    // be stripped — so this is the assertion that line exists for.
    const decomposed = 'Železná'.normalize('NFD');
    expect(decomposed).not.toBe('Železná');
    expect(foldForMatching(decomposed)).toBe(foldForMatching('Železná'));
    expect(foldForMatching(decomposed)).toBe('zelezna');
  });

  it('leaves marks that are not accents on a Latin letter alone', () => {
    // Why the character class is U+0300–U+036F (Combining Diacritical Marks) and not the
    // wider `\p{Mn}`, which also covers the Devanagari virama below and Arabic harakat, where
    // the mark
    // is part of what the letter says rather than an accent on it — and Postgres' `unaccent`
    // leaves those alone. Widening the class would therefore MANUFACTURE a disagreement
    // between the two halves of this feature. `\p{Mn}` fails this line.
    expect(foldForMatching('हिन्दी')).toBe('हिन्दी');
  });

  /**
   * **Where this fold and Postgres' `unaccent` part company.**
   *
   * They are not the same function and cannot be made so: NFD strips *combining marks*, and
   * `unaccent` applies a *rule table* that also rewrites letters which have no decomposition
   * at all. Every row here is a query where one side of DESIGN.md §2.3 would find a row the
   * other would not — the §4.1 defect arriving in a form no single-language test can see —
   * so each is pinned by name, and "fixing" one means editing this list on purpose.
   *
   * **`server` is documentation, not an assertion.** No Postgres runs in this repository and
   * none can (supabase/README.md, "Keys"), so what `unaccent` really returns for these four
   * is the owner's to confirm; the M2j report carries the one `select` that prints it. What
   * IS asserted is the client column, and that it is not the server's — which is the fact a
   * future reader needs, since the tempting repair is to hand-copy `unaccent.rules` into
   * JavaScript and thereby keep a second copy of a dictionary Postgres itself calls mutable.
   */
  const DIVERGENCES: readonly { input: string; client: string; server: string; why: string }[] = [
    {
      input: 'Køge',
      client: 'køge',
      server: 'koge',
      why: 'A stroke through the letter, not a mark above it: U+00F8 has no decomposition.',
    },
    {
      input: 'Straße',
      client: 'straße',
      server: 'strasse',
      why: 'unaccent expands one letter into two; a normalisation form never changes length that way.',
    },
    {
      input: 'Ærø',
      client: 'ærø',
      server: 'aero',
      why: 'A ligature and a stroke, and neither of them is a combining mark.',
    },
    {
      input: 'Łódź',
      client: 'łodz',
      server: 'lodz',
      why: 'The two accents fold on both sides; the barred l folds only on the server.',
    },
  ];

  it.each(DIVERGENCES)('folds $input to $client and not to $server, on purpose', ({ input, client, server }) => {
    expect(foldForMatching(input)).toBe(client);
    expect(foldForMatching(input)).not.toBe(server);
  });

  it('states a reason for every divergence it records', () => {
    // The list is the deliverable, so an entry added without its reason is an entry the next
    // reader cannot act on — the same shape as the RPC parity test's REFUSED map.
    expect(DIVERGENCES.length).toBeGreaterThan(3);
    expect(DIVERGENCES.filter((row) => row.why.trim().length < 20)).toEqual([]);
    expect(DIVERGENCES.filter((row) => row.client === row.server)).toEqual([]);
  });
});

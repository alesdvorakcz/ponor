import { dive } from './diveFixture';
import { searchDives } from './search';

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

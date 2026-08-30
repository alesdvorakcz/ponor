import { dive } from './diveFixture';
import { searchDives } from './search';

describe('searchDives', () => {
  it('returns everything for an empty or whitespace query', () => {
    const all = [dive({ siteName: 'Blue Hole' }), dive({ siteName: 'Shark Reef' })];
    expect(searchDives(all, '')).toHaveLength(2);
    expect(searchDives(all, '   ')).toHaveLength(2);
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

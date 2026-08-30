import { dive } from './diveFixture';
import { canReorder, groupIntoTrips, sameDateGroups, splitPlanned } from './trips';

describe('splitPlanned', () => {
  it('separates planned from logged, preserving order within each', () => {
    const input = [
      dive({ date: '2026-08-20', status: 'planned' }),
      dive({ date: '2026-08-18' }),
      dive({ date: '2026-08-16' }),
    ];
    const { planned, logged } = splitPlanned(input);
    expect(planned.map((d) => d.date)).toEqual(['2026-08-20']);
    expect(logged.map((d) => d.date)).toEqual(['2026-08-18', '2026-08-16']);
  });
});

describe('groupIntoTrips', () => {
  it('groups consecutive days at the same site into one trip', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-18', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-17', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.dives).toHaveLength(3);
    expect(trips[0]?.title).toBe('Blue Hole');
    expect(trips[0]?.dateRange).toBe('16–18 Aug 2026');
  });

  // DESIGN.md §10 ("A trip is one dive centre, with gaps of up to 3 days"): a boat day
  // out of one centre visits several wrecks, so the SITE changing mid-trip must not
  // split it. This is the precedence test — both dives carry a siteName as well, so it
  // fails against the old `siteName ?? centerName` key, which would see two different
  // places and cut the trip in half.
  it('keeps one centre’s dives together even when each is at a different site', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-16', centerName: 'Subic Divers', siteName: 'USS New York' }),
      dive({ date: '2026-08-16', centerName: 'Subic Divers', siteName: 'El Capitan' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.dives).toHaveLength(2);
    expect(trips[0]?.title).toBe('Subic Divers');
  });

  it('starts a new trip when the centre changes, even on the same day', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-16', centerName: 'Subic Divers', siteName: 'USS New York' }),
      dive({ date: '2026-08-16', centerName: 'Reef Divers', siteName: 'USS New York' }),
    ]);
    expect(trips).toHaveLength(2);
    expect(trips.map((t) => t.title)).toEqual(['Subic Divers', 'Reef Divers']);
  });

  // The gap boundary, pinned on both sides of the same threshold rather than at some
  // value far past it: 3 days is the last gap that still merges (a rest day mid-week
  // must not split a trip), 4 is the first that does not.
  it('merges dives three days apart, so a rest day does not split a trip', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-19', centerName: 'Reef Divers' }),
      dive({ date: '2026-08-16', centerName: 'Reef Divers' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.dives).toHaveLength(2);
  });

  it('starts a new trip once the gap reaches four days', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-20', centerName: 'Reef Divers' }),
      dive({ date: '2026-08-16', centerName: 'Reef Divers' }),
    ]);
    expect(trips).toHaveLength(2);
  });

  it('keeps several dives on one day in one trip', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-16', siteName: 'Blue Hole', timeIn: '14:00' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole', timeIn: '09:00' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.dateRange).toBe('16 Aug 2026');
  });

  it('groups dives with no site name at all, rather than dropping them', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-17' }),
      dive({ date: '2026-08-16' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.dives).toHaveLength(2);
    expect(trips[0]?.title).toBe('Unnamed site');
  });

  // The other half of the key rule: a dive with no centre still groups by its site, so
  // shore diving — where nobody records a centre — groups exactly as it did before §10's
  // revision. Both halves need pinning, because a key that simply ignored `siteName`
  // would pass every centre-based test above and merge every unnamed shore dive here.
  it('falls back to the site for a dive with no centre', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-17', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.dives).toHaveLength(2);
    expect(trips[0]?.title).toBe('Blue Hole');
  });

  it('starts a new trip for two centre-less dives at different sites', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-17', siteName: 'Shark Reef' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(trips).toHaveLength(2);
    expect(trips.map((t) => t.title)).toEqual(['Shark Reef', 'Blue Hole']);
  });

  it('does not merge a named site with an unnamed one', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-17', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16' }),
    ]);
    expect(trips).toHaveLength(2);
  });

  it('gives every trip a distinct key', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-20', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(new Set(trips.map((t) => t.key)).size).toBe(2);
  });

  it('returns nothing for no dives', () => {
    expect(groupIntoTrips([])).toEqual([]);
  });
});

describe('sameDateGroups', () => {
  // Three dives, two of them sharing a date, so a comparator that merged
  // everything (or nothing) can't pass this by coincidence — the middle
  // group boundary has to land in the right place.
  it('groups consecutive dives sharing one date, separately from the rest', () => {
    const a = dive({ id: 'a', date: '2026-08-16' });
    const b = dive({ id: 'b', date: '2026-08-16' });
    const c = dive({ id: 'c', date: '2026-08-17' });
    expect(sameDateGroups([a, b, c])).toEqual([[a, b], [c]]);
  });

  // Same date, but not adjacent in the input — mirrors groupIntoTrips's own
  // "an out-of-order input produces a grouping with no defined meaning"
  // contract: this never re-sorts, so the two 16ths land in separate groups
  // rather than being reunited across the 17th between them.
  it('does not reunite a date that reappears after a different one', () => {
    const a = dive({ id: 'a', date: '2026-08-16' });
    const b = dive({ id: 'b', date: '2026-08-17' });
    const c = dive({ id: 'c', date: '2026-08-16' });
    expect(sameDateGroups([a, b, c])).toEqual([[a], [b], [c]]);
  });

  it('returns nothing for no dives', () => {
    expect(sameDateGroups([])).toEqual([]);
  });
});

describe('canReorder', () => {
  it('offers reordering for a day of untimed dives', () => {
    expect(
      canReorder([dive({ date: '2026-08-16' }), dive({ date: '2026-08-16' })]),
    ).toBe(true);
  });

  it('does not offer reordering when the day has entry times, because it could not take effect', () => {
    expect(
      canReorder([
        dive({ date: '2026-08-16', timeIn: '09:00' }),
        dive({ date: '2026-08-16', timeIn: '14:00' }),
      ]),
    ).toBe(false);
  });

  // Only one of the two carries a time. reorderDivesForDate's own "mixed day"
  // coverage (db/dives.test.ts) proves the write still only partly takes
  // effect here — canReorder has to refuse the whole group, not just the
  // timed dive within it.
  it('does not offer reordering when only one dive of the day has a time', () => {
    expect(
      canReorder([dive({ date: '2026-08-16', timeIn: '09:00' }), dive({ date: '2026-08-16' })]),
    ).toBe(false);
  });

  it('does not offer reordering for a single dive', () => {
    expect(canReorder([dive({ date: '2026-08-16' })])).toBe(false);
  });

  it('does not offer reordering for no dives', () => {
    expect(canReorder([])).toBe(false);
  });

  // normaliseTimeOfDay, not a bare `timeIn !== null` check: an unparseable
  // time doesn't win compareDiveOrder's timeIn tier either, so it must not
  // block reordering here — the same predicate, not a second copy of it.
  it('offers reordering when timeIn is set but not a real time', () => {
    expect(
      canReorder([
        dive({ date: '2026-08-16', timeIn: 'not-a-time' }),
        dive({ date: '2026-08-16', timeIn: '' }),
      ]),
    ).toBe(true);
  });
});

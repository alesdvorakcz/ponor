import { dive } from './diveFixture';
import { groupIntoTrips, splitPlanned } from './trips';

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

  it('starts a new trip when a day is skipped', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-20', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(trips).toHaveLength(2);
  });

  // The case above is 4 days apart — well past the boundary, so it cannot tell
  // "one day apart" from "two days apart" (or three). This pins the exact
  // threshold: two days apart must NOT merge, only one day (or same day) may.
  it('does not merge dives exactly two days apart', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-18', siteName: 'Blue Hole' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(trips).toHaveLength(2);
  });

  it('starts a new trip when the place changes on consecutive days', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-17', siteName: 'Shark Reef' }),
      dive({ date: '2026-08-16', siteName: 'Blue Hole' }),
    ]);
    expect(trips).toHaveLength(2);
    expect(trips.map((t) => t.title)).toEqual(['Shark Reef', 'Blue Hole']);
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

  it('falls back to centerName when siteName is absent', () => {
    const trips = groupIntoTrips([
      dive({ date: '2026-08-17', centerName: 'Reef Divers' }),
      dive({ date: '2026-08-16', centerName: 'Reef Divers' }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.title).toBe('Reef Divers');
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

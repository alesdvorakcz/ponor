import { calendarDateToUtcMs, todayCalendarDate } from './datetime';
import { dive } from './diveFixture';
import { CARRIED_FIELDS, carryOverFrom } from './carryOver';
import { diveFormSchema } from './diveFormSchema';

/**
 * Every carried field and every fresh field gets a real, distinct value —
 * including falsy-but-real ones (`boots: false`, `hePct: 0`, `surge: 0`) —
 * so a test that checks one half can never pass by accident because the
 * other half, or a `||`-style fallback standing in for a null check, was
 * never exercised.
 */
const previous = dive({
  date: '2026-08-16',
  timeIn: '09:15', durationMin: 44, maxDepthM: 32.4, avgDepthM: 18.2,
  siteId: 'site-1', siteName: 'Blue Hole', centerId: 'center-1', centerName: 'Dahab Divers',
  entry: 'shore', salinity: 'salt', waterBody: 'ocean', latitude: 28.5, longitude: 34.5,
  suit: 'wet', hood: true, gloves: true, boots: false, weightsKg: 6,
  buddy: 'Petra', guide: 'Mahmoud',
  visibilityM: 25, waterTempC: 26, airTempC: 30, waves: 1, current: 2, surge: 0,
  rating: 5, title: 'Arch dive', notes: 'Arch at 30 m',
  tanks: [
    { material: 'steel', sizeL: 12, count: 1, workingBar: 232, o2Pct: 21, hePct: 0, startBar: 200, endBar: 60 },
  ],
});

describe('carrying gear and location forward', () => {
  it('carries the things that stay the same across a trip', () => {
    const c = carryOverFrom(previous);
    expect(c.siteId).toBe('site-1');
    expect(c.siteName).toBe('Blue Hole');
    expect(c.centerId).toBe('center-1');
    expect(c.centerName).toBe('Dahab Divers');
    expect(c.entry).toBe('shore');
    expect(c.salinity).toBe('salt');
    expect(c.waterBody).toBe('ocean');
    expect(c.suit).toBe('wet');
    expect(c.hood).toBe(true);
    expect(c.gloves).toBe(true);
    expect(c.boots).toBe(false);
    expect(c.weightsKg).toBe(6);
    expect(c.buddy).toBe('Petra');
    expect(c.guide).toBe('Mahmoud');
  });

  it('carries the cylinder and its gas, but not its pressures', () => {
    const c = carryOverFrom(previous);
    expect(c.tanks?.[0]?.material).toBe('steel');
    expect(c.tanks?.[0]?.sizeL).toBe(12);
    expect(c.tanks?.[0]?.count).toBe(1);
    expect(c.tanks?.[0]?.workingBar).toBe(232);
    expect(c.tanks?.[0]?.o2Pct).toBe(21);
    expect(c.tanks?.[0]?.hePct).toBe(0);
    // §2.1 + the decision log: starting AND ending pressure are fresh every
    // dive — a stale 200 bar would silently become a wrong gas-consumption
    // figure for the next dive.
    expect(c.tanks?.[0]?.startBar ?? null).toBeNull();
    expect(c.tanks?.[0]?.endBar ?? null).toBeNull();
  });
});

describe('keeping what changes every dive fresh', () => {
  it('does not carry what changes every dive', () => {
    const c = carryOverFrom(previous);
    for (const field of [
      'maxDepthM', 'avgDepthM', 'durationMin', 'timeIn',
      'visibilityM', 'waterTempC', 'rating', 'notes', 'title',
    ] as const) {
      expect(c[field] ?? null).toBeNull();
    }
  });

  it('also blanks the fields the first check does not touch: air temp and the sea-state scales', () => {
    // §2.1 says "temperatures" (plural) and "waves/current/surge" — a fix
    // that only cleared waterTempC, say, would still fail here.
    const c = carryOverFrom(previous);
    for (const field of ['airTempC', 'waves', 'current', 'surge'] as const) {
      expect(c[field] ?? null).toBeNull();
    }
  });

  it('does not carry the exact GPS point either', () => {
    // §2.1 names latitude/longitude in neither the carried nor the fresh
    // list. Treated as fresh by default: an exact entry point can differ
    // dive to dive even at the same site, and silently reusing a stale pin
    // is the same class of mistake carry-over exists to avoid for pressure.
    const c = carryOverFrom(previous);
    expect(c.latitude ?? null).toBeNull();
    expect(c.longitude ?? null).toBeNull();
  });

  it('sets fresh fields to an explicit null rather than leaving the key unset', () => {
    // `?? null` above tolerates either an explicit null or an absent key, so
    // it cannot by itself prove which one this does. That distinction is
    // real: a caller that `reset()`s a dirty form with this result needs the
    // key present to actually clear a stale value, not merely absent.
    const c = carryOverFrom(previous);
    expect(Object.prototype.hasOwnProperty.call(c, 'maxDepthM')).toBe(true);
    expect(c.maxDepthM).toBeNull();
  });
});

describe('no previous dive', () => {
  it('returns nothing to carry for a diver with no previous dive', () => {
    expect(Object.keys(carryOverFrom(null))).toHaveLength(0);
  });
});

describe('the 48-hour date rule', () => {
  it('keeps the previous date when it is less than 48 hours old', () => {
    const c = carryOverFrom(dive({ date: '2026-08-16' }), new Date('2026-08-17T10:00:00Z'));
    expect(c.date).toBe('2026-08-16');
  });

  it('moves to today once the previous dive is older than 48 hours', () => {
    // `now` built from LOCAL components, and so are the two below it that assert which day
    // "today" is: since the fix, today is the day `now` falls on in the DEVICE's zone, so a
    // `Date.parse('...T10:00:00Z')` moment would name a different day here depending on
    // where the suite runs. The zone-forced proof lives in carryOver.utc-plus-14.test.ts
    // and carryOver.utc-minus-11.test.ts; this file only has to stop depending on a zone.
    const c = carryOverFrom(dive({ date: '2026-08-16' }), new Date(2026, 7, 20, 10, 0));
    expect(c.date).toBe('2026-08-20');
  });

  it('still keeps the previous date one millisecond before the 48h boundary', () => {
    const midnight = calendarDateToUtcMs('2026-08-16');
    if (midnight === null) throw new Error('fixture date failed to parse');
    const c = carryOverFrom(dive({ date: '2026-08-16' }), new Date(midnight + 48 * 60 * 60 * 1000 - 1));
    expect(c.date).toBe('2026-08-16');
  });

  it('treats exactly 48 hours as "not less than", and moves to today', () => {
    const midnight = calendarDateToUtcMs('2026-08-16');
    if (midnight === null) throw new Error('fixture date failed to parse');
    const now = new Date(midnight + 48 * 60 * 60 * 1000);
    const c = carryOverFrom(dive({ date: '2026-08-16' }), now);
    // The boundary is what this test is about, not which day today is, so the expectation
    // asks the same owner the code does. `not.toBe` below is the assertion that discriminates
    // — no zone can make the local day of 2026-08-18T00:00Z come out as the 16th.
    expect(c.date).toBe(todayCalendarDate(now));
    expect(c.date).not.toBe('2026-08-16');
  });

  it("computes today from the day now falls on where the diver is, not the UTC day", () => {
    // 00:30 is the hour that separates the two readings: east of Greenwich a local
    // small-hours moment is still the PREVIOUS day in UTC, so `now.toISOString()` handed a
    // night dive yesterday's date. Built from local components, this holds in every zone,
    // and carryOver.utc-plus-14/-minus-11.test.ts force the extremes where the two answers
    // are guaranteed to differ.
    const c = carryOverFrom(dive({ date: '2020-01-01' }), new Date(2026, 7, 31, 0, 30));
    expect(c.date).toBe('2026-08-31');
  });

  it('falls back to today rather than trusting a rolled invalid date', () => {
    // calendarDateToUtcMs refuses '2026-02-30' outright; Date.parse instead
    // silently rolls it forward to 2026-03-02 (datetime.ts's own docblock).
    // Trusting that roll would treat 2026-03-01 as within 48h of a dive
    // dated two days later than what was actually stored; refusing it and
    // falling back to today is the safe reading.
    const corrupt = dive({ date: '2026-02-30' });
    const c = carryOverFrom(corrupt, new Date(2026, 2, 1, 10, 0));
    expect(c.date).toBe('2026-03-01');
  });
});

describe('CARRIED_FIELDS matching the behaviour', () => {
  it('copies every field it names, and every one of them is a real value, not a null in disguise', () => {
    const c = carryOverFrom(previous);
    for (const field of CARRIED_FIELDS) {
      if (field === 'tanks') continue; // its pressure-stripping is covered above
      expect(c[field]).toEqual((previous as unknown as Record<string, unknown>)[field]);
      expect(c[field]).not.toBeNull();
    }
  });

  it('never names date, or a field §2.1 calls fresh', () => {
    expect(CARRIED_FIELDS).not.toContain('date');
    for (const field of [
      'maxDepthM', 'avgDepthM', 'durationMin', 'timeIn', 'visibilityM',
      'waterTempC', 'airTempC', 'waves', 'current', 'surge', 'rating', 'title', 'notes',
      'latitude', 'longitude',
    ]) {
      expect(CARRIED_FIELDS).not.toContain(field);
    }
  });
});

describe('shape', () => {
  it('produces values the real form schema accepts, so a stale shape cannot slip past this module', () => {
    const c = carryOverFrom(previous);
    expect(() => diveFormSchema.parse(c)).not.toThrow();
  });
});

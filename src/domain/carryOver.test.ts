import { todayCalendarDate } from './datetime';
import { dive } from './diveFixture';
import { CARRIED_FIELDS, carryOverFrom } from './carryOver';
import { diveFormSchema } from './diveFormSchema';

/**
 * Every carried field and every fresh field gets a real, distinct value —
 * including falsy-but-real ones (`hePct: 0`, `surge: 0`) —
 * so a test that checks one half can never pass by accident because the
 * other half, or a `||`-style fallback standing in for a null check, was
 * never exercised.
 */
const previous = dive({
  date: '2026-08-16',
  timeIn: '09:15', durationMin: 44, maxDepthM: 32.4, avgDepthM: 18.2,
  siteId: 'site-1', siteName: 'Blue Hole', centerId: 'center-1', centerName: 'Dahab Divers',
  entry: 'shore', salinity: 'salt', waterBody: 'ocean', latitude: 28.5, longitude: 34.5,
  suit: 'wet', suitThicknessMm: 5, equipment: ['hood', 'gloves'], weightsKg: 6, weightsFeel: 'over',
  buddy: 'Petra', guide: 'Mahmoud',
  visibility: 'high', visibilityM: 25, waterTempC: 26, airTempC: 30, waves: 1, current: 2, surge: 0,
  weather: 'sunny', rating: 5, title: 'Arch dive', notes: 'Arch at 30 m',
  tanks: [
    { material: 'steel', configuration: 'twinset', sizeL: 12, workingBar: 232, o2Pct: 21, hePct: 0, startBar: 200, endBar: 60 },
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
    expect(c.suitThicknessMm).toBe(5);
    expect(c.equipment).toEqual(['hood', 'gloves']);
    expect(c.weightsKg).toBe(6);
    expect(c.buddy).toBe('Petra');
    expect(c.guide).toBe('Mahmoud');
  });

  it('carries the cylinder and its gas, but not its pressures', () => {
    const c = carryOverFrom(previous);
    expect(c.tanks?.[0]?.material).toBe('steel');
    expect(c.tanks?.[0]?.sizeL).toBe(12);
    expect(c.tanks?.[0]?.configuration).toBe('twinset');
    expect(c.tanks?.[0]?.workingBar).toBe(232);
    expect(c.tanks?.[0]?.o2Pct).toBe(21);
    expect(c.tanks?.[0]?.hePct).toBe(0);
    // §2.1 + the decision log: starting AND ending pressure are fresh every
    // dive — a stale 200 bar would silently become a wrong gas-consumption
    // figure for the next dive.
    expect(c.tanks?.[0]?.startBar ?? null).toBeNull();
    expect(c.tanks?.[0]?.endBar ?? null).toBeNull();
  });

  it('copies the equipment set rather than handing over the previous dive\'s own array', () => {
    // A carried value becomes the live form's state. Aliasing would let an edit to this
    // dive's accessories reach back and alter a dive already saved — invisibly, since
    // nothing on screen says that dive is being touched. `tanks` was always safe because
    // `withoutPressures` builds new cylinders; this one needed saying out loud.
    const c = carryOverFrom(previous);
    expect(c.equipment).not.toBe(previous.equipment);
    (c.equipment as string[]).push('torch');
    expect(previous.equipment).toEqual(['hood', 'gloves']);
  });
});

describe('keeping what changes every dive fresh', () => {
  it('does not carry what changes every dive', () => {
    const c = carryOverFrom(previous);
    for (const field of [
      'maxDepthM', 'avgDepthM', 'durationMin', 'timeIn',
      'visibility', 'visibilityM', 'waterTempC', 'weather', 'weightsFeel',
      'rating', 'notes', 'title',
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
    // §2.1 now names latitude/longitude in its FRESH half explicitly, and
    // says why: an exact entry point can differ dive to dive even at the
    // same site, and silently reusing a stale pin is the same class of
    // mistake carry-over exists to avoid for pressure. This comment used to
    // read "§2.1 names them in neither list", which was true of the older
    // §2.1 and was the reason they were fresh by default; the rule is
    // written down now rather than inferred.
    //
    // **It stopped being unexercised in M2l**, and the sentence here said it
    // would be M2's map that ended that. It was the other half of §2.3 — the
    // dive form's *use my location* row — which is worth correcting rather
    // than quietly updating, because "the rule waits for the map" is exactly
    // the kind of claim that survives the thing it was waiting for. The
    // screen half now has its own witness (`DiveFormScreen.test.tsx`, "never
    // carries a pin into the next dive").
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

describe('the carry-over date window', () => {
  // Every `now` below is built from LOCAL components, and so is every expectation about
  // which day "today" is: today is the day `now` falls on in the DEVICE's zone, so a
  // `Date.parse('...T10:00:00Z')` moment would name a different day depending on where the
  // suite runs — which is how a boundary test can quietly assert nothing. The zone-forced
  // proofs live in carryOver.utc-plus-14.test.ts and carryOver.utc-minus-11.test.ts; this
  // file only has to stop depending on a zone.

  it('keeps the previous date when the previous dive was today', () => {
    const c = carryOverFrom(dive({ date: '2026-08-16' }), new Date(2026, 7, 16, 18, 0));
    expect(c.date).toBe('2026-08-16');
  });

  it('keeps the previous date when the previous dive was yesterday', () => {
    const c = carryOverFrom(dive({ date: '2026-08-16' }), new Date(2026, 7, 17, 10, 0));
    expect(c.date).toBe('2026-08-16');
  });

  it('moves to today once the previous dive is older than that', () => {
    const c = carryOverFrom(dive({ date: '2026-08-16' }), new Date(2026, 7, 20, 10, 0));
    expect(c.date).toBe('2026-08-20');
  });

  it('still keeps the previous date at the last millisecond of the following day', () => {
    // The window closes at the diver's own midnight, not 48 h after some other zone's — so
    // the boundary is stated in local wall-clock terms, which is the only way to state it
    // once and have it hold everywhere.
    const c = carryOverFrom(dive({ date: '2026-08-16' }), new Date(2026, 7, 17, 23, 59, 59, 999));
    expect(c.date).toBe('2026-08-16');
  });

  it('moves to today the instant the day after that begins', () => {
    const now = new Date(2026, 7, 18, 0, 0, 0, 0);
    const c = carryOverFrom(dive({ date: '2026-08-16' }), now);
    // The boundary is what this test is about, not which day today is, so the expectation
    // asks the same owner the code does. `not.toBe` below is the assertion that
    // discriminates — the 16th is two days back whatever zone this runs in.
    expect(c.date).toBe(todayCalendarDate(now));
    expect(c.date).not.toBe('2026-08-16');
  });

  it('moves to today when the previous dive has not happened yet', () => {
    // The window's NEAR end, and the defect this pair of tests exists for. This assertion
    // used to read `toBe('2026-08-18')` — it asserted the bug — on the reasoning that a dive
    // dated tomorrow "is not more than 48 h old by any reading". True, and beside the point:
    // §2.1's rule is "your last dive was recent, so you are probably still on the same
    // trip", and a dive that has not happened yet is not recent.
    const c = carryOverFrom(dive({ date: '2026-08-18' }), new Date(2026, 7, 17, 10, 0));
    expect(c.date).toBe('2026-08-17');
    expect(c.date).not.toBe('2026-08-18');
  });

  it('moves to today for a previous dive dated far in the future, rather than following it there', () => {
    // How it was found on a device: §2.4's Logged/Planned control made planned dives
    // creatable, a dive was planned for 5 September, and from then on EVERY new dive opened
    // on 5 September while the real date was 31 August. A one-sided `todayMs - previousMs <=
    // DAY_MS` cannot ever expire it — the difference is negative, and stays negative, so the
    // stale date is not merely carried for a day, it is permanent until the clock catches
    // up. The near-boundary test above is one day out and would be satisfied by an
    // off-by-one; this is the shape the diver actually hit.
    const c = carryOverFrom(dive({ date: '2026-09-05' }), new Date(2026, 7, 31, 10, 0));
    expect(c.date).toBe('2026-08-31');
  });

  it("carries today's dive as the date STRING it was stored as, which is the near boundary itself", () => {
    // The control for the two above: "reject anything not strictly older than today" would
    // pass both of them and break the commonest case there is — the second dive of a two-dive
    // morning.
    //
    // It has to be a non-canonical spelling of today to prove anything, and that is the whole
    // reason this test reads the way it does. Written with a canonical `'2026-08-17'` it
    // CANNOT FAIL: carrying returns the previous date and falling back returns today, and on
    // this input those are the same string — so a `> 0` in place of `>= 0` stays green. Spelled
    // `'2026-8-17'` the two branches finally differ, because `carryOverDate` hands back the
    // stored value verbatim while its fallback goes through `todayCalendarDate`.
    //
    // That verbatim hand-back is itself the behaviour being pinned, not an accident of the
    // fixture: it is what puts a value `diveFormSchema` refuses in front of the form at all
    // (DiveFormScreen.test.tsx's `nonCanonicalSource` is built on exactly this), and a
    // carry-over that quietly canonicalised on the way past would take that path away.
    const c = carryOverFrom(dive({ date: '2026-8-17' }), new Date(2026, 7, 17, 10, 0));
    expect(c.date).toBe('2026-8-17');
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
    // Trusting that roll would put 2026-03-01 inside the window of a dive
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

  it('never names date, status, or a field §2.1 calls fresh', () => {
    expect(CARRIED_FIELDS).not.toContain('date');
    expect(CARRIED_FIELDS).not.toContain('status');
    for (const field of [
      'maxDepthM', 'avgDepthM', 'durationMin', 'timeIn', 'visibility', 'visibilityM',
      'waterTempC', 'airTempC', 'waves', 'current', 'surge', 'weather', 'weightsFeel',
      'rating', 'title', 'notes',
      'latitude', 'longitude',
    ]) {
      expect(CARRIED_FIELDS).not.toContain(field);
    }
  });
});

describe('a plan is never inherited (§2.4)', () => {
  it('carries no status forward from a planned dive, so the form keeps its own logged default', () => {
    // The assertion that discriminates is the second one. `status` is neither carried nor
    // blanked here — it is one of the two fields this module does not name at all (the
    // other is `date`, which has `carryOverDate`'s window instead) — so what a caller gets is
    // whatever the form's own default survives as. Parsing through the real schema is what
    // proves that end to end: if this module ever copied the previous dive's status, the
    // parse below would say 'planned' and every dive after a planned one would default to
    // being a plan. A diver who queues one dive on a boat is not switching modes.
    const planned = dive({ date: '2026-08-16', status: 'planned', siteName: 'Silfra' });
    const c = carryOverFrom(planned, new Date(2026, 7, 16, 18, 0));
    expect(Object.prototype.hasOwnProperty.call(c, 'status')).toBe(false);
    expect(diveFormSchema.parse(c).status).toBe('logged');
    // ...and carry-over really did run, so "no status" above is not "nothing at all".
    expect(c.siteName).toBe('Silfra');
  });

  it('does not blank it either, which would be a value the column cannot hold', () => {
    // The other way this could go wrong: `FRESH_FIELDS` sets every field it names to `null`,
    // and `status` is NOT NULL in the schema (§6). A null slipping through would be a value
    // the form then has to guess its way back out of, and one `updateDive` would happily
    // write.
    const c = carryOverFrom(previous) as Record<string, unknown>;
    expect(c.status).toBeUndefined();
  });
});

describe('shape', () => {
  it('produces values the real form schema accepts, so a stale shape cannot slip past this module', () => {
    const c = carryOverFrom(previous);
    expect(() => diveFormSchema.parse(c)).not.toThrow();
  });
});

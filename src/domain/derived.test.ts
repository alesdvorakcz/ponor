import type { Configuration, Tank } from './types';
import { gasUsedLitres, mod, nitrogenPct, rmv, surfaceIntervalMin, timeOut, usedBar } from './derived';

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: 'steel', configuration: 'single', sizeL: 12, workingBar: 232,
  o2Pct: 21, hePct: null, startBar: 200, endBar: 50, ...over,
});

describe('usedBar', () => {
  it('is start minus end', () => {
    expect(usedBar(tank())).toBe(150);
  });

  it('is null when either pressure is missing', () => {
    expect(usedBar(tank({ startBar: null }))).toBeNull();
    expect(usedBar(tank({ endBar: null }))).toBeNull();
  });

  it('is null when the cylinder ends fuller than it started', () => {
    // A transcription slip, not a real dive. Better no number than a negative one.
    expect(usedBar(tank({ startBar: 50, endBar: 200 }))).toBeNull();
  });

  it('is null for a negative absolute pressure, not the arithmetic difference', () => {
    // used >= 0 alone would accept this: -100 - (-200) = 100. But a negative
    // absolute pressure isn't a real reading in either field.
    expect(usedBar(tank({ startBar: -100, endBar: -200 }))).toBeNull();
    expect(usedBar(tank({ startBar: -10, endBar: 50 }))).toBeNull();
    expect(usedBar(tank({ startBar: 200, endBar: -10 }))).toBeNull();
  });

  it('is null, not a throw, when the tank itself is missing', () => {
    expect(() => usedBar(null as unknown as Tank)).not.toThrow();
    expect(usedBar(null as unknown as Tank)).toBeNull();
    expect(usedBar(undefined as unknown as Tank)).toBeNull();
  });
});

describe('gasUsedLitres', () => {
  it('multiplies used pressure by water capacity', () => {
    expect(gasUsedLitres([tank()])).toBe(1800); // 150 bar x 12 l
  });

  it('counts both cylinders of a twinset', () => {
    expect(gasUsedLitres([tank({ configuration: 'twinset' })])).toBe(3600);
  });

  it('counts both cylinders of a sidemount rig too, though it is not a twinset', () => {
    // §10 keeps the two rigs distinct because they record different facts; only the count
    // they imply coincides. If `cylinderCount` ever grew a `sidemount: 1` this is what
    // would catch it — the gas figure is the only place the number is observable.
    expect(gasUsedLitres([tank({ configuration: 'sidemount' })])).toBe(3600);
  });

  it('sums across independent cylinders', () => {
    expect(gasUsedLitres([tank(), tank({ sizeL: 7, startBar: 200, endBar: 100 })])).toBe(2500);
  });

  it('treats an unrecorded rig as one cylinder, and still counts the cylinder', () => {
    // The behaviour a `count: null` had before M1h, preserved exactly: unknown is `absent`,
    // and absent is the one classification that does not skip the cylinder. 1800 rather than
    // null is what says both halves held — a skip would have left nothing to total.
    expect(gasUsedLitres([tank({ configuration: null })])).toBe(1800);
  });

  it('treats a rig this build has never heard of as unrecorded, not as a reason to void', () => {
    // An M2 sync row from a newer client. §10's "kept, not refused" policy means such a
    // value reaches here, and there is nothing this build can do with it but decline to
    // guess — so it takes the same path a missing rig does rather than blanking a dive's
    // whole gas figure over a field the diver never saw.
    const foreign = tank({ configuration: 'rebreather' as Configuration });
    expect(gasUsedLitres([foreign])).toBe(1800);
  });

  it('ignores cylinders it cannot compute, rather than discarding the dive', () => {
    expect(gasUsedLitres([tank(), tank({ startBar: null })])).toBe(1800);
  });

  it('is null when no cylinder yields a figure', () => {
    expect(gasUsedLitres([tank({ sizeL: null })])).toBeNull();
    expect(gasUsedLitres([])).toBeNull();
  });

  it('is null for a cylinder with an impossible size, not a negative gas figure', () => {
    expect(gasUsedLitres([tank({ sizeL: 0 })])).toBeNull();
    expect(gasUsedLitres([tank({ sizeL: -5 })])).toBeNull();
  });

  it('skips a cylinder with an absent size rather than voiding the total', () => {
    // A single-tank case can't tell "skipped, then nothing left to count"
    // apart from "voided" — both read as null. This needs a second, good
    // cylinder so the two mechanisms show visibly different totals: if the
    // `!isNumber(tank.sizeL)` absent-check were ever deleted, sizeL: null
    // would fall through to the contradictory branch instead (null > 0 is
    // false) and this would come back null, not 1800.
    const good = tank();
    const absentSize = tank({ sizeL: null });
    expect(gasUsedLitres([absentSize, good])).toBe(1800);
  });

  it('voids the whole total for a cylinder with an impossible size, just like contradictory pressure', () => {
    // sizeL <= 0 is data the diver did record, not data that's missing —
    // dropping just this cylinder would understate the total the same way a
    // transposed pressure would, so it voids the whole figure instead.
    const good = tank();
    const badSize = tank({ startBar: 200, endBar: 100, sizeL: 0 });
    expect(gasUsedLitres([good, badSize])).toBeNull();
  });

  it('never voids the total over the rig, whatever it holds', () => {
    // Three tests used to live here, pinning `count: 0`, `count: -3` and `count: 2.5` as
    // *contradictory* — real data describing an impossible cylinder, which voids the whole
    // dive's figure. M1h retired the bucket along with the field: a rig is a tap on a closed
    // list, so there is no value that is both recorded and impossible. This is what stands
    // in their place, and it is the assertion that would fail if someone reintroduced a
    // contradictory branch for a configuration.
    const good = tank();
    const rigs: (Configuration | null)[] = ['single', 'twinset', 'sidemount', null, 'nonsense' as Configuration];
    for (const configuration of rigs) {
      const other = tank({ sizeL: 7, startBar: 200, endBar: 100, configuration });
      expect(gasUsedLitres([good, other])).not.toBeNull();
    }
  });

  it('voids the total for a contradictory size even when the same cylinder also has an absent pressure', () => {
    // Before this fix, the loop `continue`d on the absent pressure before
    // ever looking at sizeL, so this exact cylinder voided the total or not
    // depending only on which side of the good cylinder it sat on. Checked
    // both orders to prove that's no longer true.
    const good = tank();
    const absentPressureContradictorySize = tank({ startBar: null, sizeL: 0 });
    expect(gasUsedLitres([absentPressureContradictorySize, good])).toBeNull();
    expect(gasUsedLitres([good, absentPressureContradictorySize])).toBeNull();
  });

  it('voids the whole total for a cylinder with contradictory pressures, rather than skipping it', () => {
    // Unlike an absent pressure, transposed start/end is data the diver did
    // record — dropping it silently would understate gas used with no sign
    // anything was discarded, which is worse than showing nothing at all.
    const main = tank({ sizeL: 12, startBar: 200, endBar: 50 });
    const stageTransposed = tank({ sizeL: 7, startBar: 50, endBar: 200 });
    expect(gasUsedLitres([main, stageTransposed])).toBeNull();
  });

  it('voids the whole total for a cylinder with a negative absolute pressure', () => {
    const main = tank({ sizeL: 12, startBar: 200, endBar: 50 });
    const negative = tank({ sizeL: 7, startBar: -50, endBar: -200 });
    expect(gasUsedLitres([main, negative])).toBeNull();
  });

  it('is null, not a throw, for a missing array or a missing cylinder in it', () => {
    expect(() => gasUsedLitres(null as unknown as Tank[])).not.toThrow();
    expect(gasUsedLitres(null as unknown as Tank[])).toBeNull();
    expect(gasUsedLitres(undefined as unknown as Tank[])).toBeNull();
    expect(gasUsedLitres([null as unknown as Tank])).toBeNull();
  });

  it('is null rather than Infinity when the total overflows', () => {
    // Each input is individually finite (Number.MAX_VALUE passes isNumber),
    // but the product isn't - the per-input finiteness checks alone miss this.
    const huge = tank({ startBar: Number.MAX_VALUE, endBar: 0, sizeL: Number.MAX_VALUE, configuration: 'single' });
    expect(gasUsedLitres([huge])).toBeNull();
  });
});

describe('rmv', () => {
  it('converts consumption to surface-equivalent litres per minute', () => {
    // 1800 l used, 20 m average => 3 ata, 45 min => 1800 / 3 / 45 = 13.33
    expect(rmv({ tanks: [tank()], avgDepthM: 20, durationMin: 45 })).toBeCloseTo(13.33, 2);
  });

  it('gives a lower figure for the same gas used deeper', () => {
    // Deeper means dividing by a larger ambient pressure, so surface-equivalent
    // RMV goes down, not up — this is the only test guarding that term.
    const shallow = rmv({ tanks: [tank()], avgDepthM: 10, durationMin: 45 })!;
    const deep = rmv({ tanks: [tank()], avgDepthM: 30, durationMin: 45 })!;
    expect(shallow).toBeGreaterThan(deep);
  });

  it('is null when any input it needs is missing', () => {
    expect(rmv({ tanks: [tank()], avgDepthM: null, durationMin: 45 })).toBeNull();
    expect(rmv({ tanks: [tank()], avgDepthM: 20, durationMin: null })).toBeNull();
    expect(rmv({ tanks: [tank({ sizeL: null })], avgDepthM: 20, durationMin: 45 })).toBeNull();
  });

  it('is null for a negative average depth, not a positive-looking RMV', () => {
    // -10 < avgDepthM < 0 keeps 0 < ata < 1, so litres / ata / durationMin
    // comes out positive, not negative — value > 0 alone can't tell this
    // apart from a real RMV. It takes the explicit avgDepthM < 0 check
    // (avgDepthM -15 would additionally trip value > 0 via a negative ata,
    // which would mask this guard rather than test it).
    expect(rmv({ tanks: [tank()], avgDepthM: -5, durationMin: 45 })).toBeNull();
  });

  it('is null for a zero-length dive rather than dividing by zero', () => {
    expect(rmv({ tanks: [tank()], avgDepthM: 20, durationMin: 0 })).toBeNull();
  });

  it('is null, not zero, for a dive where no gas was used', () => {
    // A cylinder with startBar === endBar gives gasUsedLitres a legitimate 0,
    // but a breathing diver cannot have an RMV of zero for a 45-minute dive.
    const untouched = tank({ startBar: 200, endBar: 200 });
    expect(rmv({ tanks: [untouched], avgDepthM: 20, durationMin: 45 })).toBeNull();
  });

  it('is null, not a throw, when the dive itself is missing', () => {
    // The dive list's natural call is rmv(dives[i]) inside a loop or map; a hole
    // in the data should never take the whole screen down with it.
    expect(() => rmv(null as unknown as Parameters<typeof rmv>[0])).not.toThrow();
    expect(rmv(null as unknown as Parameters<typeof rmv>[0])).toBeNull();
    expect(rmv(undefined as unknown as Parameters<typeof rmv>[0])).toBeNull();
  });

  it('is null rather than Infinity when the result overflows', () => {
    // durationMin > 0 passes the guard but is tiny enough that dividing by it
    // overflows a normally well-behaved litres/ata figure.
    expect(rmv({ tanks: [tank()], avgDepthM: 20, durationMin: Number.MIN_VALUE })).toBeNull();
  });

  it('is null rather than an underflowed zero, the overflow guard\'s opposite edge', () => {
    // Number.isFinite(0) is true, so a finiteness-only guard misses this: a
    // denormal litres value divided by a large enough durationMin rounds all
    // the way down to exactly 0 (verified: Number.MIN_VALUE / 1 / 2 === 0),
    // which is the same unreal-RMV shape the litres <= 0 guard above rejects.
    const denormal = tank({ startBar: Number.MIN_VALUE, endBar: 0, sizeL: 1, configuration: 'single' });
    expect(rmv({ tanks: [denormal], avgDepthM: 0, durationMin: 2 })).toBeNull();
  });
});

describe('nitrogenPct', () => {
  it('is what is left of the mix once oxygen and helium are taken out', () => {
    expect(nitrogenPct(21, 0)).toBe(79);
    expect(nitrogenPct(32, 0)).toBe(68);
    expect(nitrogenPct(18, 45)).toBe(37);
  });

  it('is 0 for heliox and 100 for a mix with neither', () => {
    // §10 names heliox as the case that proves two numbers describe every mix. Both ends of
    // the range are real answers, so neither may come back null.
    expect(nitrogenPct(21, 79)).toBe(0);
    expect(nitrogenPct(0, 0)).toBe(100);
  });

  it('is null when EITHER fraction was not recorded — a blank helium is not a zero', () => {
    // The decision that costs the common case: nitrox 32 with He left blank is obviously
    // 68 % N2 to a human, and this app still says nothing, because "did not say" is not
    // "zero" and inventing the difference understates inert gas — the unsafe direction.
    expect(nitrogenPct(32, null)).toBeNull();
    expect(nitrogenPct(null, 0)).toBeNull();
    expect(nitrogenPct(null, null)).toBeNull();
    expect(nitrogenPct(undefined, undefined)).toBeNull();
  });

  it('is null for a fraction that is not a real number', () => {
    expect(nitrogenPct(NaN, 0)).toBeNull();
    expect(nitrogenPct(21, Number.POSITIVE_INFINITY)).toBeNull();
    expect(nitrogenPct('21' as unknown as number, 0)).toBeNull();
  });

  it('is null for a fraction outside 0-100, which is not a percentage of anything', () => {
    expect(nitrogenPct(-1, 0)).toBeNull();
    expect(nitrogenPct(101, 0)).toBeNull();
    expect(nitrogenPct(21, -1)).toBeNull();
    expect(nitrogenPct(21, 101)).toBeNull();
  });

  it('is null when the two fractions add to more than the whole mix', () => {
    // A negative nitrogen fraction is not a lean mix, it is a typo in one of the two fields
    // it was computed from — and this file shows no number rather than a wrong one.
    expect(nitrogenPct(60, 50)).toBeNull();
    // The boundary is legal, and stays legal: exactly 100 is heliox-with-oxygen, not an error.
    expect(nitrogenPct(60, 40)).toBe(0);
  });
});

describe('mod', () => {
  it('gives the familiar figure for air at 1.4 bar', () => {
    expect(mod(21)).toBeCloseTo(56.67, 2);
  });

  it('gives a shallower limit for a richer mix', () => {
    expect(mod(32)).toBeCloseTo(33.75, 2);
    expect(mod(36)).toBeCloseTo(28.89, 2);
  });

  it('accepts a different oxygen partial pressure', () => {
    expect(mod(32, 1.6)).toBeCloseTo(40, 2);
  });

  it('is null without a mix', () => {
    expect(mod(null)).toBeNull();
    expect(mod(undefined)).toBeNull();
  });

  it('is null for a nonsensical mix rather than returning a hazardous number', () => {
    expect(mod(0)).toBeNull();
    expect(mod(-5)).toBeNull();
    expect(mod(101)).toBeNull();
  });

  it('is null for a ceiling that would produce a negative depth, not a negative number', () => {
    // A zero or negative ppO2Max is one way to trigger this, but not the only
    // one: any ppO2Max below the mix's own surface partial pressure does too.
    expect(mod(21, 0)).toBeNull();
    expect(mod(21, -1)).toBeNull();
    expect(mod(50, 0.4)).toBeNull(); // 0.4 < 0.5 = 50 % at the surface
    expect(mod(100, 0.9)).toBeNull();
  });

  it('is null for a non-finite ppO2Max, not an infinite depth', () => {
    // depth >= 0 alone doesn't catch this: Infinity >= 0 is true, so without
    // a separate finiteness check this would return Infinity, not null.
    expect(mod(21, Infinity)).toBeNull();
  });

  it('is zero, not null, when the ceiling exactly matches the mix at the surface', () => {
    expect(mod(100, 1.0)).toBe(0);
  });
});

describe('timeOut', () => {
  it('adds the duration to the entry time', () => {
    expect(timeOut('08:12', 44)).toBe('08:56');
  });

  it('rolls past the hour', () => {
    expect(timeOut('08:45', 30)).toBe('09:15');
  });

  it('wraps past midnight', () => {
    expect(timeOut('23:50', 30)).toBe('00:20');
  });

  it('is null without both parts', () => {
    expect(timeOut(null, 44)).toBeNull();
    expect(timeOut('08:12', null)).toBeNull();
  });

  it('is null for a negative duration rather than surfacing before entry', () => {
    expect(timeOut('08:12', -10)).toBeNull();
  });

  it('is null for a non-numeric duration, not the literal string "NaN:NaN"', () => {
    // durationMin < 0 alone doesn't catch this: NaN < 0 is false, so without
    // the isNumber guard this reaches toClock and stringifies NaN directly.
    expect(timeOut('08:12', NaN)).toBeNull();
  });

  it('rounds a fractional duration to a real clock time', () => {
    // Before rounding was added, this returned "08:56.5" - a string that
    // isn't a time at all.
    expect(timeOut('08:12', 44.5)).toBe('08:57');
  });

  it('is null for a duration that cannot describe one dive, not a plausible wrong clock', () => {
    // The wrap's legitimate domain is exactly one day. Above it, the same
    // modulo that correctly turns 23:30 + 60 min into 00:20 folds a typo into
    // a time that looks entirely real. These are the values it used to return.
    expect(timeOut('09:00', 1439)).toBe('08:59'); // still wraps: a real, if long, dive
    expect(timeOut('09:00', 1440)).toBeNull(); // was '09:00' — "surfaced when you entered"
    expect(timeOut('09:00', 2000)).toBeNull(); // was '18:20'
    expect(timeOut('09:00', 4500)).toBeNull(); // was '12:00'
    expect(timeOut('00:00', Number.MAX_VALUE)).toBeNull(); // was '02:08'
  });

  it('checks the bound against the rounded duration, closing the last half-minute of it', () => {
    // 1439.6 is below 1440 but rounds to it, so a bound checked before
    // rounding would let it through and wrap a full day to '09:00'.
    expect(timeOut('09:00', 1439.6)).toBeNull();
    expect(timeOut('09:00', 1439.4)).toBe('08:59');
  });

  it('is null for a malformed time string, but not for a merely unpadded one', () => {
    // Changed deliberately in the datetime.ts unification: '8:12' names
    // exactly one time and now reads as 08:12 here, the same way the dive
    // list sorts it. It used to be null here while diveNumber.ts sorted it
    // after '19:00' — the same value with two different verdicts, which is
    // the defect that module exists to close.
    expect(timeOut('8:12', 10)).toBe('08:22');
    expect(timeOut('25:00', 10)).toBeNull(); // hour out of range
    expect(timeOut('08:60', 10)).toBeNull(); // minute out of range
    expect(timeOut('8:1', 10)).toBeNull(); // ambiguous minute: never guessed
    expect(timeOut('', 10)).toBeNull();
    // and the boundary values the same parser must still accept:
    expect(timeOut('00:00', 0)).toBe('00:00');
    expect(timeOut('23:59', 0)).toBe('23:59');
  });
});

describe('surfaceIntervalMin', () => {
  it('measures from the previous dive surfacing to the next entry', () => {
    const previous = { date: '2026-08-16', timeIn: '08:12', durationMin: 44 };
    const next = { date: '2026-08-16', timeIn: '10:38' };
    expect(surfaceIntervalMin(previous, next)).toBe(102); // out at 08:56
  });

  // DiveDetailScreen.tsx's previousLoggedDive() leans on this guard as an (undocumented,
  // until now) safety net: if that lookup ever grabbed the wrong neighbour — the next dive
  // instead of the previous one, the exact shape a reversed array index would produce — it
  // would call this function with the pair transposed relative to their real chronological
  // order. That's reproduced directly here by swapping the previous/next pair above: the
  // "previous" dive now surfaces (10:38 + 30 = 11:08) after the "next" dive even starts
  // (08:12), so `interval` comes out negative and this returns null rather than a
  // plausible-looking wrong number. Guarding the OUTCOME, not just each input on its own —
  // both times are perfectly valid clock times individually — is what makes this safe
  // against a mis-paired call, from this function or any future one shaped like it.
  it('is null for a transposed pair — what a mis-ordered lookup would produce — not a wrong number', () => {
    const earlier = { date: '2026-08-16', timeIn: '08:12', durationMin: 44 };
    const later = { date: '2026-08-16', timeIn: '10:38', durationMin: 30 };
    expect(surfaceIntervalMin(later, earlier)).toBeNull();
  });

  it('spans midnight between consecutive days', () => {
    const previous = { date: '2026-08-16', timeIn: '23:00', durationMin: 30 };
    const next = { date: '2026-08-17', timeIn: '00:30' };
    expect(surfaceIntervalMin(previous, next)).toBe(60);
  });

  it('is null when either dive lacks a time', () => {
    expect(surfaceIntervalMin({ date: '2026-08-16', timeIn: null, durationMin: 44 }, { date: '2026-08-16', timeIn: '10:38' })).toBeNull();
    expect(surfaceIntervalMin({ date: '2026-08-16', timeIn: '08:12', durationMin: 44 }, { date: '2026-08-16', timeIn: null })).toBeNull();
  });

  it('is null when the next dive precedes the previous one surfacing', () => {
    const previous = { date: '2026-08-16', timeIn: '10:00', durationMin: 60 };
    const next = { date: '2026-08-16', timeIn: '10:30' };
    expect(surfaceIntervalMin(previous, next)).toBeNull();
  });

  it('is null when the previous dive has no duration, rather than assuming it was instant', () => {
    const previous = { date: '2026-08-16', timeIn: '08:12', durationMin: null };
    const next = { date: '2026-08-16', timeIn: '10:38' };
    expect(surfaceIntervalMin(previous, next)).toBeNull();
  });

  it('is null for a malformed time on either side, not a number computed from a zeroed-out start', () => {
    // timeOfDayToMinutes returns null for a string that names no real time.
    // Without the guard that catches that null, it gets used as if it were 0
    // in the arithmetic below (null + n coerces to n in JS) instead of
    // stopping the function.
    const good = { date: '2026-08-16', timeIn: '10:38' };
    const malformedPrevious = { date: '2026-08-16', timeIn: '25:00', durationMin: 44 };
    expect(surfaceIntervalMin(malformedPrevious, good)).toBeNull();

    const previous = { date: '2026-08-16', timeIn: '08:12', durationMin: 44 };
    const malformedNext = { date: '2026-08-16', timeIn: '8:1' }; // ambiguous minute, other side
    expect(surfaceIntervalMin(previous, malformedNext)).toBeNull();
  });

  it('reads an unpadded time the same way the dive list sorts it', () => {
    // Same deliberate change as timeOut's: one parser, one verdict. '8:12'
    // is 08:12 everywhere or nowhere.
    const previous = { date: '2026-08-16', timeIn: '8:12', durationMin: 44 };
    const next = { date: '2026-08-16', timeIn: '10:38' };
    expect(surfaceIntervalMin(previous, next)).toBe(102);
  });

  it('is null for a negative previous duration, not an overstated interval', () => {
    // isNumber(-1000) is true, so the isNumber half of the guard alone
    // doesn't catch this — it takes the explicit < 0 check.
    const previous = { date: '2026-08-16', timeIn: '08:12', durationMin: -1000 };
    const next = { date: '2026-08-16', timeIn: '10:38' };
    expect(surfaceIntervalMin(previous, next)).toBeNull();
  });

  it('is null for an impossible calendar date on EITHER side, not an interval overstated by a day', () => {
    // Date.parse range-checks the month but rolls the day, so '2026-02-30'
    // parses as 2026-03-02. On the NEXT dive that roll silently added 24 h to
    // the interval and returned a completely plausible number — 2835 where
    // the truth is 1395 (next.timeIn is deliberately earlier than
    // previous.timeIn, 09:00 rather than 10:00, so the true one-day gap
    // stays under the day-or-more bound just below rather than colliding
    // with it — a second, unrelated guard this test isn't about). Overstating
    // is the direction this function's own docblock names as unsafe next to
    // a diver's nitrogen-loading judgement.
    const previous = { date: '2026-02-28', timeIn: '09:00', durationMin: 45 };
    expect(surfaceIntervalMin(previous, { date: '2026-03-01', timeIn: '09:00' })).toBe(1395);
    expect(surfaceIntervalMin(previous, { date: '2026-02-30', timeIn: '10:00' })).toBeNull();

    // The mirror case was already caught, but only by accident: the previous
    // dive rolling *forward* made the interval negative, and the `>= 0` guard
    // below picked it up. Asserted so it stays closed on purpose.
    expect(
      surfaceIntervalMin(
        { date: '2026-02-30', timeIn: '09:00', durationMin: 45 },
        { date: '2026-03-01', timeIn: '10:00' },
      ),
    ).toBeNull();

    // 2026 is not a leap year, so this one is impossible too.
    expect(surfaceIntervalMin(previous, { date: '2026-02-29', timeIn: '10:00' })).toBeNull();
  });

  it('reads an unpadded date, which used to be refused outright', () => {
    // Date.parse('2026-2-28T00:00:00Z') is NaN, so this returned null while
    // the dive list happily numbered the same row — the same value, two
    // verdicts. One parser now, so one verdict.
    const previous = { date: '2026-2-28', timeIn: '09:00', durationMin: 45 };
    expect(surfaceIntervalMin(previous, { date: '2026-03-01', timeIn: '09:00' })).toBe(1395);
  });

  // Review task 7, Important #2: two logged dives a year apart rendered
  // "525555 min" with no bound at all. Bounded the same way timeOut bounds a
  // dive's own duration, a few functions up in this file.
  it('is null when the interval is a day or more, not a number a diver would act on', () => {
    const previous = { date: '2025-08-16', timeIn: '09:00', durationMin: 44 };
    const next = { date: '2026-08-16', timeIn: '09:00' }; // a year later
    expect(surfaceIntervalMin(previous, next)).toBeNull();
  });

  it('stays a real number just under the day bound, and goes null exactly at it', () => {
    const previous = { date: '2026-08-16', timeIn: '00:00', durationMin: 0 };
    expect(surfaceIntervalMin(previous, { date: '2026-08-16', timeIn: '23:59' })).toBe(1439);
    expect(surfaceIntervalMin(previous, { date: '2026-08-17', timeIn: '00:00' })).toBeNull();
  });

  it('is null, not a throw, when either dive is missing entirely', () => {
    // The dive list's natural call is surfaceIntervalMin(dives[i - 1], dive); at
    // i === 0 that passes undefined for `previous`. noUncheckedIndexedAccess is
    // on now, so that call site is a compile error rather than a silent
    // undefined — but the flag only covers callers this program typechecks, and
    // the runtime guard is what covers an untyped or cast one.
    const next = { date: '2026-08-16', timeIn: '10:38' };
    const previous = { date: '2026-08-16', timeIn: '08:12', durationMin: 44 };
    expect(() => surfaceIntervalMin(undefined as unknown as typeof previous, next)).not.toThrow();
    expect(surfaceIntervalMin(undefined as unknown as typeof previous, next)).toBeNull();
    expect(surfaceIntervalMin(null as unknown as typeof previous, next)).toBeNull();
    expect(surfaceIntervalMin(previous, undefined as unknown as typeof next)).toBeNull();
  });
});

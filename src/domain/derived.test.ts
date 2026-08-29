import type { Tank } from './types';
import { gasUsedLitres, mod, rmv, surfaceIntervalMin, timeOut, usedBar } from './derived';

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: 'steel', sizeL: 12, count: 1, workingBar: 232,
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
    expect(gasUsedLitres([tank({ count: 2 })])).toBe(3600);
  });

  it('sums across independent cylinders', () => {
    expect(gasUsedLitres([tank(), tank({ sizeL: 7, startBar: 200, endBar: 100 })])).toBe(2500);
  });

  it('treats a missing count as one cylinder', () => {
    expect(gasUsedLitres([tank({ count: null })])).toBe(1800);
  });

  it('ignores cylinders it cannot compute, rather than discarding the dive', () => {
    expect(gasUsedLitres([tank(), tank({ startBar: null })])).toBe(1800);
  });

  it('is null when no cylinder yields a figure', () => {
    expect(gasUsedLitres([tank({ sizeL: null })])).toBeNull();
    expect(gasUsedLitres([])).toBeNull();
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

  it('rounds a fractional duration to a real clock time', () => {
    // Before rounding was added, this returned "08:56.5" - a string that
    // isn't a time at all.
    expect(timeOut('08:12', 44.5)).toBe('08:57');
  });

  it('is null for a malformed time string, in either direction of the regex', () => {
    expect(timeOut('8:12', 10)).toBeNull(); // missing leading zero
    expect(timeOut('25:00', 10)).toBeNull(); // hour out of range
    expect(timeOut('08:60', 10)).toBeNull(); // minute out of range
    // and the boundary values the same regex must still accept:
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

  it('is null, not a throw, when either dive is missing entirely', () => {
    // The dive list's natural call is surfaceIntervalMin(dives[i - 1], dive); at
    // i === 0 that passes undefined for `previous`, and noUncheckedIndexedAccess
    // is not on, so this typechecks clean — the runtime guard is what saves us.
    const next = { date: '2026-08-16', timeIn: '10:38' };
    const previous = { date: '2026-08-16', timeIn: '08:12', durationMin: 44 };
    expect(() => surfaceIntervalMin(undefined as unknown as typeof previous, next)).not.toThrow();
    expect(surfaceIntervalMin(undefined as unknown as typeof previous, next)).toBeNull();
    expect(surfaceIntervalMin(null as unknown as typeof previous, next)).toBeNull();
    expect(surfaceIntervalMin(previous, undefined as unknown as typeof next)).toBeNull();
  });
});

import {
  formatConditionScale,
  formatCoordinates,
  formatCount,
  formatDepth,
  formatDepthParts,
  formatDuration,
  formatDiveDate,
  formatDiveStatus,
  formatEntry,
  formatGasUsed,
  formatPercent,
  formatPressure,
  formatRating,
  formatRmv,
  formatSalinity,
  formatSuit,
  formatSurfaceInterval,
  formatTemperature,
  formatTimeRange,
  formatVolume,
  formatWaterBody,
  formatWeight,
} from './display';

describe('formatDepth', () => {
  it('shows one decimal place', () => {
    expect(formatDepth(32.44)).toBe('32.4 m');
    expect(formatDepth(18)).toBe('18.0 m');
  });
  it('returns null for an unrecorded depth rather than a zero', () => {
    expect(formatDepth(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatDepth(Number.NaN)).toBeNull();
  });
  // M1c closing fixes, Important #3: unlike formatTemperature's "keeps a negative reading
  // signed" a few describes down, a depth cannot physically be negative — nothing dives
  // above the surface. This used to be the exact input where this function and
  // theme/depth.ts's depthColorOrNull disagreed: this returned a string ("-5.0 m") while
  // depthColorOrNull already refused to colour it, so a screen gating on this function
  // alone (DiveDetailScreen.tsx's "Max depth" row, DiveRow.tsx's accessibility label) drew
  // a dangling label DepthValue then rendered nothing beside. Pinned here so the two can
  // never quietly drift apart again.
  it('returns null for a negative depth, since nothing dives above the surface', () => {
    expect(formatDepth(-5)).toBeNull();
  });
});

// M1c task 1 review, Important: DepthValue.tsx used to get its value/unit split by
// parsing formatDepth's string on the space it happened to always contain — a parse with
// no fallback. formatDepthParts is the structured form it reads instead, and formatDepth
// above is now defined in terms of it, so this pins the one contract both of them share.
describe('formatDepthParts', () => {
  it('splits the numeral and unit apart, matching what formatDepth joins back together', () => {
    expect(formatDepthParts(32.44)).toEqual({ value: '32.4', unit: 'm' });
    expect(formatDepthParts(18)).toEqual({ value: '18.0', unit: 'm' });
  });
  it('returns null for an unrecorded depth rather than a zero', () => {
    expect(formatDepthParts(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatDepthParts(Number.NaN)).toBeNull();
  });
  it('returns null for a negative depth, since nothing dives above the surface', () => {
    expect(formatDepthParts(-5)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('renders whole minutes', () => {
    expect(formatDuration(44)).toBe('44 min');
  });
  // Review task 7, cannot-fail #2: a whole-number fixture in, a whole-number string out —
  // deleting the `Math.round` call survived every test in the suite, even though the name
  // promises rounding. derived.ts's own comment on durationMin: "diver-entered and may
  // carry a fraction (44.5 min)" — that fraction is the boundary this needs to reach.
  it('rounds a fractional duration to the whole minute', () => {
    expect(formatDuration(44.6)).toBe('45 min');
  });
  it('renders an hour-plus dive in minutes, which is how divers log it', () => {
    expect(formatDuration(72)).toBe('72 min');
  });
  it('returns null for no duration', () => {
    expect(formatDuration(null)).toBeNull();
  });
});

describe('formatTemperature', () => {
  it('rounds to a whole degree', () => {
    expect(formatTemperature(25.6)).toBe('26 °C');
  });
  it('keeps a negative reading signed', () => {
    expect(formatTemperature(-1.2)).toBe('-1 °C');
  });
  it('returns null for no reading', () => {
    expect(formatTemperature(null)).toBeNull();
  });
});

describe('formatPressure', () => {
  it('renders whole bar', () => {
    expect(formatPressure(207.5)).toBe('208 bar');
  });
  it('returns null for no reading', () => {
    expect(formatPressure(null)).toBeNull();
  });
});

describe('formatDiveDate', () => {
  it('renders a stored calendar date without a timezone shift', () => {
    expect(formatDiveDate('2026-08-16')).toBe('16 Aug 2026');
  });
  it('renders 1 January without rolling to the previous year', () => {
    expect(formatDiveDate('2026-01-01')).toBe('1 Jan 2026');
  });
  it('hands back an uninterpretable value unchanged rather than inventing a date', () => {
    expect(formatDiveDate('not a date')).toBe('not a date');
  });
  // Review task 7, cannot-fail #3: 'not a date' never reaches the documented
  // `isCalendarDate` guard this test claims to cover — it's caught by the
  // `Number.isInteger(year)` backstop a few lines down regardless, so deleting the guard
  // survived every test in the suite. The guard's real job is a well-formed-but-impossible
  // date: with it removed this would return the invented "30 Feb 2026" instead.
  it('hands back a well-formed but impossible calendar date unchanged, rather than inventing one', () => {
    expect(formatDiveDate('2026-02-30')).toBe('2026-02-30');
  });
});

describe('formatTimeRange', () => {
  it('shows entry and computed exit', () => {
    expect(formatTimeRange('09:30', 44)).toBe('09:30 – 10:14');
  });
  it('shows entry alone when there is no duration', () => {
    expect(formatTimeRange('09:30', null)).toBe('09:30');
  });
  it('returns null when there is no entry time', () => {
    expect(formatTimeRange(null, 44)).toBeNull();
  });
});

// Review task 7, Minor #4: entry/salinity/waterBody/suit used to reach the screen as the
// raw stored value ("semidry", "quarry") — the database's vocabulary, not the diver's.
// Every union in domain/types.ts for these four fields is a single lowercase word, so a
// shared capitalise-first-letter formatter is enough for all of them with nothing to keep
// in sync as those unions grow — no per-value table to miss an entry in.
describe('formatEntry', () => {
  it('capitalises the stored value', () => {
    expect(formatEntry('shore')).toBe('Shore');
    expect(formatEntry('boat')).toBe('Boat');
  });
  it('returns null for an unrecorded entry', () => {
    expect(formatEntry(null)).toBeNull();
  });
});

describe('formatSalinity', () => {
  it('capitalises the stored value', () => {
    expect(formatSalinity('brackish')).toBe('Brackish');
  });
  it('returns null for an unrecorded salinity', () => {
    expect(formatSalinity(null)).toBeNull();
  });
});

describe('formatWaterBody', () => {
  it('capitalises the stored value', () => {
    expect(formatWaterBody('quarry')).toBe('Quarry');
  });
  it('returns null for an unrecorded water body', () => {
    expect(formatWaterBody(null)).toBeNull();
  });
});

describe('formatSuit', () => {
  it('capitalises the stored value', () => {
    expect(formatSuit('semidry')).toBe('Semidry');
  });
  it('returns null for an unrecorded suit', () => {
    expect(formatSuit(null)).toBeNull();
  });
});

// `status` is never null (domain/types.ts — the one exception alongside id and date), so
// unlike the four formatters above this one has no null case to return: every dive has one
// to show.
describe('formatDiveStatus', () => {
  it('capitalises a logged dive', () => {
    expect(formatDiveStatus('logged')).toBe('Logged');
  });
  it('capitalises a planned dive', () => {
    expect(formatDiveStatus('planned')).toBe('Planned');
  });
});

// Review task 7, Important #1: the eight formatters below are new — they close the seven
// fields that used to build their own `${x} unit` strings inline in DiveDetailScreen.tsx,
// bypassing this module and rendering the literal string "NaN" for exactly the input
// DESIGN.md §10's COERCION CONTRACT requires M1c's form to produce. Each gets the same two
// cases every formatter above does (a real reading, and the absent/non-finite cases this
// module exists to swallow), plus whatever is specific to its own unit.

describe('formatWeight', () => {
  it('renders kilograms unrounded — weighting is often set in half-kilos', () => {
    expect(formatWeight(6.5)).toBe('6.5 kg');
  });
  it('returns null for an unrecorded weight rather than a zero', () => {
    expect(formatWeight(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatWeight(Number.NaN)).toBeNull();
  });
});

describe('formatVolume', () => {
  it('renders litres unrounded, since a real cylinder size can be fractional', () => {
    expect(formatVolume(11.1)).toBe('11.1 l');
  });
  it('returns null for an unrecorded size', () => {
    expect(formatVolume(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatVolume(Number.NaN)).toBeNull();
  });
});

describe('formatGasUsed', () => {
  it('rounds a computed total to the whole litre, unlike formatVolume', () => {
    expect(formatGasUsed(2381.7)).toBe('2382 l');
  });
  it('returns null when the total could not be computed', () => {
    expect(formatGasUsed(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatGasUsed(Number.NaN)).toBeNull();
  });
});

describe('formatRmv', () => {
  it('renders to one decimal place', () => {
    expect(formatRmv(18.42)).toBe('18.4 l/min');
  });
  it('returns null when RMV could not be computed', () => {
    expect(formatRmv(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatRmv(Number.NaN)).toBeNull();
  });
});

describe('formatPercent', () => {
  it('renders a gas fraction unrounded', () => {
    expect(formatPercent(32)).toBe('32 %');
  });
  it('returns null for an unrecorded fraction', () => {
    expect(formatPercent(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatPercent(Number.NaN)).toBeNull();
  });
});

describe('formatCount', () => {
  it('renders a plain cylinder count', () => {
    expect(formatCount(2)).toBe('2');
  });
  it('returns null for an unrecorded count', () => {
    expect(formatCount(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatCount(Number.NaN)).toBeNull();
  });
});

describe('formatConditionScale', () => {
  it('renders the bare 0–3 scale as recorded', () => {
    expect(formatConditionScale(2)).toBe('2');
  });
  it('returns null for an unrecorded reading', () => {
    expect(formatConditionScale(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatConditionScale(Number.NaN)).toBeNull();
  });
});

describe('formatCoordinates', () => {
  it('renders both coordinates to five decimal places', () => {
    expect(formatCoordinates(50.123456, 14.567891)).toBe('50.12346, 14.56789');
  });
  it('returns null when either coordinate alone is missing — a lone one is not a point', () => {
    expect(formatCoordinates(null, 14.5)).toBeNull();
    expect(formatCoordinates(50.1, null)).toBeNull();
  });
  it('returns null rather than rendering half a NaN pair', () => {
    expect(formatCoordinates(Number.NaN, 14.5)).toBeNull();
    expect(formatCoordinates(50.1, Number.NaN)).toBeNull();
  });
});

describe('formatRating', () => {
  it('renders out of five', () => {
    expect(formatRating(4)).toBe('4 / 5');
  });
  it('returns null for an unrecorded rating', () => {
    expect(formatRating(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatRating(Number.NaN)).toBeNull();
  });
});

// Review task 7, Important #2: surfaceIntervalMin used to reach the screen through
// formatDuration, unbounded — two logged dives a year apart rendered "525555 min".
// derived.ts now refuses anything a day or over, so this only ever has to present a value
// under 24 h — but even well inside that bound, a raw minute count stops being readable
// long before it stops being real: "1340 min" does not read as "almost a day" the way
// "22 h 20 min" does.
describe('formatSurfaceInterval', () => {
  it('renders under an hour in plain minutes, like a short dive duration', () => {
    expect(formatSurfaceInterval(44)).toBe('44 min');
  });
  it('switches to hours and minutes at an hour and above', () => {
    expect(formatSurfaceInterval(102)).toBe('1 h 42 min');
    expect(formatSurfaceInterval(1340)).toBe('22 h 20 min');
  });
  it('drops the minutes when they are exactly zero', () => {
    expect(formatSurfaceInterval(120)).toBe('2 h');
  });
  it('returns null for no previous dive to measure from', () => {
    expect(formatSurfaceInterval(null)).toBeNull();
  });
  it('returns null rather than rendering NaN', () => {
    expect(formatSurfaceInterval(Number.NaN)).toBeNull();
  });
});

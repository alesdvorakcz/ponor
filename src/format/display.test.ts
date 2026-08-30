import {
  formatDepth,
  formatDuration,
  formatDiveDate,
  formatEntry,
  formatPressure,
  formatSalinity,
  formatSuit,
  formatTemperature,
  formatTimeRange,
  formatWaterBody,
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
});

describe('formatDuration', () => {
  it('renders whole minutes', () => {
    expect(formatDuration(44)).toBe('44 min');
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

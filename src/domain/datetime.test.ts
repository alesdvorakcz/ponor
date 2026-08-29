import {
  calendarDateToUtcMs,
  isCalendarDate,
  isTimeOfDay,
  normaliseCalendarDate,
  normaliseTimeOfDay,
  storedCalendarDate,
  storedTimeOfDay,
  timeOfDayToMinutes,
} from './datetime';

describe('normaliseTimeOfDay', () => {
  it('passes a canonical time through unchanged', () => {
    expect(normaliseTimeOfDay('07:30')).toBe('07:30');
    expect(normaliseTimeOfDay('00:00')).toBe('00:00');
    expect(normaliseTimeOfDay('23:59')).toBe('23:59');
  });

  it('pads an unambiguous one-digit hour rather than refusing it', () => {
    // The whole point of the module: '7:30' used to sort after '19:00' in the
    // dive list while derived.ts refused to read it at all. One reading, one
    // verdict.
    expect(normaliseTimeOfDay('7:30')).toBe('07:30');
    expect(normaliseTimeOfDay('0:05')).toBe('00:05');
  });

  it('trims surrounding whitespace, which a text field yields freely', () => {
    expect(normaliseTimeOfDay(' 07:30 ')).toBe('07:30');
  });

  it('refuses a time that names no real moment', () => {
    expect(normaliseTimeOfDay('24:00')).toBeNull();
    expect(normaliseTimeOfDay('25:00')).toBeNull();
    expect(normaliseTimeOfDay('08:60')).toBeNull();
    expect(normaliseTimeOfDay('-1:00')).toBeNull();
  });

  it('refuses rather than guesses when the minute is ambiguous', () => {
    // '8:1' could be 08:01 or 08:10 and nothing here may pick one.
    expect(normaliseTimeOfDay('8:1')).toBeNull();
    expect(normaliseTimeOfDay('08:1')).toBeNull();
  });

  it('refuses blank, non-string and structurally wrong values', () => {
    expect(normaliseTimeOfDay('')).toBeNull();
    expect(normaliseTimeOfDay('   ')).toBeNull();
    expect(normaliseTimeOfDay('later')).toBeNull();
    expect(normaliseTimeOfDay('07:30:00')).toBeNull();
    expect(normaliseTimeOfDay(null)).toBeNull();
    expect(normaliseTimeOfDay(undefined)).toBeNull();
    expect(normaliseTimeOfDay(730)).toBeNull();
    expect(normaliseTimeOfDay({})).toBeNull();
  });
});

describe('normaliseCalendarDate', () => {
  it('passes a canonical date through unchanged', () => {
    expect(normaliseCalendarDate('2026-08-17')).toBe('2026-08-17');
    expect(normaliseCalendarDate('2024-02-29')).toBe('2024-02-29'); // a real leap day
  });

  it('pads an unambiguous unpadded month or day', () => {
    // '2026-8-17' used to be numbered AFTER '2026-08-18', because '8' > '0'.
    expect(normaliseCalendarDate('2026-8-17')).toBe('2026-08-17');
    expect(normaliseCalendarDate('2026-8-7')).toBe('2026-08-07');
  });

  it('refuses a date that parses but names no real day', () => {
    // Date.parse rolls these forward silently: '2026-02-30' comes back as
    // 2026-03-02. Parsing is not the same as existing.
    expect(normaliseCalendarDate('2026-02-30')).toBeNull();
    expect(normaliseCalendarDate('2026-02-31')).toBeNull();
    expect(normaliseCalendarDate('2026-04-31')).toBeNull();
    expect(normaliseCalendarDate('2026-02-29')).toBeNull(); // 2026 is not a leap year
  });

  it('refuses an out-of-range month and other malformed values', () => {
    expect(normaliseCalendarDate('2026-13-01')).toBeNull();
    expect(normaliseCalendarDate('2026-00-01')).toBeNull();
    expect(normaliseCalendarDate('2026-08-00')).toBeNull();
    expect(normaliseCalendarDate('26-08-17')).toBeNull(); // a 2-digit year is not a year
    expect(normaliseCalendarDate('2026-08-17T10:00:00Z')).toBeNull();
    expect(normaliseCalendarDate('')).toBeNull();
    expect(normaliseCalendarDate(null)).toBeNull();
    expect(normaliseCalendarDate(20260817)).toBeNull();
  });
});

describe('the is* predicates, which M1c\'s Zod schema is the first consumer of', () => {
  it('accepts only the canonical spelling, unlike the normalisers', () => {
    expect(isTimeOfDay('07:30')).toBe(true);
    expect(isTimeOfDay('7:30')).toBe(false); // real, but not canonical
    expect(isTimeOfDay('25:00')).toBe(false);
    expect(isCalendarDate('2026-08-17')).toBe(true);
    expect(isCalendarDate('2026-8-17')).toBe(false); // real, but not canonical
    expect(isCalendarDate('2026-02-30')).toBe(false);
  });
});

describe('timeOfDayToMinutes', () => {
  it('counts minutes from midnight', () => {
    expect(timeOfDayToMinutes('00:00')).toBe(0);
    expect(timeOfDayToMinutes('08:12')).toBe(492);
    expect(timeOfDayToMinutes('23:59')).toBe(1439);
  });

  it('reads a loosely spelled time the same way the normaliser does', () => {
    expect(timeOfDayToMinutes('7:30')).toBe(450);
    expect(timeOfDayToMinutes('07:30')).toBe(450);
  });

  it('is null for anything that names no real time', () => {
    expect(timeOfDayToMinutes('24:00')).toBeNull();
    expect(timeOfDayToMinutes('')).toBeNull();
    expect(timeOfDayToMinutes(null)).toBeNull();
  });
});

describe('calendarDateToUtcMs', () => {
  it('is UTC midnight on that date', () => {
    expect(calendarDateToUtcMs('2026-08-17')).toBe(Date.UTC(2026, 7, 17));
    expect(calendarDateToUtcMs('2026-8-17')).toBe(Date.UTC(2026, 7, 17));
  });

  it('measures whole days between two dates, the only thing it is used for', () => {
    const a = calendarDateToUtcMs('2026-02-28');
    const b = calendarDateToUtcMs('2026-03-01');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((Number(b) - Number(a)) / 86400000).toBe(1);
  });

  it('is null for an impossible date rather than the day it would roll to', () => {
    expect(calendarDateToUtcMs('2026-02-30')).toBeNull();
    expect(Date.parse('2026-02-30T00:00:00.000Z')).not.toBeNaN(); // ...which is why the check is needed
  });
});

describe('the write-boundary policy', () => {
  it('canonicalises a real date and leaves an unreadable one exactly as typed', () => {
    expect(storedCalendarDate('2026-8-17')).toBe('2026-08-17');
    expect(storedCalendarDate('2026-08-17')).toBe('2026-08-17');
    // Never null and never a rejection — the column is NOT NULL and §1 says a
    // save is never blocked.
    expect(storedCalendarDate('2026-02-30')).toBe('2026-02-30');
    expect(storedCalendarDate('sometime in August')).toBe('sometime in August');
  });

  it('turns a blank timeIn into null, the value the column already uses for "no time"', () => {
    expect(storedTimeOfDay('')).toBeNull();
    expect(storedTimeOfDay('   ')).toBeNull();
    expect(storedTimeOfDay(null)).toBeNull();
    expect(storedTimeOfDay(undefined)).toBeNull();
  });

  it('canonicalises a real time and keeps an unreadable non-blank one', () => {
    expect(storedTimeOfDay('7:30')).toBe('07:30');
    expect(storedTimeOfDay('07:30')).toBe('07:30');
    expect(storedTimeOfDay('after lunch')).toBe('after lunch');
  });
});

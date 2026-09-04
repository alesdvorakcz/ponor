import {
  calendarDateToLocalDate,
  calendarDateToUtcMs,
  daysBetweenCalendarDates,
  isCalendarDate,
  isTimeOfDay,
  localDateToCalendarDate,
  localDateToTimeOfDay,
  normaliseCalendarDate,
  normaliseTimeOfDay,
  storedCalendarDate,
  storedTimeOfDay,
  timeOfDayToLocalDate,
  timeOfDayToMinutes,
  todayCalendarDate,
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

/**
 * The picker boundary (M1d): a native picker hands back a JS `Date`, and this app stores
 * `YYYY-MM-DD` / `HH:MM` strings. Everything below is zone-INDEPENDENT — spelling, refusal,
 * and round-tripping — and runs in whatever zone the machine is in.
 *
 * The half that only means anything in a non-UTC zone lives in its own two files,
 * `datetime.utc-plus-14.test.ts` and `datetime.utc-minus-11.test.ts`, which force the zone
 * through a custom Jest environment (`jest/timeZoneEnvironment.js`). Both are needed, and
 * neither belongs here: the naive `toISOString()` spelling of these functions passes every
 * assertion in this file, in every zone, and is wrong in all of them.
 */
describe('the picker boundary', () => {
  it('spells a picked date the way the rest of this module does', () => {
    expect(localDateToCalendarDate(new Date(2026, 0, 7, 12, 0))).toBe('2026-01-07');
    expect(localDateToCalendarDate(new Date(2026, 11, 31, 12, 0))).toBe('2026-12-31');
    expect(localDateToCalendarDate(new Date(2024, 1, 29, 12, 0))).toBe('2024-02-29');
  });

  it('spells a picked time the way the rest of this module does', () => {
    expect(localDateToTimeOfDay(new Date(2026, 7, 31, 7, 5))).toBe('07:05');
    expect(localDateToTimeOfDay(new Date(2026, 7, 31, 12, 0))).toBe('12:00');
  });

  it('refuses anything that is not a real moment, rather than spelling out NaN', () => {
    // `new Date('not a date').getFullYear()` is NaN, and a template string built from it
    // reads 'NaN-NaN-NaN' — a value that would reach the database looking like a date.
    expect(localDateToCalendarDate(new Date('not a date'))).toBeNull();
    expect(localDateToTimeOfDay(new Date(Number.NaN))).toBeNull();
    // A picker's own onChange hands back `Date | undefined`, so undefined is the ordinary
    // dismissed-without-choosing case, not a contrived one.
    expect(localDateToCalendarDate(undefined)).toBeNull();
    expect(localDateToTimeOfDay(undefined)).toBeNull();
    expect(localDateToCalendarDate(null)).toBeNull();
    // A string is not a Date, however date-shaped it looks.
    expect(localDateToCalendarDate('2026-08-31')).toBeNull();
    expect(localDateToTimeOfDay('07:30')).toBeNull();
  });

  it('seeds the picker from a stored value, reading it as leniently as everything else here', () => {
    expect(localDateToCalendarDate(calendarDateToLocalDate('2026-8-7'))).toBe('2026-08-07');
    expect(localDateToTimeOfDay(timeOfDayToLocalDate('7:30'))).toBe('07:30');
  });

  it('round-trips every value a picker can hand back', () => {
    for (const value of ['2026-08-31', '2026-01-01', '2024-02-29', '2026-12-31']) {
      expect(localDateToCalendarDate(calendarDateToLocalDate(value))).toBe(value);
    }
    const base = new Date(2026, 7, 31, 12, 0);
    for (const value of ['00:00', '07:30', '12:00', '23:59']) {
      expect(localDateToTimeOfDay(timeOfDayToLocalDate(value, base))).toBe(value);
    }
  });

  it('puts a seeded time on the base day, since a time picker shows no date of its own', () => {
    // Deliberately a day that cannot be today, however long this project runs: an earlier
    // draft used a base of "today", so an implementation that ignored `base` entirely and
    // called `new Date()` passed it — a test that could only fail on other days of the year.
    const seeded = timeOfDayToLocalDate('07:30', new Date(2019, 2, 4, 19, 45));
    expect(seeded?.getFullYear()).toBe(2019);
    expect(seeded?.getMonth()).toBe(2);
    expect(seeded?.getDate()).toBe(4);
    expect(seeded?.getHours()).toBe(7);
    expect(seeded?.getMinutes()).toBe(30);
  });

  it('refuses to seed from a value naming no real date or time', () => {
    expect(calendarDateToLocalDate('2026-02-30')).toBeNull();
    expect(calendarDateToLocalDate('')).toBeNull();
    expect(calendarDateToLocalDate(null)).toBeNull();
    expect(timeOfDayToLocalDate('25:00')).toBeNull();
    expect(timeOfDayToLocalDate('')).toBeNull();
    expect(timeOfDayToLocalDate(null)).toBeNull();
  });

  it('keeps a two-digit year in its own century, where the Date constructor would not', () => {
    // `new Date(99, 0, 1)` is 1999, not year 99 — the legacy two-digit-year mapping. A
    // sync'd row dated '0099-01-01' is absurd but reachable, and silently becoming 1999
    // would make the picker open on a different century than the one stored.
    expect(calendarDateToLocalDate('0099-01-01')?.getFullYear()).toBe(99);
    expect(localDateToCalendarDate(calendarDateToLocalDate('0099-01-01'))).toBe('0099-01-01');
  });
});

/**
 * `todayCalendarDate` — the one owner of "what day is it where the diver is". Which day
 * that actually is under an extreme offset is proved in `datetime.utc-plus-14.test.ts` and
 * `datetime.utc-minus-11.test.ts`; this block covers the contract that holds in every zone.
 */
describe('todayCalendarDate', () => {
  it('reads the day an injected clock falls on, in canonical form', () => {
    expect(todayCalendarDate(new Date(2026, 7, 31, 0, 30))).toBe('2026-08-31');
    expect(todayCalendarDate(new Date(2026, 7, 31, 23, 30))).toBe('2026-08-31');
    // Single-digit month and day, where the padding is what makes the result canonical.
    expect(todayCalendarDate(new Date(2026, 0, 7, 12, 0))).toBe('2026-01-07');
  });

  it('agrees with the picker boundary, because it is the same conversion', () => {
    // Not a tautology dressed up as a test: it is the assertion that would fail the moment
    // someone "fixed" one of these two by writing the conversion out a second time.
    for (const moment of [new Date(2026, 7, 31, 0, 30), new Date(2019, 2, 4, 19, 45), new Date(2024, 1, 29, 23, 59)]) {
      expect(todayCalendarDate(moment)).toBe(localDateToCalendarDate(moment));
    }
  });

  it('always names a real date this module can read back', () => {
    expect(isCalendarDate(todayCalendarDate())).toBe(true);
  });

  it('answers with the real today when the injected clock is not a usable moment', () => {
    // Unlike everything else here, this never returns null: a caller asking what today is
    // has nothing sensible to do with "no answer", and an unusable injected clock is a test
    // artefact rather than something a diver typed. Compared against a moment taken here
    // rather than a fixed string, so this cannot rot as the calendar moves.
    const realToday = localDateToCalendarDate(new Date());
    expect(todayCalendarDate(new Date(NaN))).toBe(realToday);
    expect(todayCalendarDate(undefined as unknown as Date)).toBe(realToday);
    expect(todayCalendarDate('2026-08-31' as unknown as Date)).toBe(realToday);
  });
});

/**
 * `daysBetweenCalendarDates` — the arithmetic §3's *currency* is counted in (M3a). What these
 * tests are about is the two ways a day count goes wrong without looking wrong: a local-clock
 * frame that loses or gains a day at a DST boundary or across a time zone, and a date the
 * parser should refuse being silently rolled forward instead.
 */
describe('daysBetweenCalendarDates', () => {
  it('counts whole days forward, and calls the same day nought', () => {
    expect(daysBetweenCalendarDates('2026-08-31', '2026-08-31')).toBe(0);
    expect(daysBetweenCalendarDates('2026-08-30', '2026-08-31')).toBe(1);
    expect(daysBetweenCalendarDates('2026-08-01', '2026-08-31')).toBe(30);
  });

  // Signed, and the sign is load-bearing: §3's currency uses it to tell a dive that has already
  // happened from one dated ahead of today, which is the difference between "you dived
  // yesterday" and "you have a dive booked" (§2.4).
  it('counts backwards as a negative rather than as a magnitude', () => {
    expect(daysBetweenCalendarDates('2026-08-31', '2026-08-30')).toBe(-1);
    expect(daysBetweenCalendarDates('2026-09-30', '2026-08-31')).toBe(-30);
  });

  // Month and year ends, where an implementation counting components rather than instants goes
  // wrong: February in a leap year, and the turn of a year.
  it('crosses month, year and leap-day boundaries', () => {
    expect(daysBetweenCalendarDates('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetweenCalendarDates('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetweenCalendarDates('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetweenCalendarDates('2025-01-01', '2026-01-01')).toBe(365);
  });

  // **The DST case, and the reason this reads `calendarDateToUtcMs` rather than a local `Date`.**
  // Europe/Prague springs forward on 29 March 2026 and back on 25 October 2026, so those local
  // days are 23 and 25 hours long; measured on a local clock, one of these divisions floors to
  // 0 days and the other to 1 with an hour left over. On UTC midnights both are exactly one.
  // The suite runs in the repo's fixed zone, and the sibling `*.utc-plus-14` / `*.utc-minus-11`
  // suites are what prove the frame holds at the extremes.
  it('counts a day as a day across a daylight-saving change', () => {
    expect(daysBetweenCalendarDates('2026-03-29', '2026-03-30')).toBe(1);
    expect(daysBetweenCalendarDates('2026-10-25', '2026-10-26')).toBe(1);
    expect(daysBetweenCalendarDates('2026-03-28', '2026-03-30')).toBe(2);
  });

  // A date this module refuses to read is refused here too, rather than counted from wherever
  // `Date.parse` would have rolled it. '2026-02-30' is the one that matters: it parses happily
  // as 2 March, so an implementation that skipped `calendarDateToUtcMs` would report a gap two
  // days short and nothing would look wrong.
  it.each([
    ['an impossible day', '2026-02-30'],
    ['a month past twelve', '2026-13-01'],
    ['free text', 'yesterday'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 20260831],
  ])('refuses to count from %s', (_label, bad) => {
    expect(daysBetweenCalendarDates(bad, '2026-08-31')).toBeNull();
    expect(daysBetweenCalendarDates('2026-08-31', bad)).toBeNull();
  });

  // Canonical form is the parser's job, not the caller's — the same guarantee
  // `compareDiveOrder` leans on so that '2026-8-17' does not sort after '2026-08-18'.
  it('reads a date however it was spelled', () => {
    expect(daysBetweenCalendarDates('2026-8-30', '2026-08-31')).toBe(1);
  });
});

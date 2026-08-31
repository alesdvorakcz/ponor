/**
 * @jest-environment ./jest/timeZoneEnvironment.js
 * @jest-environment-options {"timeZone": "Pacific/Niue"}
 */

import { calendarDateToLocalDate, localDateToCalendarDate, localDateToTimeOfDay, timeOfDayToLocalDate } from './datetime';

/**
 * The picker boundary, in the furthest inhabited zone WEST of Greenwich (UTC-11). The
 * mirror image of `datetime.utc-plus-14.test.ts`, and needed alongside it because the naive
 * `toISOString()` spelling fails the two sides at different times of day: east of Greenwich
 * it loses a day over a local MORNING, west of it over a local EVENING. A test written only
 * for one side passes against a broken implementation on the other.
 *
 * The evening is not a contrived hour to pick here: a dive log gets written up after the
 * last dive of the day, and `formatDiveDate`'s own docblock records this same zone-west
 * failure already reaching the screen once.
 */
describe('the picker boundary, forced into Pacific/Niue (UTC-11)', () => {
  it('is really running in that zone, so the assertions below mean what they say', () => {
    expect(-new Date(2026, 7, 31, 12).getTimezoneOffset()).toBe(-11 * 60);
    // The trap, as a fact about the platform: this local instant is already the NEXT day in
    // UTC, and `new Date('2026-08-31')` is the day BEFORE the one it spells.
    expect(new Date(2026, 7, 31, 23, 30).toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(new Date('2026-08-31').getDate()).toBe(30);
  });

  it('stores the day the diver picked, not the UTC day that instant falls in', () => {
    expect(localDateToCalendarDate(new Date(2026, 7, 31, 23, 30))).toBe('2026-08-31');
    expect(localDateToCalendarDate(new Date(2026, 7, 31, 18, 0))).toBe('2026-08-31');
  });

  it('reads the wall clock the diver saw, not the UTC clock', () => {
    expect(localDateToTimeOfDay(new Date(2026, 7, 31, 23, 30))).toBe('23:30');
    expect(localDateToTimeOfDay(new Date(2026, 7, 31, 18, 0))).toBe('18:00');
  });

  it('opens the picker on the stored day, not the day before it', () => {
    const seeded = calendarDateToLocalDate('2026-08-31');
    expect(seeded?.getFullYear()).toBe(2026);
    expect(seeded?.getMonth()).toBe(7);
    expect(seeded?.getDate()).toBe(31);
    expect(localDateToCalendarDate(seeded)).toBe('2026-08-31');
  });

  it('seeds a time picker on the wall clock, so a late entry time survives the round trip', () => {
    const seeded = timeOfDayToLocalDate('23:30', new Date(2026, 7, 31, 12, 0));
    expect(seeded?.getHours()).toBe(23);
    expect(seeded?.getMinutes()).toBe(30);
    expect(localDateToTimeOfDay(seeded)).toBe('23:30');
  });
});

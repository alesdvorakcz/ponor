/**
 * @jest-environment ./jest/timeZoneEnvironment.js
 * @jest-environment-options {"timeZone": "Pacific/Kiritimati"}
 */

import { calendarDateToLocalDate, localDateToCalendarDate, localDateToTimeOfDay } from './datetime';

/**
 * The picker boundary, in the furthest zone EAST of Greenwich (UTC+14, and a real place
 * people dive). Here a local calendar day starts fourteen hours before UTC's does, so the
 * whole of a local morning still falls on the previous UTC date.
 *
 * That is the exact shape of the bug this file exists to prevent: `toISOString().slice(0,
 * 10)` on the `Date` a date picker hands back stores the UTC day, so a dive picked for
 * 31 Aug is written down as 30 Aug — a wrong date on a dive log, silently, with no error
 * anywhere. DESIGN.md §10 records the same class of defect twice already (`formatDiveDate`,
 * `carryOverDate`).
 *
 * The zone is forced by `jest/timeZoneEnvironment.js` rather than inherited: setting
 * `process.env.TZ` from inside a test file does nothing at all (Jest sandboxes `process`),
 * and CI machines run in UTC, where every assertion below passes for the naive version too.
 * The first test therefore checks the zone itself — without it this whole file could quietly
 * be exercising Europe/Prague, which is what the first draft of it actually did.
 */
describe('the picker boundary, forced into Pacific/Kiritimati (UTC+14)', () => {
  it('is really running in that zone, so the assertions below mean what they say', () => {
    expect(-new Date(2026, 7, 31, 12).getTimezoneOffset()).toBe(14 * 60);
    // And the trap itself, stated as a fact about the platform rather than about our code:
    // this local instant genuinely is the previous day in UTC.
    expect(new Date(2026, 7, 31, 0, 0).toISOString().slice(0, 10)).toBe('2026-08-30');
  });

  it('stores the day the diver picked, not the UTC day that instant falls in', () => {
    // Local midnight is precisely what `calendarDateToLocalDate` seeds the picker with, so
    // this is the ordinary case here, not an edge one.
    expect(localDateToCalendarDate(new Date(2026, 7, 31, 0, 0))).toBe('2026-08-31');
    // A morning dive, likewise still the previous day in UTC.
    expect(localDateToCalendarDate(new Date(2026, 7, 31, 9, 15))).toBe('2026-08-31');
  });

  it('reads the wall clock the diver saw, not the UTC clock', () => {
    expect(localDateToTimeOfDay(new Date(2026, 7, 31, 0, 30))).toBe('00:30');
    expect(localDateToTimeOfDay(new Date(2026, 7, 31, 9, 15))).toBe('09:15');
  });

  it('opens the picker on the stored day, at local midnight', () => {
    const seeded = calendarDateToLocalDate('2026-08-31');
    expect(seeded?.getFullYear()).toBe(2026);
    expect(seeded?.getMonth()).toBe(7);
    expect(seeded?.getDate()).toBe(31);
    expect(seeded?.getHours()).toBe(0);
    // `new Date('2026-08-31')` would be UTC midnight, which is 14:00 local on the same day
    // here — right day, wrong hour, and the wrong day entirely west of Greenwich.
    expect(localDateToCalendarDate(seeded)).toBe('2026-08-31');
  });
});

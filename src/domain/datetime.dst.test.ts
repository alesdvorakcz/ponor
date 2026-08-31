/**
 * @jest-environment ./jest/timeZoneEnvironment.js
 * @jest-environment-options {"timeZone": "America/New_York"}
 */

import { localDateToTimeOfDay, timeOfDayToLocalDate } from './datetime';

/**
 * The hour a calendar day can be missing, and what that does to a time picker's seed.
 *
 * `timeOfDayToLocalDate` puts a stored `HH:MM` onto a day so the picker can open on it, and
 * which day it picks is not cosmetic: a wall-clock time is not a fact independent of its
 * date. On a spring-forward date the local clock jumps 02:00 -> 03:00, so `new Date(y, m, d,
 * 2, 30)` is 03:30 — the constructor normalises past a gap that has no 02:30 in it. Seeded
 * that way, an Android picker opens on 03:30 over a stored 02:30 and confirming it without
 * touching anything writes the hour back changed.
 *
 * Forced into a zone with a transition, because the whole defect is invisible without one:
 * a suite in UTC — or in any zone whose clocks never move — cannot tell a seed built on the
 * dive's own date apart from one built on today. `America/New_York` springs forward on
 * 2026-03-08; this machine's own zone (Europe/Prague) does it three weeks later, so forcing
 * the zone here is also what makes the date below mean the same thing wherever this runs.
 * The zone has to be forced from `jest/timeZoneEnvironment.js`: assigning `process.env.TZ`
 * inside a test file does nothing at all, since Jest hands the sandbox a copy of `process`.
 */
describe('seeding a time picker across a DST transition, forced into America/New_York', () => {
  /** Local midnight on the day the clocks go forward. Built from local components, which is
   * what "that calendar day, where the diver is" means; `new Date('2026-03-08')` is UTC. */
  const SPRING_FORWARD = new Date(2026, 2, 8);
  const AN_ORDINARY_DAY = new Date(2026, 7, 16);

  it('is really running in a zone whose clocks move, so the assertions below mean what they say', () => {
    // Standard time in March, daylight time in August — the offset itself is the proof, and
    // a zone without a transition would report the same number for both.
    expect(-SPRING_FORWARD.getTimezoneOffset()).toBe(-5 * 60);
    expect(-AN_ORDINARY_DAY.getTimezoneOffset()).toBe(-4 * 60);
    // The trap, stated as a fact about the platform rather than about this app: that day
    // genuinely has no 02:30 for a `Date` to sit on.
    expect(new Date(2026, 2, 8, 2, 30).getHours()).toBe(3);
  });

  it('seeds an ordinary day at the time actually stored', () => {
    const seeded = timeOfDayToLocalDate('02:30', AN_ORDINARY_DAY);
    expect(localDateToTimeOfDay(seeded)).toBe('02:30');
    // On the dive's own day, so a picker confirmed unchanged writes back what it was given.
    expect(seeded?.getMonth()).toBe(7);
    expect(seeded?.getDate()).toBe(16);
  });

  it('reads 02:30 as 03:30 only on the day that has no 02:30, which is why the day must be the dive’s own', () => {
    // The defect in one line: this is what every dive's entry-time picker was seeded with
    // while `DateTimeField` passed no base at all and the default was `new Date()` — so on
    // the two transition Sundays a year, a dive from any other date opened an hour late and
    // confirming the picker rewrote it.
    expect(localDateToTimeOfDay(timeOfDayToLocalDate('02:30', SPRING_FORWARD))).toBe('03:30');
    // ...and the same dive's own date gives the diver back their own time.
    expect(localDateToTimeOfDay(timeOfDayToLocalDate('02:30', AN_ORDINARY_DAY))).toBe('02:30');
  });

  it('leaves every other hour of a transition day alone — only the missing one moves', () => {
    // The guard against "seeded from the dive's date" being read as "the transition day is
    // broken": a dive that really was logged that Sunday at 09:15 seeds at 09:15.
    expect(localDateToTimeOfDay(timeOfDayToLocalDate('09:15', SPRING_FORWARD))).toBe('09:15');
    expect(localDateToTimeOfDay(timeOfDayToLocalDate('01:30', SPRING_FORWARD))).toBe('01:30');
  });
});

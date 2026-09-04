/**
 * @jest-environment ./jest/timeZoneEnvironment.js
 * @jest-environment-options {"timeZone": "Pacific/Kiritimati"}
 */

import { certificationExpiry } from './certifications';
import { todayCalendarDate } from './datetime';

/**
 * **§6's expiry boundary against the device's own day, in the furthest zone EAST of Greenwich**
 * (UTC+14, and a real place people dive). A local calendar day starts fourteen hours before
 * UTC's does, so the whole of a local morning still falls on the previous UTC date.
 *
 * ── What is genuinely zone-sensitive here, and what is not ────────────────────────────────
 *
 * `certificationExpiry` itself is not: it compares two calendar dates through
 * `calendarDateToUtcMs` (domain/datetime.ts), and two values converted the same way sort the
 * same way in every zone. Writing a "same answer in two zones" test of that function alone
 * would be a guard that cannot fail, which this project has repeatedly found to be worse than
 * no guard at all.
 *
 * **What is zone-sensitive is where the second argument comes from**, and that is why this file
 * tests the composition rather than the function. `SettingsScreen` asks `todayCalendarDate()`
 * and hands the answer down; the shape that breaks is a screen — or a future `expiry()` with
 * no parameter — reading the clock itself as `new Date().toISOString().slice(0, 10)`, which is
 * the UTC day. Here that is *yesterday* for the whole local morning, so a card expiring today
 * would be reported **expired on the last day it works**, for divers on one side of the world
 * and not the other. DESIGN.md §10 records the same class of defect twice already
 * (`formatDiveDate`, `carryOverDate`), and §7.3's whole premise is that this app may not reason
 * about a diver's day from a clock.
 *
 * The zone is forced by `jest/timeZoneEnvironment.js` rather than inherited:
 * `datetime.utc-plus-14.test.ts` records why — setting `process.env.TZ` from inside a test file
 * does nothing (Jest sandboxes `process`), and CI machines run in UTC, where every assertion
 * below passes for the naive version too. The first case therefore checks the zone itself.
 */
describe('an expiry judged against the device’s own day, in Pacific/Kiritimati (UTC+14)', () => {
  it('is really running in that zone, and the trap is really there', () => {
    expect(-new Date(2026, 8, 4, 12).getTimezoneOffset()).toBe(14 * 60);
    // The trap, as a fact about the platform rather than about our code: a local instant in the
    // morning genuinely is the previous day in UTC.
    expect(new Date(2026, 8, 4, 0, 30).toISOString().slice(0, 10)).toBe('2026-09-03');
  });

  /**
   * **The defect demonstrated, not merely avoided.** One instant, two ways of naming the day it
   * falls on, and a card that really has run out: against the diver's own day it reads expired,
   * and against the UTC day it reads current — a certification the app would tell them is still
   * good, for the whole of a local morning.
   *
   * The instant is fixed rather than `new Date()`, so both halves hold at every hour this test
   * could be run at. `todayCalendarDate` takes one for exactly this reason.
   */
  it('would call an expired card current if the day came from UTC instead of the device', () => {
    // Noon UTC on the 3rd is two in the morning on the 4th in Kiritimati.
    const at = new Date(Date.UTC(2026, 8, 3, 12, 0));
    const today = todayCalendarDate(at);
    const utcDay = at.toISOString().slice(0, 10);
    expect([today, utcDay]).toEqual(['2026-09-04', '2026-09-03']);

    // A card that expired yesterday, in the diver's own reckoning.
    expect(certificationExpiry('2026-09-03', today)).toBe('expired');
    expect(certificationExpiry('2026-09-03', utcDay)).toBe('current');
  });

  /** And the other end of the same day: a card expiring on the diver's own today is current,
   * because a certification is valid through its printed date. */
  it('calls a card expiring on the diver’s own today current', () => {
    const at = new Date(Date.UTC(2026, 8, 3, 12, 0));
    const today = todayCalendarDate(at);

    expect(certificationExpiry(today, today)).toBe('current');
  });

  it('still puts the boundary a day either side of that', () => {
    expect(certificationExpiry('2026-09-03', '2026-09-04')).toBe('expired');
    expect(certificationExpiry('2026-09-05', '2026-09-04')).toBe('current');
  });
});

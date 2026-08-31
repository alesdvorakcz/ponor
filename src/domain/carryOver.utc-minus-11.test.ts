/**
 * @jest-environment ./jest/timeZoneEnvironment.js
 * @jest-environment-options {"timeZone": "Pacific/Niue"}
 */

import { carryOverFrom } from './carryOver';
import { todayCalendarDate } from './datetime';
import { dive } from './diveFixture';

/**
 * 23:30 on 31 August 2026, on the clock a diver in this zone is actually looking at.
 * Built from LOCAL components because that is what "the diver's own clock says 23:30"
 * means; `new Date('2026-08-31T23:30')` would be a different instant in every zone.
 */
const LATE_WRITE_UP_LOCAL = new Date(2026, 7, 31, 23, 30);

/**
 * §2.1's "otherwise today", in the furthest inhabited zone WEST of Greenwich (UTC-11) — the
 * mirror of `carryOver.utc-plus-14.test.ts`, and needed alongside it because the naive
 * `toISOString()` spelling fails the two sides at *different hours*: east of Greenwich it
 * loses a day over a local MORNING, west of it over a local EVENING. A suite written for
 * only one side passes against a broken implementation on the other.
 *
 * The evening is not a contrived hour here: a dive log gets written up after the last dive
 * of the day. At 23:30 local this instant is already 1 September in UTC, so a carry-over
 * that computes "today" in UTC prefills *tomorrow's* date — and past a month boundary,
 * which is where a wrong date stops looking like a typo and starts looking like a
 * different trip.
 */
describe('carry-over falling back to today, forced into Pacific/Niue (UTC-11)', () => {
  it('is really running in that zone, so the assertions below mean what they say', () => {
    expect(-LATE_WRITE_UP_LOCAL.getTimezoneOffset()).toBe(-11 * 60);
    // The trap itself, stated as a fact about the platform rather than about our code: this
    // local instant genuinely is the next day, and the next month, in UTC.
    expect(LATE_WRITE_UP_LOCAL.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('prefills the day the diver is living in, not the UTC day, once 48 hours have passed', () => {
    const c = carryOverFrom(dive({ date: '2020-01-01' }), LATE_WRITE_UP_LOCAL);
    expect(c.date).toBe('2026-08-31');
  });

  it("keeps yesterday's date, which the mixed-frame window threw away west of Greenwich", () => {
    // The same defect as the +14 file's, and the reason both sides are needed: a real
    // instant compared against UTC midnight runs the window LONG east of Greenwich and
    // SHORT west of it. Here the second dive of a trip is being logged the evening after
    // the first, and 2026-08-18 20:00 local is already 2026-08-19 07:00 in UTC — 55 h past
    // UTC midnight on the 17th, so the old comparison declared yesterday's dive too old
    // and blanked the site, centre, cylinder and suit the diver was about to reuse.
    const now = new Date(2026, 7, 18, 20, 0);
    const c = carryOverFrom(dive({ date: '2026-08-17' }), now);
    expect(c.date).toBe('2026-08-17');
    expect(todayCalendarDate(now)).toBe('2026-08-18');
  });

  it('still moves to today for a dive two days back here, so the window did not simply widen', () => {
    const now = new Date(2026, 7, 18, 20, 0);
    expect(carryOverFrom(dive({ date: '2026-08-16' }), now).date).toBe('2026-08-18');
  });

  it('lands on that same local day when the previous date is one it refuses to read', () => {
    // '2026-02-30' is the rolled-forward impossible date `calendarDateToUtcMs` refuses and
    // `Date.parse` silently accepts two days late — the other of `carryOverDate`'s two
    // routes to "today", and a second route is exactly where a fix applied in one place
    // rather than at the owner goes wrong.
    const c = carryOverFrom(dive({ date: '2026-02-30' }), LATE_WRITE_UP_LOCAL);
    expect(c.date).toBe('2026-08-31');
  });
});

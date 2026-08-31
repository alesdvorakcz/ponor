/**
 * @jest-environment ./jest/timeZoneEnvironment.js
 * @jest-environment-options {"timeZone": "Pacific/Kiritimati"}
 */

import { carryOverFrom } from './carryOver';
import { todayCalendarDate } from './datetime';
import { dive } from './diveFixture';

/**
 * 00:30 on 31 August 2026, on the clock a diver in this zone is actually looking at.
 * Built from LOCAL components because that is what "the diver's own clock says 00:30"
 * means; `new Date('2026-08-31T00:30')` would be a different instant in every zone.
 */
const NIGHT_DIVE_LOCAL = new Date(2026, 7, 31, 0, 30);

/**
 * §2.1's "otherwise today", in the furthest zone EAST of Greenwich (UTC+14, and a real
 * place people dive).
 *
 * The hour is the whole test. At 12:00 local the UTC day and the local day agree in every
 * zone this side of the date line, so an assertion made there passes against
 * `now.toISOString().slice(0, 10)` just as happily as against the local reading and proves
 * nothing at all. At 00:30 they disagree: this instant is still 30 August in UTC, so a
 * carry-over that computes "today" in UTC prefills a night dive with *yesterday's* date.
 *
 * The window comparison is the second half of this file, and the comment here used to
 * claim it "subtracts one calendar date from another" — a frame consistency the code did
 * not have. It compared `now.getTime()`, a real instant, against UTC midnight of the
 * previous dive's calendar date, so it measured 48 h from local midnight *plus the
 * device's UTC offset*: east of Greenwich the window ran long and kept a stale date, west
 * of it the window ran short and dropped a good one. It really does subtract one calendar
 * date from another now, and `carryOverDate`'s own docblock states which reading of §2.1
 * that is. `carryOver.test.ts` covers the boundary in this machine's own zone; the two
 * zone-forced files cover the offsets where a mixed-frame comparison is visibly wrong.
 *
 * The zone is forced by `jest/timeZoneEnvironment.js` rather than inherited: assigning
 * `process.env.TZ` inside a test file does nothing at all (Jest sandboxes `process`), and
 * CI machines run in UTC, where the bug is invisible by construction.
 */
describe('carry-over falling back to today, forced into Pacific/Kiritimati (UTC+14)', () => {
  it('is really running in that zone, so the assertions below mean what they say', () => {
    expect(-NIGHT_DIVE_LOCAL.getTimezoneOffset()).toBe(14 * 60);
    // The trap itself, stated as a fact about the platform rather than about our code: this
    // local instant genuinely is the previous day in UTC.
    expect(NIGHT_DIVE_LOCAL.toISOString().slice(0, 10)).toBe('2026-08-30');
  });

  it('prefills the day the diver is living in, not the UTC day, once 48 hours have passed', () => {
    const c = carryOverFrom(dive({ date: '2020-01-01' }), NIGHT_DIVE_LOCAL);
    expect(c.date).toBe('2026-08-31');
  });

  it('does not carry a two-day-old date forward, however far east of Greenwich the diver is', () => {
    // The mixed-frame defect, from the side that keeps a date it should drop. Local
    // Wednesday 07:00 is still Tuesday 17:00 in UTC, so `now.getTime()` minus UTC midnight
    // on Monday the 17th came to 41 h — inside a 48 h window — and the form opened on the
    // 17th, two days stale, while `todayCalendarDate` in the same function said the 19th.
    const now = new Date(2026, 7, 19, 7, 0);
    const c = carryOverFrom(dive({ date: '2026-08-17' }), now);
    expect(c.date).toBe('2026-08-19');
    expect(c.date).toBe(todayCalendarDate(now));
  });

  it('still carries yesterday forward here, so the window did not simply shrink', () => {
    // The other side of the same assertion: a fix that narrowed the window instead of
    // moving it into one frame would pass the test above and break carry-over on the
    // second day of every trip.
    expect(carryOverFrom(dive({ date: '2026-08-18' }), new Date(2026, 7, 19, 7, 0)).date).toBe('2026-08-18');
  });

  it('lands on that same local day when the previous date is one it refuses to read', () => {
    // '2026-02-30' is the rolled-forward impossible date `calendarDateToUtcMs` refuses and
    // `Date.parse` silently accepts two days late — the other of `carryOverDate`'s two
    // routes to "today", and a second route is exactly where a fix applied in one place
    // rather than at the owner goes wrong.
    const c = carryOverFrom(dive({ date: '2026-02-30' }), NIGHT_DIVE_LOCAL);
    expect(c.date).toBe('2026-08-31');
  });
});

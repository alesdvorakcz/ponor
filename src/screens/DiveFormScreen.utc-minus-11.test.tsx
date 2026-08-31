/**
 * @jest-environment ./jest/timeZoneEnvironment.js
 * @jest-environment-options {"timeZone": "Pacific/Niue"}
 */

// The package's own official Jest mock, imported first and named `mock...` for the
// babel-plugin-jest-hoist reason DiveFormScreen.test.tsx's own preamble documents at length:
// every `jest.mock()` call is hoisted above every import, and its factory may only close
// over out-of-scope identifiers whose names start with `mock`/`require`.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { render, type RenderResult } from '@testing-library/react-native';

import { useDives } from '../db/useDives';
import DiveFormScreen from './DiveFormScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
// The unit preference (§3), mocked per module exactly as `useDives` is above and for the
// same reason: it is a live database read, and this screen must be renderable in either
// system without one. Left on its own default, `metric`, by every test that does not care
// — which is what keeps the existing assertions below reading in metres, unchanged.
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));

jest.mock('../db/dives', () => ({ createDive: jest.fn(), updateDive: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

/**
 * `mockImplementation`, never `mockReturnValue` — the real `useDives()` hands back a
 * brand-new object holding a brand-new array on every render, and a referentially stable
 * stub models the exact opposite contract. DiveFormScreen.test.tsx's own `stubDives`
 * docblock records what that fiction once hid: this screen looping infinitely on mount
 * while 537 tests stayed green.
 */
function stubNoDives() {
  (useDives as jest.Mock).mockImplementation(() => ({ dives: [], numbers: new Map(), error: undefined }));
}

/** What the `Date` picker field currently shows the diver, by the `` `${label}: ${value}` ``
 * shape `DateTimeField` announces — the only readable value on a control that holds no text
 * of its own. */
function shownDate(t: RenderResult): string {
  const field = (t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : []).find((n) =>
    String(n.props?.accessibilityLabel ?? '').startsWith('Date: '),
  );
  if (!field) throw new Error('no Date field found');
  return String(field.props?.accessibilityLabel).slice('Date: '.length);
}

/**
 * 23:30 on 31 August 2026, on the clock a diver in this zone is actually looking at.
 * Constructed from LOCAL components, and at module scope so it is a real moment taken
 * before any test fakes the clock.
 */
const LATE_WRITE_UP_LOCAL = new Date(2026, 7, 31, 23, 30);

/**
 * Everything Jest's modern fake timers can take over EXCEPT the clock. `setSystemTime` is
 * only available under fake timers, but this screen is a real React tree — its render and
 * `@testing-library/react-native`'s own `act`/cleanup run on microtasks and timers — and
 * freezing those to pin a date would be replacing one source of flakiness with a larger
 * one. Listing them here fakes `Date` alone: `new Date()` reports the moment above, and
 * every scheduling primitive keeps working exactly as it does in the other screen suites.
 */
const CLOCK_ONLY = [
  'hrtime', 'nextTick', 'performance', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback',
  'setImmediate', 'clearImmediate',
  'setInterval', 'clearInterval',
  'setTimeout', 'clearTimeout',
] as const;

/**
 * A new dive's default date, in the furthest inhabited zone WEST of Greenwich (UTC-11) —
 * the mirror of `DiveFormScreen.utc-plus-14.test.tsx`, and needed alongside it because the
 * naive `toISOString()` spelling fails the two sides at *different hours*: east of Greenwich
 * it loses a day over a local MORNING, west of it over a local EVENING. A suite written for
 * only one side passes against a broken implementation on the other.
 *
 * The evening is not a contrived hour here either: a dive log gets written up after the last
 * dive of the day. At 23:30 local this instant is already 1 September in UTC, so a form that
 * computes "today" in UTC opens on *tomorrow's* date — and past a month boundary, which is
 * where a wrong date stops looking like a typo and starts looking like a different trip.
 */
describe('the new-dive date default, forced into Pacific/Niue (UTC-11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubNoDives();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is really running in that zone, so the assertions below mean what they say', () => {
    expect(-LATE_WRITE_UP_LOCAL.getTimezoneOffset()).toBe(-11 * 60);
    // The trap itself, stated as a fact about the platform rather than about our code: this
    // local instant genuinely is the next day, and the next month, in UTC.
    expect(LATE_WRITE_UP_LOCAL.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('opens a late write-up on the day the diver is living in, not the UTC day', async () => {
    jest.useFakeTimers({ now: LATE_WRITE_UP_LOCAL, doNotFake: [...CLOCK_ONLY] });
    const t = await render(<DiveFormScreen mode="create" />);
    // `formatDiveDate`'s spelling of 2026-08-31; 1 Sep 2026 is what the UTC reading shows.
    expect(shownDate(t)).toBe('31 Aug 2026');
  });
});

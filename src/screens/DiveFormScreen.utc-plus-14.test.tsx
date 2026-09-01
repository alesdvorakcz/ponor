/**
 * @jest-environment ./jest/timeZoneEnvironment.js
 * @jest-environment-options {"timeZone": "Pacific/Kiritimati"}
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

// §2.2's remembered group state (M1h), mocked per module for the same reason the hooks above
// are: it is a live database read of a settings row, and this screen must render without one.
// The default — nothing decided about any group, and the read has answered — is what every test
// that does not care about disclosure means, and it is exactly §2.2's own defaults: the two
// groups that start open are open, the other four are shut.
jest.mock('../db/useOpenFormGroups', () => ({ useOpenFormGroups: jest.fn(() => ({ remembered: {}, resolved: true })) }));
jest.mock('../db/dives', () => ({ createDive: jest.fn(), updateDive: jest.fn() }));
// §2.1's cylinder presets (M1e), mocked per module for the same reason the two hooks above
// are: it is a live database read, and this screen must render without one. Nothing in this
// file exercises presets — it exists for the date default alone — so the stub simply reports
// that the diver has none, which is what draws no preset row at all.
jest.mock('../db/useGearPresets', () => ({ useGearPresets: jest.fn(() => ({ presets: [], error: undefined })) }));
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
 * 00:30 on 31 August 2026, on the clock a diver in this zone is actually looking at.
 * Constructed from LOCAL components, and at module scope so it is a real moment taken
 * before any test fakes the clock.
 */
const NIGHT_DIVE_LOCAL = new Date(2026, 7, 31, 0, 30);

/**
 * Everything Jest's modern fake timers can take over EXCEPT the clock. `setSystemTime` is
 * only available under fake timers, but this screen is a real React tree — its render and
 * `@testing-library/react-native`'s own `act`/cleanup run on microtasks and timers — and
 * freezing those to pin a date would be replacing one source of flakiness with a larger
 * one. Listing them here fakes `Date` alone: `new Date()` reports the moment below, and
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
 * A new dive's default date, in the furthest zone EAST of Greenwich (UTC+14, and a real
 * place people dive).
 *
 * The hour is the whole test. At 12:00 local the UTC day and the local day agree in every
 * zone this side of the date line, so an assertion made there passes against
 * `toISOString().slice(0, 10)` just as happily as against the local reading and proves
 * nothing. At 00:30 they disagree: this instant is still 30 August in UTC, so a form that
 * computes "today" in UTC opens a night dive on *yesterday's* date — silently, with no
 * error anywhere, on the one field DESIGN.md §2.2 requires.
 *
 * The zone is forced by `jest/timeZoneEnvironment.js` rather than inherited, because
 * assigning `process.env.TZ` inside a test file does nothing at all (Jest sandboxes
 * `process`) and CI machines run in UTC, where the bug is invisible by construction.
 */
describe('the new-dive date default, forced into Pacific/Kiritimati (UTC+14)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubNoDives();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is really running in that zone, so the assertions below mean what they say', () => {
    expect(-NIGHT_DIVE_LOCAL.getTimezoneOffset()).toBe(14 * 60);
    // The trap itself, stated as a fact about the platform rather than about our code: this
    // local instant genuinely is the previous day in UTC.
    expect(NIGHT_DIVE_LOCAL.toISOString().slice(0, 10)).toBe('2026-08-30');
  });

  it('opens a night dive on the day the diver is living in, not the UTC day', async () => {
    jest.useFakeTimers({ now: NIGHT_DIVE_LOCAL, doNotFake: [...CLOCK_ONLY] });
    const t = await render(<DiveFormScreen mode="create" />);
    // `formatDiveDate`'s spelling of 2026-08-31; 30 Aug 2026 is what the UTC reading shows.
    expect(shownDate(t)).toBe('31 Aug 2026');
  });
});

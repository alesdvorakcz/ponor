import * as Location from 'expo-location';

import {
  COARSEST_USABLE_FIX_M,
  currentPosition,
  POSITION_ACCURACY,
  POSITION_REFUSALS,
  POSITION_TIMEOUT_MS,
} from './location';
import { locationPermission, requestLocationPermission } from './locationPermission';

/**
 * The one call this module makes to the device itself. Everything else expo-location exports —
 * `Accuracy` above all, which is what `POSITION_ACCURACY` is asserted against below — stays
 * the library's own, on `locationPermission.test.ts`'s reasoning: the device is faked, the
 * vocabulary is not.
 */
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getCurrentPositionAsync: jest.fn(),
}));

/**
 * **The permission owner is mocked, not re-driven through expo-location** — the same split
 * every screen test in this codebase makes with `db/dives`. What is being checked here is the
 * mapping from a permission state to what a diver waiting for a pin is told, and driving that
 * through a second module's internals would test both and pin neither: a change to how a
 * denial is *detected* would fail here as loudly as a change to what it *means*.
 */
jest.mock('./locationPermission', () => ({
  locationPermission: jest.fn(),
  requestLocationPermission: jest.fn(),
}));

const mockFix = Location.getCurrentPositionAsync as jest.Mock;
const mockStanding = locationPermission as jest.Mock;
const mockRequest = requestLocationPermission as jest.Mock;

/** A position object shaped like the library's own — every field of `LocationObjectCoords`,
 * because the module destructures three of them and a fixture holding only those three would
 * agree with the code rather than with the device. */
function fixAt(latitude: number, longitude: number, accuracy: number | null = 8) {
  return {
    coords: { latitude, longitude, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: 1_756_000_000_000,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStanding.mockResolvedValue('granted');
  mockRequest.mockResolvedValue('granted');
  mockFix.mockResolvedValue(fixAt(28.51234, 34.51234));
});

// Only the two timeout tests fake anything, and a faked clock leaking into the next test in
// the file is the order-dependent green this codebase's own stubbing notes warn about.
// `useRealTimers()` is a no-op when nothing was faked.
afterEach(() => {
  jest.useRealTimers();
});

describe('a fix a diver can pin a dive with', () => {
  it('hands back the pair the device reported', async () => {
    expect(await currentPosition()).toEqual({ found: true, latitude: 28.51234, longitude: 34.51234 });
  });

  it('asks for ten-metre accuracy — the owner’s call, and one level of the library’s own scale', async () => {
    // A single deliberate fix rather than a tracking session, so `Balanced`'s hundred metres
    // is too coarse for an entry point somebody wants to find again and `BestForNavigation`
    // spins up sensors that buy nothing on one shot. Asserted against the library's own enum
    // rather than the number 4, so this states the decision instead of the encoding.
    await currentPosition();
    expect(mockFix).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High });
    expect(POSITION_ACCURACY).toBe(Location.Accuracy.High);
  });

  it('never asks for the permission it already has', async () => {
    // The read/request split, from the fix's side: a granted device is not sent through the
    // asking path at all, which is what keeps a routine tap from touching the one API that can
    // raise a system sheet.
    await currentPosition();
    expect(mockStanding).toHaveBeenCalledTimes(1);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('asks when the standing answer is not a grant, and takes the fix when the diver allows it', async () => {
    mockStanding.mockResolvedValue('undetermined');
    mockRequest.mockResolvedValue('granted');
    expect(await currentPosition()).toEqual({ found: true, latitude: 28.51234, longitude: 34.51234 });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe('what a permission that is not a grant means to a diver waiting for a pin', () => {
  it.each([
    ['servicesOff', 'servicesOff'],
    ['denied', 'denied'],
    // The sheet was dismissed without an answer. The permission genuinely is not granted, so
    // the `denied` sentence — which names where the switch is and invites another tap — is
    // true of it, and a sixth refusal would say the same thing in more words.
    ['undetermined', 'denied'],
    // A query that failed is not a diver who refused: sending them to change a setting they
    // may already have set would be the one unhelpful thing this mapping could do.
    ['unknown', 'failed'],
  ])('reports %s as %s', async (permission, reason) => {
    mockStanding.mockResolvedValue(permission);
    mockRequest.mockResolvedValue(permission);
    expect(await currentPosition()).toEqual({ found: false, reason });
    // ...and no fix was ever requested, which is the half that matters on a device where
    // asking anyway would throw or, worse, quietly return a cached position.
    expect(mockFix).not.toHaveBeenCalled();
  });
});

describe('a fix too rough to be a dive site', () => {
  it('refuses one worse than the threshold rather than printing it to five decimals', async () => {
    // §0.4's rule pointed at a different number. `formatCoordinates` renders five decimals —
    // about a metre — and §6 gives a dive no accuracy column to qualify that with, so a
    // half-kilometre fix stored here becomes a permanent one-metre claim. §5 settles it: a
    // dive's own point OUTRANKS the community site's pin on the personal map, so a rough one
    // does not add detail, it displaces something better.
    mockFix.mockResolvedValue(fixAt(28.5, 34.5, COARSEST_USABLE_FIX_M + 1));
    expect(await currentPosition()).toEqual({ found: false, reason: 'imprecise' });
  });

  it('takes one exactly at the threshold, which is the boundary the constant names', async () => {
    // The other side of the same line, so `>` cannot quietly become `>=` (or the reverse)
    // without a failure. A test that only checked a wildly bad fix would pass either way.
    mockFix.mockResolvedValue(fixAt(28.5, 34.5, COARSEST_USABLE_FIX_M));
    expect(await currentPosition()).toEqual({ found: true, latitude: 28.5, longitude: 34.5 });
  });

  it('takes a fix that reports no accuracy at all', async () => {
    // `accuracy` is documented nullable on web. Refusing for want of the number that says how
    // good a fix is would turn a missing measurement into a missing feature.
    mockFix.mockResolvedValue(fixAt(28.5, 34.5, null));
    expect(await currentPosition()).toEqual({ found: true, latitude: 28.5, longitude: 34.5 });
  });

  it('takes a fix whose accuracy is not a number this build can compare', async () => {
    // A `NaN` from a platform that reports "unknown" as one. `NaN > 100` is false, so the
    // threshold would let it through anyway — this pins that the guard reads it deliberately
    // rather than by accident of how `NaN` compares.
    mockFix.mockResolvedValue(fixAt(28.5, 34.5, Number.NaN));
    expect(await currentPosition()).toEqual({ found: true, latitude: 28.5, longitude: 34.5 });
  });
});

describe('a device that does not answer', () => {
  /**
   * What a promise that never settles is allowed to look like to an assertion.
   *
   * **A test that simply awaited it would hang rather than fail**, and Jest's own timeout is
   * faked along with everything else the moment `useFakeTimers` is on — so deleting the race
   * inside `withTimeout` would produce a suite that never ends instead of a red line. That is
   * a failure nobody can read: this hands the assertion a real-clock escape so the mutation
   * reports what it broke.
   */
  const STILL_WAITING = 'still waiting';

  function orStillWaiting(work: Promise<unknown>): Promise<unknown> {
    // Real timers, deliberately: this is the one thing in the test that must not be advanced
    // by the fake clock the subject is being driven with.
    jest.useRealTimers();
    return Promise.race([work, new Promise((resolve) => setTimeout(() => resolve(STILL_WAITING), 50))]);
  }

  it('gives up after the timeout rather than leaving the row locating for the rest of the dive', async () => {
    // `getCurrentPositionAsync` takes no timeout of its own and resolves only once the
    // platform has a fix good enough for the accuracy asked for — which, on a cold receiver
    // below deck, can be never. Driven with a promise that genuinely never settles, so the
    // race is what has to answer.
    jest.useFakeTimers();
    mockFix.mockReturnValue(new Promise(() => {}));
    const asked = currentPosition();
    await jest.advanceTimersByTimeAsync(POSITION_TIMEOUT_MS);
    await expect(orStillWaiting(asked)).resolves.toEqual({ found: false, reason: 'timedOut' });
  });

  it('is still waiting a moment before the timeout, so the ceiling is the one it declares', async () => {
    // The control for the test above: without it, `POSITION_TIMEOUT_MS` could be one
    // millisecond and every assertion in this file would still pass.
    jest.useFakeTimers();
    let settled = false;
    mockFix.mockReturnValue(new Promise(() => {}));
    const asked = currentPosition().then((outcome) => {
      settled = true;
      return outcome;
    });
    await jest.advanceTimersByTimeAsync(POSITION_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(orStillWaiting(asked)).resolves.toEqual({ found: false, reason: 'timedOut' });
  });

  it('reports a receiver that gave up as a failure rather than throwing into the form', async () => {
    // §1: this is called from a row on the dive form, and an exception escaping into a save
    // flow is how "never block a save" gets broken by accident.
    mockFix.mockRejectedValue(new Error('location unavailable'));
    await expect(currentPosition()).resolves.toEqual({ found: false, reason: 'failed' });
  });

  it.each([
    ['a latitude that is not a number', Number.NaN, 34.5],
    ['a longitude that is not a number', 28.5, Number.POSITIVE_INFINITY],
  ])('refuses %s rather than writing it to a dive', async (_case, latitude, longitude) => {
    // It should be unreachable — the native side types both as `number` — but this value is
    // about to be written to a dive and read back as a place, and catching it at the far end
    // would leave a `NaN` in the column with nothing on screen to say so.
    mockFix.mockResolvedValue(fixAt(latitude, longitude));
    expect(await currentPosition()).toEqual({ found: false, reason: 'failed' });
  });
});

it('refuses only in the words it declares, and reaches every one of them', async () => {
  // The completeness half, and the reason `POSITION_REFUSALS` is a list rather than a bare
  // union: the screen keys a sentence off each of these, so a reason invented inside this
  // module would reach a `Record` that has no entry for it — a control that did nothing and
  // said nothing, which is the exact failure the sentences exist to prevent.
  const paths: (() => void)[] = [
    () => mockStanding.mockResolvedValue('servicesOff'),
    () => mockStanding.mockResolvedValue('denied'),
    () => mockStanding.mockResolvedValue('unknown'),
    () => mockFix.mockResolvedValue(fixAt(28.5, 34.5, COARSEST_USABLE_FIX_M + 1)),
    () => mockFix.mockRejectedValue(new Error('location unavailable')),
  ];
  const refused = new Set<string>();
  for (const arrange of paths) {
    jest.clearAllMocks();
    mockStanding.mockResolvedValue('granted');
    mockRequest.mockImplementation((): Promise<string> => mockStanding());
    mockFix.mockResolvedValue(fixAt(28.5, 34.5));
    arrange();
    const outcome = await currentPosition();
    if (!outcome.found) refused.add(outcome.reason);
  }
  // The timeout is the one path a fake-timer-free sweep cannot drive, so it is added from its
  // own tests above rather than left out of the completeness claim.
  refused.add('timedOut');
  expect([...refused].sort()).toEqual([...POSITION_REFUSALS].sort());
});

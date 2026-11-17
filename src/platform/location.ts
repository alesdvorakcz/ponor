import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { locationPermission, requestLocationPermission, type LocationPermissionState } from './locationPermission';
import { withTimeout } from './withTimeout';

/**
 * **Every way asking the device where it is can fail to produce a pin** — the closed
 * vocabulary, with the type derived from the list rather than written a second time (§4.1's
 * "derive, or tie at compile time", the same shape `domain/types.ts` uses for every list a
 * form offers).
 *
 * It is a list rather than one "couldn't do it", because the diver's next move is different
 * in every case and a single sentence covering all five would be the dead control this whole
 * row exists not to be:
 *
 * - `servicesOff` — Location Services are off for the device. A different switch from the
 *   one below, in a different place, and no grant can substitute for it.
 * - `denied` — the app is not allowed to locate the diver. On iOS the sheet appears once
 *   ever, so this is the case where saying nothing would leave a control that does nothing.
 * - `timedOut` — nothing came back inside `POSITION_TIMEOUT_MS`. Separate from `failed`
 *   because it is the honest description of a cold receiver under a steel deck, and "try
 *   again in open air" is a different suggestion from "try again at all".
 * - `imprecise` — a fix came back and it is not good enough to be a dive site
 *   (`COARSEST_USABLE_FIX_M`).
 * - `failed` — something threw, the permission could not be read, or the coordinates were not
 *   numbers. The catch-all, and deliberately last: nothing that has a sentence of its own may
 *   be folded into it, because a reason that covers everything says nothing.
 */
export const POSITION_REFUSALS = ['servicesOff', 'denied', 'timedOut', 'imprecise', 'failed'] as const;

export type PositionRefusal = (typeof POSITION_REFUSALS)[number];

/**
 * What the device answered: a point, or the one reason there is not one.
 *
 * A discriminated union rather than `{ latitude: number | null; longitude: number | null;
 * reason?: string }`, so a caller cannot read a coordinate off a refusal — §6 stores the pair
 * or neither, and `formatCoordinates` already refuses to draw half of one.
 */
export type PositionOutcome =
  | {
      readonly found: true;
      readonly latitude: number;
      readonly longitude: number;
      /** Metres above mean sea level — only on iOS (Android's is height above the WGS 84 ellipsoid,
       * about 45 m off on the Adriatic) and only when the phone vouches for it (`altitudeAccuracy`
       * above 0 and at most `COARSEST_USABLE_ALTITUDE_ACCURACY_M`; §6, #31). Absent otherwise —
       * and from `roughPosition`, which sorts a list and stores nothing. */
      readonly altitude?: number;
    }
  | { readonly found: false; readonly reason: PositionRefusal };

/**
 * **How good a fix this asks for, and why it is neither the best nor the cheapest available**
 * (the owner's call, M2l).
 *
 * `Accuracy.High` is "accurate to within ten meters of the desired target", in
 * expo-location's own words. This is a **single deliberate fix**, not a tracking session — a
 * few seconds of receiver, once per dive, at the moment a diver has explicitly asked for it —
 * so the battery argument that would otherwise favour `Balanced` barely applies, and
 * `Balanced`'s hundred metres is too coarse for an entry point somebody wants to find again.
 * `BestForNavigation` spins up the motion sensors for turn-by-turn and buys nothing on one
 * shot. `High` is the honest middle.
 */
export const POSITION_ACCURACY = Location.Accuracy.High;

/**
 * **How long the diver waits before the row says so.**
 *
 * `getCurrentPositionAsync` takes no timeout of its own — it resolves when the platform has a
 * fix matching the accuracy asked for, and on a cold receiver below deck that can be never.
 * Without a race the row would sit on "Locating…" for the rest of the dive, which is the same
 * dead control as a tap that does nothing, reached from the other side.
 *
 * Twenty seconds is a cold GPS fix with a poor sky view and no more: long enough that a diver
 * on a boat is not told to try again while the receiver is still working, short enough that
 * the control comes back before they have given up on it.
 */
export const POSITION_TIMEOUT_MS = 20_000;

/**
 * **How rough a fix may be and still be stored as this dive's own position**, in metres of
 * reported uncertainty.
 *
 * The question this answers is not "is the fix good" but "may the app print it". A stored pin
 * is read back through `formatCoordinates`, which renders **five decimal places — about one
 * metre** (§4.1 gives it every coordinate in the app, and it takes no accuracy figure because
 * §6 gives a dive two coordinate columns and no third one to qualify them with). So a fix
 * good to 500 m, saved, becomes a permanent one-metre claim with nowhere left to say
 * otherwise. That is §0.4's rule pointed at a different number: the app refuses to draw a
 * profile it has no samples for, because "an invented shape on a dive log reads as recorded
 * data, and it isn't."
 *
 * **What settles it is that a dive's own point is an override, not a bonus.** §5: "Divers who
 * disagree with a pin still get precision — a dive can carry its own optional GPS point, and
 * the personal map prefers it." So a rough fix does not add detail to a dive; it *outranks*
 * the community site's surveyed pin on the diver's own map. The bar for storing one is
 * therefore "better than the thing it displaces", and half a kilometre is not.
 *
 * The number is `Accuracy.Balanced`'s own boundary — "accurate to within one hundred meters",
 * one step of expo-location's own scale below the `High` this asks for — so it is the
 * library's vocabulary rather than an invented threshold, and it is the coarsest level the
 * library will still name as an accuracy for a location request that is not the network.
 *
 * **The two alternatives, and why they lose.** *Show the accuracy beside the pin* would be
 * honest for exactly as long as the form is open: there is no column to store it in, so the
 * dive detail and the Map tab would show the same bare five decimals the moment it was saved.
 * *Round the display to what the fix supports* needs `formatCoordinates` to take an accuracy
 * it cannot have on any other screen, and rounding the stored value instead trades one false
 * claim for another — a position sitting exactly on a grid point is no truer than a precise
 * one that is wrong.
 *
 * **A fix that reports no accuracy at all is kept.** `accuracy` is documented as nullable on
 * web, and refusing for want of the number that says how good a fix is would turn a missing
 * measurement into a missing feature.
 */
export const COARSEST_USABLE_FIX_M = 100;

/**
 * The widest vertical accuracy at which a fix's altitude is kept: altitude diving's first step is
 * 300 m, so a figure good to ±50 m still says which side of it a site is.
 */
export const COARSEST_USABLE_ALTITUDE_ACCURACY_M = 50;

/**
 * **The one owner of "ask the device where this dive is."**
 *
 * §2.3's *"a GPS pin can be set from the map or 'use my location' — pressed right on the
 * boat"*, as the half that needs no map. It is the only producer of a dive's
 * `latitude`/`longitude` pair in the app: M1i took the two coordinate keypads off the form
 * (§2.2, §10 — "no one will ever type it manually") and nothing has written those columns
 * since.
 *
 * **It never throws and never rejects.** Every path returns a `PositionOutcome`, because the
 * caller is a row on the dive form and §1 binds it: a diver must be able to log the dive
 * whatever the device says about where they are, and an exception escaping into a form's save
 * flow is how "never block a save" gets broken by accident.
 *
 * **It reads the permission before asking for it** (`platform/locationPermission.ts`, which
 * owns that question for this row and for §3's Settings row alike). A device that has already
 * granted it is never sent through the request path at all; every other state is asked, every
 * time, because on Android and the web the next tap really can be granted and a remembered
 * refusal is what makes a control dead.
 *
 * **A site's altitude rides along on iOS only, and only when vouched for** (#31): see the comment
 * at the return. `os` is a parameter so a test can be either platform, as `countryForAddress`'s is.
 *
 * **`getLastKnownPositionAsync` is deliberately not a fallback.** A cached position is where
 * the phone was, which on a dive boat is the harbour it left an hour ago — §2.1 makes the pin
 * fresh every dive precisely because "a carried-over pressure or pin looks like data and is
 * not", and a last-known fix is that same stale claim arriving from the device instead of
 * from the previous dive.
 */
export async function currentPosition(os: typeof Platform.OS = Platform.OS): Promise<PositionOutcome> {
  try {
    const refused = await permissionRefusal();
    if (refused) return refused;
    const fix = await withTimeout(Location.getCurrentPositionAsync({ accuracy: POSITION_ACCURACY }), POSITION_TIMEOUT_MS);
    if (fix === null) return { found: false, reason: 'timedOut' };
    const { latitude, longitude, accuracy, altitude, altitudeAccuracy } = fix.coords;
    // A pair that is not two numbers is not a point. It should be unreachable — the native
    // side types both as `number` — but this value is about to be written to a dive and read
    // back as a place, and catching it in `formatCoordinates` at the far end would leave a
    // `NaN` in the column with nothing on screen to say so.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { found: false, reason: 'failed' };
    if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > COARSEST_USABLE_FIX_M) {
      return { found: false, reason: 'imprecise' };
    }
    // The altitude rides on the same fix rather than a second call, and only when it is trustworthy
    // as a site's height above sea level. iOS's `CLLocation.altitude` is above mean sea level;
    // expo-location on Android passes height above the WGS 84 ellipsoid (about +45 m on the
    // Adriatic), so Android never offers it and the diver types it. And only with a vouched-for
    // vertical accuracy, 0 < accuracy <= 50 m: iOS reports an altitude it cannot measure (the
    // simulator's flat 0) with a negative accuracy, and a mountain lake is not at sea level because
    // a receiver shrugged. A real 0 with a real accuracy is sea level, and is kept.
    return os === 'ios' &&
      typeof altitude === 'number' &&
      Number.isFinite(altitude) &&
      typeof altitudeAccuracy === 'number' &&
      Number.isFinite(altitudeAccuracy) &&
      altitudeAccuracy > 0 &&
      altitudeAccuracy <= COARSEST_USABLE_ALTITUDE_ACCURACY_M
      ? { found: true, latitude, longitude, altitude }
      : { found: true, latitude, longitude };
  } catch {
    // `getCurrentPositionAsync` is the one call left that can reject here — the permission
    // module answers `unknown` rather than throwing — and a receiver that gives up means the
    // same thing to the diver as one that never answers with a usable number.
    return { found: false, reason: 'failed' };
  }
}

/**
 * **Read the permission, and ask for it only when it is not already held** — the one check
 * `currentPosition` and `roughPosition` share, so the two cannot drift on what a refusal is.
 * `null` means granted; anything else is the outcome to hand straight back.
 */
async function permissionRefusal(): Promise<PositionOutcome | null> {
  const standing = await locationPermission();
  const permission = standing === 'granted' ? standing : await requestLocationPermission();
  return permission === 'granted' ? null : { found: false, reason: refusalFor(permission) };
}

/**
 * How old a cached position may be for Near me to use it, ten minutes. The list it draws
 * reaches 50 km, so where the phone was a few minutes ago is as good as where it is now, and
 * taking it spares the diver a receiver warm-up.
 */
export const ROUGH_POSITION_MAX_AGE_MS = 600_000;

/**
 * How long Near me waits for a fresh fix before saying so. Half of `POSITION_TIMEOUT_MS`: a
 * balanced fix comes from network and Wi-Fi in a second or two, so ten seconds with nothing is
 * a receiver that is not going to answer, not one still warming up.
 */
export const ROUGH_POSITION_TIMEOUT_MS = 10_000;

/**
 * **A position good enough to sort a list by — the looser sibling of `currentPosition`.**
 *
 * `currentPosition` exists to store a dive's pin: it asks for `High` accuracy, waits twenty
 * seconds and refuses anything rougher than `COARSEST_USABLE_FIX_M`, because a stored pin
 * becomes a permanent one-metre claim. Near me stores nothing; it orders sites within 50 km,
 * so a fix good to a few kilometres is all it needs and refusing one as `imprecise` would
 * leave a diver on a ferry with a dead button. Hence a separate function rather than a flag
 * on that one: the two disagree on every parameter and on what a refusal is.
 *
 * **A recent last-known position is used and a fresh one is not requested** — the opposite of
 * `currentPosition`'s rule, for the opposite reason (see `ROUGH_POSITION_MAX_AGE_MS`).
 *
 * Like `currentPosition` it never throws, never resolves `imprecise`, and shares its
 * permission handling.
 */
export async function roughPosition(): Promise<PositionOutcome> {
  try {
    const refused = await permissionRefusal();
    if (refused) return refused;
    const fix =
      (await Location.getLastKnownPositionAsync({ maxAge: ROUGH_POSITION_MAX_AGE_MS })) ??
      (await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        ROUGH_POSITION_TIMEOUT_MS,
      ));
    if (fix === null) return { found: false, reason: 'timedOut' };
    const { latitude, longitude } = fix.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { found: false, reason: 'failed' };
    return { found: true, latitude, longitude };
  } catch {
    return { found: false, reason: 'failed' };
  }
}

/**
 * What a permission that is not `granted` means to a diver waiting for a pin.
 *
 * Written as an exhaustive mapping rather than an `if` chain so a sixth permission state
 * cannot arrive without a decision here — the `never` arm below fails the build rather than
 * quietly falling into `failed`.
 *
 * **`undetermined` maps to `denied`, and that is a judgement.** After a request has been made
 * it means the sheet was dismissed without an answer (a rotation on Android, a system-level
 * refusal to raise it), so the permission genuinely is not granted, and the `denied` sentence
 * — which names where the permission lives and invites another tap — is true of it. The
 * alternative, a sixth refusal for "you didn't answer", would say the same thing in more
 * words. **`unknown` does not map there**: a query that failed is not a diver who refused,
 * and telling someone to change a setting they have already set would send them somewhere
 * that cannot help.
 */
function refusalFor(permission: Exclude<LocationPermissionState, 'granted'>): PositionRefusal {
  switch (permission) {
    case 'servicesOff':
      return 'servicesOff';
    case 'denied':
    case 'undetermined':
      return 'denied';
    case 'unknown':
      return 'failed';
    default: {
      const unhandled: never = permission;
      return unhandled;
    }
  }
}

/*
 * `withTimeout` — the race that turns a fix that never comes into a `null` — lived here until
 * M2o, when `platform/geocode.ts` needed the identical thing for the identical reason: a call
 * into the device with no timeout of its own, made while a diver watches a control that has
 * gone quiet. It is `platform/withTimeout.ts` now, carrying the whole of its reasoning, and it
 * takes the wait as an argument rather than reading `POSITION_TIMEOUT_MS` itself — that
 * constant is this module's rule about a GPS receiver and says nothing about anybody else's
 * call.
 */

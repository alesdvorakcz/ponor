import * as Location from 'expo-location';

import { withTimeout } from './withTimeout';

/**
 * **What country a point is in — the one owner of that question, and of the answer's shape.**
 *
 * DESIGN.md §2.3: *"Creating a new site asks only for a name; **country is inferred**"*. This
 * is the inference, and `db/catalogue.ts`'s `createDiveSite` is its only consumer (M2o).
 *
 * ── Why the code and not the name ─────────────────────────────────────────────────────────
 *
 * `reverseGeocodeAsync` hands back both `country` — *"localized country name"*, in its own
 * documentation — and `isoCountryCode`. This takes the code, and the reason is that the column
 * is **community-shared**: a Czech phone reverse-geocoding a Croatian site returns
 * `Chorvatsko` and a British one returns `Croatia`, so the localized name would fill one
 * column with as many spellings of a country as there are device locales, and §5's
 * *"country-scoped once it isn't"* catalogue sync would have nothing to scope on. The code is
 * the same two characters on every device.
 *
 * **So the column holds ISO 3166-1 alpha-2, upper case** — a fact §6 does not state about
 * `dive_sites.country`, and which this module is therefore the one place to state. That is
 * also why anything that is not two ASCII letters is refused rather than stored: alpha-3 or a
 * display name arriving from some platform would put a second vocabulary in one column, which
 * is worse than the `null` §6 already allows there.
 *
 * ── Why `null` is a real answer and a guess is not ────────────────────────────────────────
 *
 * Reverse geocoding is a **network call** — CLGeocoder on iOS, Android's `Geocoder` service —
 * so a site created on a boat with no signal gets no country at all. That is the right
 * outcome rather than a degraded one: the row keeps the **pin**, which is the evidence, and a
 * country is a derivation anybody can redo from it later — the creator or an admin editing the
 * site's facts (§5), or one day the server, which holds the same point as PostGIS geography.
 * A guessed country cannot be told apart from a measured one by anyone who reads the row.
 *
 * **A site with no pin therefore has no country**, and that is the whole rule in one sentence:
 * country is inferred *from the point*, so where there is no point there is nothing to infer
 * from. It is stated here, once, so no caller can reach for a second source — the diver's
 * locale, the last site they logged — and invent one.
 *
 * ── The three ways it comes back empty ────────────────────────────────────────────────────
 *
 * No pin; the platform could not answer (offline, throttled, or — on the web, where
 * expo-location documents this call as iOS/Android only — not implemented at all); or it
 * answered with something that is not an alpha-2 code. All three are `null`, because the
 * diver's next move is the same in every one of them: nothing. Unlike `POSITION_REFUSALS`,
 * which a diver reads and acts on, this failure has nothing to say — the row is created either
 * way, and §1 binds hardest here, since the dive behind it is still being logged.
 *
 * **No permission handling, and that is by construction rather than by omission.** Android
 * requires the location permission before geocoding, and the only pin this app can hold came
 * from `currentPosition()`, which is granted-only. A permission revoked between the two throws
 * inside the platform call and lands in the same `null` as every other failure.
 */
export async function countryFor(latitude: number | null, longitude: number | null): Promise<string | null> {
  // No point, no inference — and no platform call either, so a site created with no pin costs
  // nothing and cannot hang on a geocoder it has no question for.
  if (latitude === null || longitude === null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  try {
    const places = await withTimeout(Location.reverseGeocodeAsync({ latitude, longitude }), GEOCODE_TIMEOUT_MS);
    // `null` is the timeout; an empty array is a geocoder that answered and knows of no place
    // there, which is most of the open ocean. Both mean the same thing to the row.
    return isoCountryCode(places?.at(0)?.isoCountryCode ?? null);
  } catch {
    return null;
  }
}

/**
 * **How long a diver waits for a country before the row is created without one.**
 *
 * Four seconds, and it is a different number from `POSITION_TIMEOUT_MS` for a different
 * reason: that one waits on a receiver acquiring satellites, which genuinely takes tens of
 * seconds in bad sky, while this is one HTTP round trip that has either happened or is not
 * going to. The diver is holding a form open mid-dive-log, the thing they asked for is the
 * *site*, and the country is a detail on it — so the wait belongs at the short end.
 */
export const GEOCODE_TIMEOUT_MS = 4_000;

/**
 * The code as a community catalogue may keep it, or `null`.
 *
 * Upper-cased rather than trusted: iOS returns `GB` and Android's `getCountryCode()` returns
 * the same, but the value passes through a JSON boundary and a lower-case `gb` sitting beside
 * `GB` in a shared column would be two countries to anything that groups on it.
 *
 * The two-letter test is what keeps one vocabulary in the column — see this module's own
 * docblock. `typeof` because this value crosses the native bridge: it is *typed* `string |
 * null` and is whatever the platform actually put there.
 */
function isoCountryCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

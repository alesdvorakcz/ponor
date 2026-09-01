import { isDisplayableDepth } from '../format/display';

import {
  depthBandLimits,
  depthScale,
  type ColorScheme,
  type DepthBandLimits,
  type DepthScale,
} from './tokens';

export type DepthBand = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Compile-time proof that every band has a colour. N limits cut the depth range
 * into N+1 bands, so the scale must be exactly one longer than the limits;
 * appending a single element to the limits tuple gives the length the scale has
 * to have. Change either array in `tokens.js` without the other and this stops
 * compiling.
 *
 * It is worth a type-level assertion rather than a comment because the failure
 * is invisible at runtime: this file used to index the scale through a cast
 * (`as DepthBand`) whose soundness rested on that unenforced pairing, and React
 * Native renders `color: undefined` as the default text colour without
 * throwing. A palette edit would therefore have broken DESIGN.md §0.1 —
 * "colour is depth, and colour is nothing else" — with no crash and no error.
 */
type Assert<T extends true> = T;
type BandCount = [...DepthBandLimits, unknown]['length'];
export type ScaleCoversEveryBand = Assert<
  DepthScale['length'] extends BandCount ? true : false
>;

/**
 * Which depth band a dive falls in. A depth exactly on a boundary belongs to
 * the shallower band, so a 6.0 m dive is band 1 and a 6.1 m dive is band 2.
 *
 * Written as an explicit ladder over the destructured limits rather than
 * `findIndex(...) as DepthBand`. Destructuring the tuple is what ties this to
 * exactly five limits — drop one in `tokens.js` and the declaration's tuple no
 * longer has an element at that index, which is a compile error here — and it
 * removes the cast, so the returned band is a value the compiler derived rather
 * than one it was told to believe.
 */
export function depthBand(metres: number): DepthBand {
  if (!Number.isFinite(metres) || metres < 0) {
    throw new RangeError(`depthBand: expected a non-negative depth in metres, got ${metres}`);
  }
  const [band1, band2, band3, band4, band5] = depthBandLimits;
  if (metres <= band1) return 1;
  if (metres <= band2) return 2;
  if (metres <= band3) return 3;
  if (metres <= band4) return 4;
  if (metres <= band5) return 5;
  return 6;
}

/** One band of the scale, as a span of metres: `toM` is `null` on the deepest
 * band alone, because that one is open-ended and "40 m +" is the honest way to
 * say so. See `depthBandRanges` below. */
export interface DepthBandRange {
  band: DepthBand;
  fromM: number;
  toM: number | null;
}

/**
 * **The whole scale as spans, for the one screen that shows the scale rather
 * than a dive** — the first-run legend (`DepthLegend.tsx`, DESIGN.md §0.6),
 * which is the only place in Ponor where a depth colour appears detached from a
 * depth.
 *
 * It is here, and derived, for the reason §4.1 exists: a legend that retyped
 * `0–6, 6–12, 12–20, 20–30, 30–40, 40+` would be a second copy of
 * `depthBandLimits`, and the first palette edit would leave a first-run screen
 * confidently teaching the wrong boundaries — colour-coded to prove it. This
 * module is the only reader of the depth scale, so the spans are computed from
 * the same tuple `depthBand` reads one function up, and moving a limit in
 * `tokens.js` moves the legend with it or breaks the build.
 *
 * Written as an explicit ladder over the destructured limits for exactly the
 * reason `depthBand` is: destructuring ties this to five limits at compile time,
 * and it needs neither an index cast nor a non-null assertion to say so. The one
 * literal is the `0` the shallowest band starts at, which is the surface and not
 * a palette value.
 *
 * **Each span's `toM` belongs to that band**, matching `depthBand`'s own
 * boundary rule ("a depth exactly on a boundary belongs to the shallower band"),
 * so a 6.0 m dive draws in the colour the legend prints `0–6` against.
 * `depth.test.ts` pins that agreement by asking `depthBand` itself rather than
 * by restating the numbers.
 */
export const depthBandRanges: readonly DepthBandRange[] = (() => {
  const [band1, band2, band3, band4, band5] = depthBandLimits;
  return [
    { band: 1, fromM: 0, toM: band1 },
    { band: 2, fromM: band1, toM: band2 },
    { band: 3, fromM: band2, toM: band3 },
    { band: 4, fromM: band3, toM: band4 },
    { band: 5, fromM: band4, toM: band5 },
    { band: 6, fromM: band5, toM: null },
  ];
})();

/**
 * **The two depths §0.1's own sentence is about**, as the scale's numbers rather than as
 * prose: "red is gone by about 5 m... blue is what is left". The shallowest band ends where
 * red has gone; the deepest begins where only blue is left.
 *
 * They exist for one caller — the sentence printed under the first-run legend
 * (`EmptyState.tsx`: "red fades out by 6 m, blue carries past 40 m — the scale follows the
 * light") — and they are exported rather than written into that sentence for the reason
 * `depthBandRanges` above exists. A caption that teaches the scale with two numbers typed into
 * it holds two more copies of `depthBandLimits`, in the one place a diver is being invited to
 * trust them; move a limit and the legend would move while the sentence explaining it stayed
 * behind, saying something the bars beneath it contradict.
 *
 * Destructured out of the same tuple for the same compile-time tie: drop a limit in
 * `tokens.js` and the tuple has no element at that position, which is an error here.
 */
const [shallowestLimit, , , , deepestLimit] = depthBandLimits;
export const shallowestBandEndM: number = shallowestLimit;
export const deepestBandStartM: number = deepestLimit;

/**
 * The colour a band is drawn in — the half of `depthColor` below that does not
 * need a depth.
 *
 * Split out for the legend, which has bands and no dives: without it that screen
 * would have to invent a depth inside each band to ask `depthColor` with, and an
 * invented depth is a boundary rule written a second time in the caller.
 *
 * The exhaustive switch is the point: every band is looked up by name out of a
 * destructured six-tuple, so there is no index expression that could be out of
 * range and no cast asserting that it isn't. Widen `DepthBand` without widening
 * the scale and the switch stops being exhaustive, which is a compile error on
 * the return type rather than a silently undefined colour.
 */
export function depthBandColor(band: DepthBand, scheme: ColorScheme): string {
  const [colour1, colour2, colour3, colour4, colour5, colour6] = depthScale[scheme];
  switch (band) {
    case 1:
      return colour1;
    case 2:
      return colour2;
    case 3:
      return colour3;
    case 4:
      return colour4;
    case 5:
      return colour5;
    case 6:
      return colour6;
  }
}

/**
 * The colour that encodes this depth in the given scheme — `depthBand` and
 * `depthBandColor` composed, and nothing else, so a dive's colour and a legend
 * swatch's colour cannot come out of two different lookups.
 */
export function depthColor(metres: number, scheme: ColorScheme): string {
  return depthBandColor(depthBand(metres), scheme);
}

/**
 * Null-safe sibling of `depthColor`. Every dive field but the date is nullable, and an
 * empty numeric form field parses to `NaN` (`parseFloat('') === NaN`) — a list row
 * rendering straight from form or database state cannot let that reach `depthColor` and
 * throw mid-render. `depthBand`'s throw-on-invalid contract is the right one for a pure
 * function and stays exactly as it is; this wraps it rather than loosening it, so a
 * render path has somewhere null-safe to call instead of relaxing the validation itself.
 *
 * Returns `null` for `null`, `undefined`, `NaN`, a negative depth, or any other
 * non-finite value; the colour `depthColor` would give otherwise.
 *
 * M1c closing fixes, Important #3: the finiteness/sign check below used to be re-derived
 * here independently of format/display.ts — two separate places deciding the same "can
 * this depth be shown?" question, which had already drifted apart once (see
 * `formatDepthParts`'s own docblock for the dangling-label bug that caused). Deferring to
 * that module here instead makes it the one owner: whatever it accepts, this colours;
 * whatever it refuses, this returns `null` for, by construction rather than by two
 * conditions that happen to currently agree.
 *
 * **It defers to `isDisplayableDepth`, not to `formatDepthParts` itself**, since the m/ft
 * setting landed. That is the same owner and the same answer — `formatDepthParts` returns
 * null exactly when this predicate is false — reached without handing this file a
 * `UnitSystem` it must never have. **The band is computed from the stored metre value and
 * from nothing else** (§0.1: the scale follows the order water removes colour, which is a
 * fact about water and not about the diver's preference), so a dive shown as `81 ft` draws
 * in the very same band as the `24.7 m` it is. A colour taken from a converted figure would
 * put every imperial dive past 40 m in band 6.
 */
export function depthColorOrNull(
  metres: number | null | undefined,
  scheme: ColorScheme,
): string | null {
  if (!isDisplayableDepth(metres)) {
    return null;
  }
  return depthColor(metres, scheme);
}

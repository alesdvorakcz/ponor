import { formatDepthParts } from '../format/display';

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

/**
 * The colour that encodes this depth in the given scheme.
 *
 * The exhaustive switch is the point: every band is looked up by name out of a
 * destructured six-tuple, so there is no index expression that could be out of
 * range and no cast asserting that it isn't. Widen `DepthBand` without widening
 * the scale and the switch stops being exhaustive, which is a compile error on
 * the return type rather than a silently undefined colour.
 */
export function depthColor(metres: number, scheme: ColorScheme): string {
  const [colour1, colour2, colour3, colour4, colour5, colour6] = depthScale[scheme];
  switch (depthBand(metres)) {
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
 * here independently of `formatDepthParts` (format/display.ts) — two separate places
 * deciding the same "can this depth be shown?" question, which had already drifted apart
 * once (see that function's own docblock for the dangling-label bug that caused). Deferring
 * to it here instead makes `formatDepthParts` the one owner: whatever it accepts, this
 * colours; whatever it refuses, this returns `null` for, by construction rather than by
 * two conditions that happen to currently agree.
 */
export function depthColorOrNull(
  metres: number | null | undefined,
  scheme: ColorScheme,
): string | null {
  if (metres == null || formatDepthParts(metres) === null) {
    return null;
  }
  return depthColor(metres, scheme);
}

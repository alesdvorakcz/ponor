import { depthBandLimits, depthScale, type ColorScheme } from './tokens';

export type DepthBand = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Which depth band a dive falls in. A depth exactly on a boundary belongs to
 * the shallower band, so a 6.0 m dive is band 1 and a 6.1 m dive is band 2.
 */
export function depthBand(metres: number): DepthBand {
  if (!Number.isFinite(metres) || metres < 0) {
    throw new RangeError(`depthBand: expected a non-negative depth in metres, got ${metres}`);
  }
  const index = depthBandLimits.findIndex((limit) => metres <= limit);
  return (index === -1 ? 6 : index + 1) as DepthBand;
}

/** The colour that encodes this depth in the given scheme. */
export function depthColor(metres: number, scheme: ColorScheme): string {
  return depthScale[scheme][depthBand(metres) - 1];
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
 */
export function depthColorOrNull(
  metres: number | null | undefined,
  scheme: ColorScheme,
): string | null {
  if (metres == null || !Number.isFinite(metres) || metres < 0) {
    return null;
  }
  return depthColor(metres, scheme);
}

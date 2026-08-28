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

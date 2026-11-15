import type { MapPoint } from './mapSites';

/** Mean Earth radius in km (IUGG), the radius the haversine below is taken on. */
const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * **Great-circle distance between two points, in kilometres** (haversine).
 *
 * A sphere rather than an ellipsoid: it is within about 0.5% of the true figure, which is far
 * finer than a "7.6 km away" label next to a dive site needs, and it is stable for the short
 * distances a list is sorted by, where the spherical law of cosines loses precision.
 */
export function distanceKm(a: MapPoint, b: MapPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

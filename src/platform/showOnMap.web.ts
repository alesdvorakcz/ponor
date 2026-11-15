import { type MapFocus } from '../domain/mapFocus';
import { type MapPoint } from '../domain/mapSites';
import { openInMaps } from './mapsLink';
import type { showOnMap as NativeShowOnMap } from './showOnMap';

/**
 * The browser's *Show on map*: OpenStreetMap, as before issue #21. Metro picks this file over
 * `showOnMap.ts` for `--platform web`, and Jest's platforms are iOS-only, so nothing here reaches a
 * device build or a test run.
 *
 * The browser draws no map (`DiveMap.web.tsx` is a sentence, §9: a testing target, not a supported
 * platform), so a focused map there would be a sentence pointed at a place. The issue allows
 * exactly this: *"there it may keep opening OpenStreetMap."*
 */
export function showOnMap(_focus: MapFocus, point: MapPoint, label: string): void {
  openInMaps(point, label);
}

type Assert<T extends true> = T;

/**
 * Type-level proof that the browser's version still takes what the device's takes — the device
 * `confirmDestructive.web.ts` carries, with the same blind spot: a parameter *added* to both
 * reads the same types and is not caught.
 */
export type WebShowOnMapMatchesNative = Assert<typeof showOnMap extends typeof NativeShowOnMap ? true : false>;

import { router } from 'expo-router';

import { type MapFocus } from '../domain/mapFocus';
import { type MapPoint } from '../domain/mapSites';
import { mapFocusHref } from '../navigation/mapFocusLink';

/**
 * **Where *Show on map* goes** (issue #21): Ponor's own map, pointed at the place.
 *
 * A platform module because the answer differs by platform and §4.1 keeps that branch out of the
 * screens. On a device the map is pushed over the page (`navigation/mapFocusLink.ts` says why it
 * is pushed rather than the Map tab switched to); in the browser `showOnMap.web.ts` keeps opening
 * OpenStreetMap, because the browser's map is a sentence (`DiveMap.web.tsx`) and pointing a
 * sentence at a place shows nothing.
 *
 * `point` and `label` are the browser's, unread here — a caller imports one name and must not be
 * able to tell which file it got, so both take the same arguments.
 */
export function showOnMap(focus: MapFocus, _point: MapPoint, _label: string): void {
  router.push(mapFocusHref(focus));
}

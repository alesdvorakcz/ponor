import { Linking, Platform } from 'react-native';

import { type MapPoint } from '../domain/mapSites';

/**
 * **Handing a position to the device's maps app** — for directions to a place, and for the one
 * place Ponor's own map cannot show.
 *
 * Issue #3's *Show on map* card opened this for every dive, because Ponor's Map tab could not yet
 * be pointed at a place. Issue #21 taught it (`platform/showOnMap.ts`), and this module kept three
 * callers: a focused map's *Directions* pill, which is what the card used to give a diver for free;
 * a **planned** dive's card, since §2.4 keeps a plan off Ponor's map; and the browser, whose map is
 * a sentence (`showOnMap.web.ts`). DESIGN.md §10 has the reasoning for each.
 *
 * **One URL per platform, built here and nowhere else** (§4.1). iOS takes Apple's universal link,
 * which opens Maps rather than Safari; Android takes the `geo:` scheme its maps apps register,
 * with the point repeated as the query because that is what draws a labelled pin rather than
 * only centring the map; the web takes OpenStreetMap, which needs no key and no account.
 *
 * The name goes through `encodeURIComponent`: it is the diver's own text, Czech gives it
 * characters a URL cannot carry raw, and an `&` in it would otherwise end the query early.
 */
export function mapsUrl(point: MapPoint, label: string, os: typeof Platform.OS): string {
  const { latitude, longitude } = point;
  const name = encodeURIComponent(label);
  if (os === 'android') return `geo:${latitude},${longitude}?q=${latitude},${longitude}(${name})`;
  if (os === 'web') {
    return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`;
  }
  return `https://maps.apple.com/?ll=${latitude},${longitude}&q=${name}`;
}

/**
 * Opens `point` in the device's maps. A refusal — no maps app at all, which a stripped-down
 * Android can have — leaves the diver on the dive they were reading; there is nothing on this
 * screen a failure could put right, so it is swallowed rather than surfaced as an error about an
 * app Ponor does not own.
 */
export function openInMaps(point: MapPoint, label: string): void {
  void Linking.openURL(mapsUrl(point, label, Platform.OS)).catch(() => undefined);
}

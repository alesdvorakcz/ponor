import { Linking, Platform } from 'react-native';

import { type MapPoint } from '../domain/mapSites';

/**
 * **Where the dive detail's "Show on map" card sends a position** (issue #3, the owner's design
 * canvas), and why it leaves the app.
 *
 * The canvas draws the card and not its destination. Ponor's own Map tab cannot be pointed at a
 * place yet — it frames every mark it draws and has no way to be asked for one — so teaching it
 * would be a change to that screen of its own, recorded in DESIGN.md §10 rather than slipped in
 * behind a card. The device's maps app already does exactly what the words promise, offers
 * directions to the site on top, and is the same move iOS's own apps make with an address.
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

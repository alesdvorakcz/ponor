import { useLocalSearchParams } from 'expo-router';

import { mapFocusFromParams } from '../../../navigation/mapFocusLink';
import MapScreen from '../../../screens/MapScreen';

/**
 * `/site/[id]/map` — the map pointed at one site, pushed over its page (issue #21). The
 * route's only job is to name what the map is pointed at; `navigation/mapFocusLink.ts` builds the
 * link here and says why it is a pushed screen rather than the Map tab.
 *
 * **Nothing under `src/app/` carries a test**, by this repo's convention: expo-router sweeps this
 * tree into the bundle, so a colocated test would ship with the app.
 */
export default function SiteOnMapRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  return <MapScreen focus={mapFocusFromParams('site', params)} />;
}

import { useLocalSearchParams } from 'expo-router';

import { mapFocusFromParams, type MapFocusParams } from '../../../navigation/mapFocusLink';
import MapScreen from '../../../screens/MapScreen';

/**
 * `/dive/[id]/map` — the map pointed at one dive, pushed over its page (issue #21). The
 * route's only job is to name what the map is pointed at; `navigation/mapFocusLink.ts` builds the
 * link here and says why it is a pushed screen rather than the Map tab.
 *
 * **Nothing under `src/app/` carries a test**, by this repo's convention: expo-router sweeps this
 * tree into the bundle, so a colocated test would ship with the app.
 */
export default function DiveOnMapRoute() {
  const params = useLocalSearchParams<MapFocusParams>();
  return <MapScreen focus={mapFocusFromParams('dive', params)} />;
}

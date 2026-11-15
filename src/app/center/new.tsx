import NewPlaceScreen from '../../screens/NewPlaceScreen';

/**
 * `/center/new` — *New dive centre*, the `/site/new` route's twin for the centre picker's *Create
 * “…”* row (issue #19). `center`, as `/center/[id]` is: §6's column is `center_id`.
 *
 * **Nothing under `src/app/` carries a test** — expo-router sweeps this tree into the bundle.
 */
export default function NewCenterRoute() {
  return <NewPlaceScreen kind="center" />;
}

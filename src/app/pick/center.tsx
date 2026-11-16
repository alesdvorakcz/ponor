import PlacePickerScreen from '../../screens/PlacePickerScreen';

/**
 * `/pick/center` — *Choose a centre*, the `/pick/site` route's twin for the dive form's *Centre*
 * row (issue #19). `center`, as `/center/[id]` is: §6's column is `center_id`.
 *
 * **Nothing under `src/app/` carries a test** — expo-router sweeps this tree into the bundle.
 */
export default function PickCenterRoute() {
  return <PlacePickerScreen kind="center" />;
}

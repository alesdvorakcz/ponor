import PlacePickerScreen from '../../screens/PlacePickerScreen';

/**
 * `/pick/site` — *Choose a site*, pushed over the dive form by its *Site* row
 * (`navigation/placePick.ts`'s `openPlacePicker`, issue #19).
 *
 * A wrapper rather than a bare re-export, for `dive/new.tsx`'s reason: the screen needs a `kind`
 * prop expo-router has no way to hand a route component. The form's request travels as the
 * `token` param, which the screen reads itself, as every `[id]` screen reads its own id.
 *
 * **Nothing under `src/app/` carries a test** — expo-router sweeps this tree into the bundle.
 */
export default function PickSiteRoute() {
  return <PlacePickerScreen kind="site" />;
}

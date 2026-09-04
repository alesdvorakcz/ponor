import { useLocalSearchParams } from 'expo-router';

import CertificationScreen from '../../screens/CertificationScreen';

/**
 * `/certification/[id]` — editing one card of §3's wallet, opened from its row on Settings.
 *
 * A sibling of `preset/[id]`, outside the `(tabs)` group: the editor is a screen stacked on
 * Settings rather than a tab of its own, exactly as a dive's detail is stacked on the list.
 *
 * A wrapper rather than a bare re-export, for the reason `preset/[id].tsx` is one:
 * `CertificationScreen` needs props expo-router has no way to hand a route component.
 * `mode="edit"` is fixed here, and `useLocalSearchParams` can hand back `string[]` for a
 * repeated param, so the first is taken rather than the array being passed on as if it were a
 * string — the same read every other `[id]` route in this tree makes.
 *
 * **Nothing under `src/app/` carries a test**, by this repo's own convention: expo-router
 * sweeps this tree into the bundle, so a colocated test would ship with the app.
 */
export default function CertificationRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <CertificationScreen mode="edit" certificationId={id} />;
}

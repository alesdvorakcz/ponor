import { useLocalSearchParams } from 'expo-router';

import DiveFormScreen from '../../../screens/DiveFormScreen';
import { openAsStatus } from '../../../navigation/editDiveLink';

/**
 * `/dive/[id]/edit` — editing one dive, and (§2.4) completing a planned one, which is the
 * same screen with its Logged/Planned control opened on a different state.
 *
 * A wrapper rather than `[id].tsx`'s bare `export { default } from ...`, for the same
 * reason `new.tsx` is one: `DiveFormScreen` needs props expo-router has no way to hand a
 * route component. `mode="edit"` is fixed here, and `diveId` is read from the route the way
 * `DiveDetailScreen` reads its own — `useLocalSearchParams` can hand back `string[]` for a
 * repeated param, so the first is taken rather than the array being passed on as if it were
 * a string.
 *
 * `initialStatus` is the *Complete dive* pill arriving: `openAsStatus`
 * (navigation/editDiveLink.ts) owns both the param's name and what counts as a valid
 * value, so this file stays the thin route it is and the knowledge lives somewhere a test
 * can reach it — nothing under `src/app/` carries tests, by this repo's own convention.
 * It says which state the form's control OPENS on and nothing more; the dive's status
 * still changes only when the diver saves.
 *
 * Sitting beside `dive/[id].tsx` rather than replacing it with `dive/[id]/index.tsx`: a
 * file and a directory of the same name are both valid route nodes, `/dive/<id>` keeps
 * resolving to the detail screen exactly as before, and moving that file would have
 * rewritten a route this milestone has no reason to touch.
 */
export default function EditDiveRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <DiveFormScreen mode="edit" diveId={id} initialStatus={openAsStatus(params)} />;
}

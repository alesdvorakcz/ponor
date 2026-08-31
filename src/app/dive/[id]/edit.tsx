import { useLocalSearchParams } from 'expo-router';

import DiveFormScreen from '../../../screens/DiveFormScreen';

/**
 * `/dive/[id]/edit` — editing one dive, and (§2.4) completing a planned one, which is the
 * same screen deciding what to do from the dive's own `status`.
 *
 * A wrapper rather than `[id].tsx`'s bare `export { default } from ...`, for the same
 * reason `new.tsx` is one: `DiveFormScreen` needs props expo-router has no way to hand a
 * route component. `mode="edit"` is fixed here, and `diveId` is read from the route the way
 * `DiveDetailScreen` reads its own — `useLocalSearchParams` can hand back `string[]` for a
 * repeated param, so the first is taken rather than the array being passed on as if it were
 * a string.
 *
 * Sitting beside `dive/[id].tsx` rather than replacing it with `dive/[id]/index.tsx`: a
 * file and a directory of the same name are both valid route nodes, `/dive/<id>` keeps
 * resolving to the detail screen exactly as before, and moving that file would have
 * rewritten a route this milestone has no reason to touch.
 */
export default function EditDiveRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <DiveFormScreen mode="edit" diveId={id} />;
}

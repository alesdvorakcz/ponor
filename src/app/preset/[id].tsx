import { useLocalSearchParams } from 'expo-router';

import GearPresetScreen from '../../screens/GearPresetScreen';

/**
 * `/preset/[id]` — §3's cylinder-preset editor, opened from the preset list on Settings.
 *
 * A sibling of `dive/[id]`, outside the `(tabs)` group: the editor is a screen stacked on
 * Settings rather than a tab of its own, exactly as a dive's detail is stacked on the list.
 *
 * A wrapper rather than `dive/[id].tsx`'s bare `export { default } from ...`, for the reason
 * `dive/[id]/edit.tsx` is one: `GearPresetScreen` needs a prop expo-router has no way to hand
 * a route component. `useLocalSearchParams` can hand back `string[]` for a repeated param, so
 * the first is taken rather than the array being passed on as if it were a string — the same
 * read that route already makes.
 *
 * **Nothing under `src/app/` carries a test**, by this repo's own convention: expo-router
 * sweeps this tree into the bundle, so a colocated test would ship with the app. Everything
 * this file could get wrong beyond the param read lives one directory over in
 * `screens/GearPresetScreen.tsx`, which does.
 *
 * There is deliberately no `preset/new.tsx` beside this. §10 puts creation in the dive form
 * ("saving one takes whatever cylinders are already typed into the dive you are logging,
 * because retyping them in Settings is the work the preset exists to remove"). If it is ever
 * wanted, adding it is additive and moves nothing: a `new.tsx` here and a `mode` prop on the
 * screen, which is exactly the relationship `dive/new.tsx` already has with `dive/[id]/edit.tsx`.
 */
export default function GearPresetRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <GearPresetScreen presetId={id} />;
}

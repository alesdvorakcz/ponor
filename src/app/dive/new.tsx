import DiveFormScreen from '../../screens/DiveFormScreen';

// Thin route, matching `[id].tsx`'s own re-export — except `DiveFormScreen` needs a
// `mode` prop expo-router has no way to hand a route component, so a bare
// `export { default } from ...` (which passes none) cannot supply it. This is the
// smallest wrapper that can: `mode="create"` is the one thing this file exists to fix.
export default function NewDiveRoute() {
  return <DiveFormScreen mode="create" />;
}

import CertificationScreen from '../../screens/CertificationScreen';

/**
 * `/certification/new` — adding a card to §3's wallet, opened from the *Add certification* row
 * on Settings.
 *
 * A wrapper rather than a bare `export { default } from ...`, for the reason `dive/new.tsx` is
 * one: `CertificationScreen` needs a `mode` prop expo-router has no way to hand a route
 * component. `mode="create"` is the one thing this file exists to fix.
 *
 * **It exists at all because a certification has nowhere else to come from**, unlike a preset:
 * §10 puts preset creation in the dive form, "where the cylinders are already typed", and
 * `preset/[id].tsx` records that there is deliberately no `preset/new.tsx` beside it. There is
 * no dive a card is captured from, so the wallet has to be addable from the list.
 *
 * **Nothing under `src/app/` carries a test**, by this repo's own convention: expo-router
 * sweeps this tree into the bundle, so a colocated test would ship with the app. Everything
 * this file could get wrong lives one directory over in `screens/CertificationScreen.tsx`,
 * which does.
 */
export default function NewCertificationRoute() {
  return <CertificationScreen mode="create" />;
}

import NewPlaceScreen from '../../screens/NewPlaceScreen';

/**
 * `/site/new` — *New dive site*, pushed by the site picker's *Create “…”* row with the form's
 * `token` and the typed `name` (issue #19). A static segment beside `[id].tsx`, which expo-router
 * matches first, so `/site/new` is never read as a site whose id is `new`.
 *
 * A wrapper rather than a bare re-export, for `pick/site.tsx`'s reason: the screen needs a `kind`
 * prop expo-router has no way to hand a route component. The params it reads itself.
 *
 * **Nothing under `src/app/` carries a test** — expo-router sweeps this tree into the bundle.
 */
export default function NewSiteRoute() {
  return <NewPlaceScreen kind="site" />;
}

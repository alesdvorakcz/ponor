export { default } from '../../screens/DiveSiteScreen';

/**
 * `/site/[id]` — one dive site's page (§5's community model, §6's `dive_sites`), reached from a
 * dive's own *Site* row, from the sites directory, and from a mark on the Map tab's community
 * layer.
 *
 * A bare re-export rather than a wrapper, exactly as `center/[id]` is: this screen needs no prop
 * expo-router cannot hand a route component — it reads the `id` param itself, in the same
 * `Array.isArray` shape every other `[id]` route in this tree reads it, because
 * `useLocalSearchParams` can hand back `string[]` for a repeated param.
 *
 * `site`, singular, beside `/center/[id]`: §6's column is `site_id` and the table is `dive_sites`.
 *
 * **Nothing under `src/app/` carries a test**, by this repo's convention: expo-router sweeps this
 * tree into the bundle, so a colocated test would ship with the app.
 */

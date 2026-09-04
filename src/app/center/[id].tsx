export { default } from '../../screens/DiveCenterScreen';

/**
 * `/center/[id]` — one dive centre's page (§5's community model, §6's `dive_centers`), reached
 * from a dive's own *Centre* row, from the centres directory, and from a mark on the Map tab's
 * centre layer.
 *
 * A bare re-export rather than a wrapper, unlike `certification/[id]` and `preset/[id]`: this
 * screen needs no prop expo-router cannot hand a route component — it reads the `id` param
 * itself, in the same `Array.isArray` shape every other `[id]` route in this tree reads it,
 * because `useLocalSearchParams` can hand back `string[]` for a repeated param.
 *
 * `center`, not `centre`, for the reason every identifier in this app spells it that way: §6's
 * column is `center_id` and the table is `dive_centers`. British spelling is what a diver reads;
 * American is what the schema says.
 *
 * **Nothing under `src/app/` carries a test**, by this repo's convention: expo-router sweeps this
 * tree into the bundle, so a colocated test would ship with the app.
 */

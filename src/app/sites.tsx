export { default } from '../screens/DiveSitesScreen';

/**
 * `/sites` — §2.3's sites directory, browsed and searched, pushed over the tab bar exactly as
 * `/centers` and `/search` are and for the same reason: its field rides the keyboard, and on a tab
 * screen there is a native tab bar between the two.
 *
 * A sibling of `centers.tsx` and `search.tsx` outside the `(tabs)` group. Reached from the Map
 * tab while community sites are switched on, which draws the sites that have a position and is
 * where a diver finds out that not all of them do.
 *
 * **Nothing under `src/app/` carries a test** — expo-router sweeps this tree into the bundle.
 */

export { default } from '../screens/DiveCentersScreen';

/**
 * `/centers` — §2.3's centres directory, browsed and searched, pushed over the tab bar exactly
 * as `/search` is and for the same reason: its field rides the keyboard, and on a tab screen
 * there is a native tab bar between the two.
 *
 * A sibling of `search.tsx` outside the `(tabs)` group. Reached from the Map tab's centre layer,
 * which draws the centres that have a position and is where a diver finds out that most do not.
 *
 * **Nothing under `src/app/` carries a test** — expo-router sweeps this tree into the bundle.
 */

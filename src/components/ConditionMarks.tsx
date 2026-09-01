import { SymbolView } from 'expo-symbols';
import { View, type ColorValue } from 'react-native';

import { CONDITION_SCALE_VALUES, type ConditionLevel } from '../domain/types';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { symbolName, type PlatformSymbol } from './symbolName';

/**
 * The two 0–3 scales whose marks are **repetition** — one arrow for a light current, two for
 * medium, three for strong — and the file where the argument for that mechanism lives.
 *
 * DESIGN.md §0.6, as M1h amended it: the icon sheet passes the legend test "rather than
 * waiving it, and the reason is worth stating because it is what any future icon must do: the
 * marks *encode the scale in themselves* — waves grow in amplitude, current arrows accumulate
 * one way, surge two ways, visibility bars count up. Nothing has to be memorised, so nothing
 * is a legend."
 *
 * Repetition is the one mechanism that delivers that with **no drawing dependency at all**:
 * `react-native-svg` is not installed and is not to be added (that is a native rebuild and
 * the owner's call), so a mark is either a real platform symbol or a `View`. Counting a
 * symbol out N times is neither an approximation of a drawn mark nor a compromise — "more of
 * it" is literally what more current is.
 *
 * ---
 *
 * **Why there is no `WavesIcon` in this file, and why adding one would be wrong.**
 *
 * The same sheet draws waves as a sine growing in amplitude, and Waves ships in M1h as a chip
 * row with **no mark at all** — which §0.6 permits outright ("an icon appears only where the
 * value has one") and which was a decision, not an omission. Three routes were tried:
 *
 * 1. **Repetition, the mechanism in this very file, encodes the wrong quantity.** Three wave
 *    glyphs say *how many waves*, which is frequency; the scale is *how big*, which is
 *    amplitude. It would also put three rows in one group — Waves, Current, Surge — each
 *    reading "three of something", so the marks would stop distinguishing the fields they
 *    are attached to and start needing the labels to tell them apart. That is a legend.
 * 2. **SF Symbols has no amplitude family.** `water.waves` exists; its variants describe
 *    water *level*, not wave height. There is no small/large pair to borrow.
 * 3. **Bars of growing height would work — and they are already the visibility mark.**
 *    Reusing one mark for two unrelated subjects two rows apart makes *both* of them a
 *    legend: a staircase would mean "how far you can see" on one row and "how big the swell
 *    is" on the next, and nothing on screen would say which.
 *
 * So the honest answer is the bare row. §0.6's test is "whether the mark carries the meaning
 * or merely labels it", and every candidate above merely labels it. **This argument is here
 * rather than only in a report because the bare row looks unfinished** — the next reader will
 * see four chip rows, three with marks, and reach for the missing one.
 */

/**
 * The most copies any mark here draws — the top of the scale itself, read off the vocabulary
 * rather than written as a `3` (§4.1).
 */
const MAX_MARKS = CONDITION_SCALE_VALUES[CONDITION_SCALE_VALUES.length - 1] ?? 0;

interface RepeatedMarkProps {
  /** How many copies to draw. `0` draws nothing: level 0 is *None* on both scales, and §0.6
   * gives no mark to a value whose meaning is the absence of the thing. */
  count: number;
  symbol: PlatformSymbol;
  tintColor: ColorValue;
  size: number;
  scheme: ColorScheme;
}

function RepeatedMark({ count, symbol, tintColor, size, scheme }: RepeatedMarkProps) {
  const styles = makeStyles(scheme);
  // Clamped for the same reason `filledDotCount` clamps the rating's dots, and it is the same
  // rule wearing different clothes: DESIGN.md §10 keeps these columns unclamped, so an M2 sync
  // row from a client with a wider scale can hold `current: 9` — and `count` copies of an
  // arrow is the one place where a number this component did not choose becomes a *loop*.
  // Nine arrows inside a chip is not a reading of anything; three is at least the top of this
  // build's scale. As with the rating, this changes only what is DRAWN — the stored value is
  // untouched, and `outOfScaleNote` is what tells the diver the real number.
  const copies = Math.min(Math.max(0, Math.round(count)), MAX_MARKS);
  if (copies <= 0) return null;
  const name = symbolName(symbol);
  return (
    <View style={styles.chipMarkRow}>
      {Array.from({ length: copies }, (_, i) => (
        <SymbolView key={i} name={name} size={size} tintColor={tintColor} />
      ))}
    </View>
  );
}

export interface ConditionMarkProps {
  level: ConditionLevel;
  /** The ink the mark is drawn in — handed over by `OptionChips`, never chosen here; see
   * `EntryIcon`'s own prop for why. */
  tintColor: ColorValue;
  /** Needed because a repeated mark is laid out by a `View` of this sheet's own
   * (`chipMarkRow`), which is not something a bare `SymbolView` needs. */
  scheme: ColorScheme;
  /** Smaller than a single-symbol mark's 15 by design: three of these sit where one
   * `EntryIcon` does, and at 15 apiece a "strong" chip would be more arrow than word — which
   * §0.6 forbids from the other direction ("it supplements the label rather than replacing
   * it"). */
  size?: number;
}

/**
 * The current, as arrows that **accumulate one way**: none, one, two, three.
 *
 * One direction is the whole content of the symbol. A current runs; it takes you somewhere,
 * and the harder it runs the more of it there is. `arrow.right` is the plainest thing in
 * either icon set that says "this way", which is what keeps this from needing a legend.
 */
export function CurrentIcon({ level, tintColor, scheme, size = 11 }: ConditionMarkProps) {
  return (
    <RepeatedMark
      count={level}
      symbol={{ ios: 'arrow.right', android: 'arrow_forward' }}
      tintColor={tintColor}
      size={size}
      scheme={scheme}
    />
  );
}

/**
 * The surge, as arrows that accumulate **two ways**: none, one, two, three.
 *
 * The bidirectional glyph is not decoration and it is not a way of avoiding a repeat of the
 * current's arrow — it is the actual difference between the two facts a diver is recording.
 * A current carries you one way; a surge is water moving back and forth and putting you back
 * roughly where you started. Because the *glyph* differs rather than only the count, "Surge:
 * strong" and "Current: strong" are told apart at a glance instead of by reading which row
 * you are on, which is exactly the failure that rules out a repeated wave for amplitude (see
 * this file's header).
 */
export function SurgeIcon({ level, tintColor, scheme, size = 11 }: ConditionMarkProps) {
  return (
    <RepeatedMark
      count={level}
      symbol={{ ios: 'arrow.left.arrow.right', android: 'sync_alt' }}
      tintColor={tintColor}
      size={size}
      scheme={scheme}
    />
  );
}

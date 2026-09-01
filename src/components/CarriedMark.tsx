import { SymbolView } from 'expo-symbols';
import { type ColorValue } from 'react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { symbolName, type PlatformSymbol } from './symbolName';

/**
 * The return mark: **`↵`, drawn, on every field DESIGN.md §2.1's carry-over filled in.**
 *
 * It replaces the `carried ×` chip — a filled `border` pill holding the word "carried" and a
 * typed `×` behind a divider — and the reason it is a mark rather than a word is §0.6's own,
 * stated there for the rating dots and the disclosure chevron before this: **drawn, not
 * typed.** Neither bundled face (Archivo, IBM Plex Mono — theme/fonts.ts) carries a return
 * code point, so a typed `↵` renders as tofu or nothing depending on the device, which is
 * exactly the finding that kept the group headers saying "Show"/"Hide" until a chevron was
 * drawn for them. `expo-symbols` is the mechanism, as it is for the rating, the entry chips,
 * the weather skies and the condition arrows.
 *
 * **Why a return arrow carries its own meaning**, which §0.6 requires of any mark ("the test
 * is whether the mark carries the meaning or merely labels it"): the value came *back* from
 * the dive before this one. Nothing about the shape has to be memorised, and the form's own
 * header line names it in words the first time a diver meets it (`formCarriedNote`,
 * theme/styles.ts) — which is what keeps this from being the legend §0.6 rules out, rather
 * than an assertion that it could not have been one.
 *
 * **The word survives where it was actually load-bearing.** A screen reader never saw the
 * chip's `carried` as a label it could use — it saw a decorative `Text` beside a control — and
 * what it did hear, then and now, is the clear control's own announcement: `Clear carried
 * Buddy`. So the mark is silent here (no `accessibilityLabel`, exactly as `EntryIcon` and
 * `WeatherIcon` are silent beside the labels they supplement), and the fact it draws is spoken
 * by the control next to it.
 */
export const CARRIED_MARK_SYMBOL: PlatformSymbol = { ios: 'return', android: 'keyboard_return' };

export interface CarriedMarkProps {
  scheme: ColorScheme;
  /**
   * 16 by default — the §0.6 sheet's own slot, and a little under the 15 px label beside it so
   * the mark reads as quieter than the words it qualifies. A prop so the header line can ask
   * for the same mark at its own scale rather than a second component being written for it.
   */
  size?: number;
}

/**
 * One return mark, muted.
 *
 * **The ink comes from the sheet, not from the caller**, which is the one place this differs
 * from `EntryIcon`/`ConditionMarks` and the difference is not arbitrary: those sit *inside* a
 * chip, whose ink inverts with its selection, so only the chip knows what colour they must be.
 * This never sits on an inverted ground — it marks a row, and a row's metadata is `fgMuted` in
 * both themes — so a `tintColor` prop would be a value every call site got a chance to get
 * wrong for no gain. `carriedMarkInk` (theme/styles.ts) is where the token meets the property,
 * per §4.1.
 */
export function CarriedMark({ scheme, size = 16 }: CarriedMarkProps) {
  const styles = makeStyles(scheme);
  return (
    <SymbolView
      name={symbolName(CARRIED_MARK_SYMBOL)}
      size={size}
      tintColor={styles.carriedMarkInk.color as ColorValue}
    />
  );
}

/**
 * DESIGN.md §0.6, M1h: **what a row reads once the diver has thrown its carried value away.**
 * An em dash where the value was, then the word, in the muted mono 11 `formFieldCleared`
 * (theme/styles.ts) gives it.
 *
 * It lives beside the mark because it is the other half of one subject — how a row says where
 * its value came from — and the two states are only meaningful against each other: the tag
 * exists so that "nothing was carried here" and "I threw it away" stop reading the same, which
 * is a sentence about the mark as much as about the tag.
 *
 * One string rather than a dash node and a tag node, because it is one reading, and splitting
 * it would let one half move without the other. A constant rather than a literal in the JSX so
 * the two components that show this state — `FormField` and `OptionChips`, whose chip groups
 * clear as a group — cannot spell it two ways; §4.1's "duplicated field labels" exception
 * covers a *label*, and this is a rule's own vocabulary.
 */
export const CLEARED_TAG = '— cleared';

/**
 * What that tag says out loud: the same word without the typography.
 *
 * Announced separately (`accessibilityLabel`, at both call sites) because a screen reader
 * meeting the string above spells the punctuation out — "dash cleared" — and the em dash is
 * there to make the row LOOK empty, which is a job it cannot do in speech.
 */
export const CLEARED_ANNOUNCEMENT = 'cleared';

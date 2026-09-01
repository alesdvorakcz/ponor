import { View } from 'react-native';

// The scale itself, from §4.1's owner of closed vocabularies rather than from a `5` written
// here: the form offers `RATING_VALUES` as tap targets and this draws `RATING_MAX` marks, and
// those two must be the same fact or a row of five ends up over a control offering four.
import { RATING_MAX, RATING_VALUES } from '../domain/types';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * How many of those marks are filled.
 *
 * `rating` is `number | null` rather than `1|2|3|4|5` on purpose (DESIGN.md §10: no DB CHECK
 * constraint, so a future client's out-of-range value is a runtime reality this type cannot
 * rule out). Clamped and rounded here so that reality can never turn into a negative or
 * out-of-range dot count — and clamped in **one** place, so the row and the form agree about
 * what a stored `9` looks like instead of one of them rendering nine dots.
 *
 * Note what clamping does *not* do: it does not change the value. A dive holding `9` still
 * holds `9` after this renders five filled dots, and the form says so in words beside the
 * control (`outOfScaleNote`, diveFormSchema.ts) rather than letting five filled dots
 * quietly stand in for a number that is not five.
 */
export function filledDotCount(rating: number): number {
  return Math.min(RATING_MAX, Math.max(0, Math.round(rating)));
}

export interface RatingDotProps {
  filled: boolean;
  scheme: ColorScheme;
  /**
   * `'row'` (default) is the 7 px mark a dive row's metadata line carries; `'field'` is the
   * larger one the dive form draws inside a tap target, where the mark is a control a wet
   * thumb has to hit rather than a value read at a glance.
   *
   * A variant rather than a second component, on `DepthValue`'s precedent one file over —
   * same rule, two scales, one owner. What must NOT vary is the pairing below: every dot
   * takes the same base style and `ratingDotFilled` only ever adds a fill on top of it, so a
   * "3 of 5" can never read as anything but five identical circles with three coloured in.
   * That invariant is the whole of §0.6's reason for drawing these at all, and it survives
   * the variant because the variant changes only which base is used.
   */
  variant?: 'row' | 'field';
}

/**
 * **One** rating mark, filled or outlined.
 *
 * DESIGN.md §0.6: "Rating marks are **drawn**, not typed: `●` and `○` are different sizes in
 * almost every typeface, so a rating rendered from glyphs looks broken; draw both as circles
 * of one diameter, filled or outlined."
 *
 * A single dot is the unit this exports, and that is what makes the form's control possible
 * without a second implementation of the mark: the row wants five of them in a line
 * (`RatingDots` below), and the form wants each one wrapped in its own 48 dp tap target
 * (§0.5), which no "draw the whole row" component can give it. Sharing the row and rewriting
 * the dot would have shared the easy half and duplicated the rule.
 *
 * Monochrome throughout — `theme.fg`, via the styles themselves — because §0.1 spends colour
 * on depth and nothing else, and a rating is chrome.
 */
export function RatingDot({ filled, scheme, variant = 'row' }: RatingDotProps) {
  const styles = makeStyles(scheme);
  const base = variant === 'field' ? styles.ratingDotField : styles.ratingDot;
  return <View style={[base, filled && styles.ratingDotFilled]} />;
}

/**
 * A rating as `RATING_MAX` marks, filled up to the rating and outlined beyond it — the
 * read-only reading, as a dive row's metadata line shows it.
 *
 * The dive form does **not** render this: its dots are individually pressable, so it maps
 * `RATING_VALUES` itself and wraps each `RatingDot` in a target. Both go through the same
 * vocabulary and the same `filledDotCount` above, which is where the rule actually lives.
 */
export function RatingDots({ rating, scheme }: { rating: number; scheme: ColorScheme }) {
  const styles = makeStyles(scheme);
  const filled = filledDotCount(rating);
  return (
    <View style={styles.diveRating}>
      {RATING_VALUES.map((level) => (
        <RatingDot key={level} filled={level <= filled} scheme={scheme} />
      ))}
    </View>
  );
}

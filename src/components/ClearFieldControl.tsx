import { SymbolView } from 'expo-symbols';
import { Pressable, type ColorValue } from 'react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { symbolName, type PlatformSymbol } from './symbolName';

/**
 * The ring: **the mark on the control that empties a form row.**
 *
 * Drawn rather than typed, for the reason §0.6 already gives for the rating dots, the
 * disclosure chevron and the return mark beside this one — a glyph's size varies by typeface,
 * and neither bundled face carries a ring at all, so the `×` this replaces was a multiplication
 * sign standing in for one. It is the platforms' own clear affordance in both vocabularies
 * (`xmark.circle` on iOS is what a search field draws; `highlight_off` is Material's outlined
 * equivalent, not the filled `cancel`), so a diver meets a shape they already know from every
 * other app on the device.
 */
export const CLEAR_FIELD_SYMBOL: PlatformSymbol = { ios: 'xmark.circle', android: 'highlight_off' };

export interface ClearFieldControlProps {
  /**
   * What a screen reader hears. Supplied by the caller rather than composed here, because the
   * two callers are saying two different things and both are true: `Clear carried Buddy` names
   * the carried value the diver is throwing away, and `Clear Time in` names an optional field
   * being unset. Composing one sentence here would make one of them wrong, and a flag to pick
   * between them would put the callers' vocabulary inside a control that has no opinion on it.
   */
  accessibilityLabel: string;
  onPress: () => void;
  scheme: ColorScheme;
}

/**
 * **A 20 pt ring in a 48 dp box** — the owner's design sheet in as many words, and §0.5's tap
 * floor met by geometry rather than by `hitSlop`.
 *
 * One control, two callers: `FormField`'s carried clear and `DateTimeField`'s optional-picker
 * clear. They were two compact chips with two copies of the same padding, the same mono `×`,
 * and the same exported slop constant holding them to the floor — §4.1's "one rule written in
 * two places, then drifting", with both halves already written twice.
 *
 * **The box is the target, and that is the property to keep.** `hitSlop` reaches §0.5's floor
 * invisibly, which means it is free to point anywhere, and it did: the carried chip's slop ran
 * 21 dp *inward*, over the word "carried", so tapping that word cleared the field — against
 * the owner's own reason for asking for a visible control in the first place ("a label you are
 * expected to guess is tappable is not an affordance"). `DateTimeField`'s copy had the same
 * numbers and a worse neighbour: the picker's trigger sits immediately to this control's left,
 * so inward slop drew "clear the field" straight over "open the picker". A box cannot do
 * either — it lays out in its own trailing column, nothing of it reaches back over the value,
 * and what a diver can see is exactly what a diver can press. Both callers' tests assert that
 * this carries no `hitSlop` at all, which is the assertion that keeps it that way.
 */
export function ClearFieldControl({ accessibilityLabel, onPress, scheme }: ClearFieldControlProps) {
  const styles = makeStyles(scheme);
  return (
    <Pressable
      style={styles.clearFieldControl}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {/* 20, the sheet's own figure: large enough to read as a control at arm's length on a
          deck, small enough that a row of them down the form does not compete with the values
          they sit beside. Written here rather than exported, so the test that pins it is
          stating the design rather than reading it back off the code. */}
      <SymbolView
        name={symbolName(CLEAR_FIELD_SYMBOL)}
        size={20}
        tintColor={styles.clearFieldInk.color as ColorValue}
      />
    </Pressable>
  );
}

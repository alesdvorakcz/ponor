import { type ReactNode } from 'react';
import { Pressable, Text, View, type AccessibilityRole, type AccessibilityState, type ColorValue } from 'react-native';

import { t } from '../i18n';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { tileRows } from './tileRows';

/**
 * What one option does, which is all that differs between `OptionChips` (a pick: a press chooses
 * one value or clears it, heard as a button) and `TokenChips` (a set: a press toggles one member,
 * heard as a checkbox). `on` is chosen for the one and a member for the other, and inverts either way.
 */
export interface ChoiceBehaviour {
  on: boolean;
  onPress: () => void;
  role: AccessibilityRole;
  state: AccessibilityState;
}

export interface ChoiceGridProps<T extends string | number> {
  /** The field's label, for what a screen reader hears on each option. */
  label: string;
  options: readonly T[];
  displayLabel: (option: T) => string;
  scheme: ColorScheme;
  layout: 'chips' | 'tiles';
  /** Tiles to a row: 3, or 4 for the shorter waves row. Ignored for chips. */
  columns: 3 | 4;
  icon?: (option: T, ink: ColorValue, ground: ColorValue) => ReactNode;
  disabled?: boolean;
  behaviour: (option: T) => ChoiceBehaviour;
}

/**
 * **The options of a fixed-choice field, laid out and drawn** — the one owner of how a chip or a
 * tile looks for `OptionChips` and `TokenChips` (PR #66 review: the two carried the same layer line
 * for line). §4.1: what makes an option read as chosen is a rule, and a second copy of it is how two
 * rows end up looking different. Each caller keeps only what its press does and what a screen
 * reader is told about its state (`behaviour`).
 *
 * As chips, a row that wraps; as tiles (issue #6), a grid of `columns`, the last row padded with
 * spacers that carry the tile's padding and border, so a short row's tiles are as wide as a full
 * row's (`tileRows`, `formTileSpacer`).
 */
export function ChoiceGrid<T extends string | number>({
  label,
  options,
  displayLabel,
  scheme,
  layout,
  columns,
  icon,
  disabled,
  behaviour,
}: ChoiceGridProps<T>) {
  const styles = makeStyles(scheme);
  const tiles = layout === 'tiles';
  const renderOption = (option: T) => {
    const { on, onPress, role, state } = behaviour(option);
    // The ink the option's own label is about to wear, read off the style rather than from the
    // theme directly — the same "take the colour from the style you are matching" move
    // `DateTimeField` makes for the native picker's `textColor`. It is handed to `icon` so a symbol
    // beside the label inverts with it (§0.6), instead of staying `fg` on an `action` ground where
    // it would vanish — and the ground with it, for the knocks in a drawn icon (issue #6).
    const text = tiles ? styles.formTileText : styles.formChipText;
    const textOn = tiles ? styles.formTileTextSelected : styles.formChipTextSelected;
    const box = tiles ? styles.formTile : styles.formChip;
    const boxOn = tiles ? styles.formTileSelected : styles.formChipSelected;
    const ink = (on ? textOn.color : text.color) as ColorValue;
    const ground = (on ? boxOn.backgroundColor : box.backgroundColor) as ColorValue;
    return (
      <Pressable
        key={option}
        style={[box, tiles && columns === 4 && styles.formTileShort, on && boxOn]}
        onPress={onPress}
        accessibilityRole={role}
        // Unchanged by the icon, deliberately: §0.6 makes the icon a supplement to the label, so
        // what a screen reader hears is exactly what the words say.
        accessibilityLabel={t('field.labelValue', { label, value: displayLabel(option) })}
        disabled={disabled}
        accessibilityState={state}
      >
        {icon?.(option, ink, ground)}
        <Text style={[text, on && textOn]}>{displayLabel(option)}</Text>
      </Pressable>
    );
  };
  if (!tiles) return <View style={styles.formChipRow}>{options.map(renderOption)}</View>;
  return (
    <View style={styles.formTileGrid}>
      {tileRows(options, columns).map((row, index) => (
        <View key={index} style={styles.formTileRow}>
          {row.map((option, slot) =>
            option === null ? <View key={`spacer-${slot}`} style={styles.formTileSpacer} /> : renderOption(option),
          )}
        </View>
      ))}
    </View>
  );
}

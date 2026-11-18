import { type ReactNode } from 'react';
import { Text, View, type ColorValue } from 'react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { ChoiceGrid, type ChoiceBehaviour } from './ChoiceGrid';

export interface TokenChipsProps<T extends string> {
  label: string;
  /** The tokens held now, in stored order. May hold one `options` does not offer. */
  values: readonly T[];
  /** What this build offers, in the vocabulary's own order. */
  options: readonly T[];
  displayLabel: (option: T) => string;
  /** The set after a press: the offered options in `options` order, then any held token this
   * build does not offer, in its stored order. */
  onChange: (next: T[]) => void;
  scheme: ColorScheme;
  /** A muted word at the label row's trailing edge — the slot `OptionChips`' caption takes. */
  caption?: string;
  /** Every chip shut, and said so to a screen reader, while the value is being saved. */
  disabled?: boolean;
  /** `OptionChips`' `layout`, `columns` and `icon`, for the same reasons (issue #6). */
  layout?: 'chips' | 'tiles';
  columns?: 3 | 4;
  icon?: (option: T, ink: ColorValue, ground: ColorValue) => ReactNode;
}

/**
 * A fixed-choice field that holds a **set** — a site's types, a centre's services — drawn as
 * `OptionChips`' row: the same styles, so a chosen chip is the inverted one here as there
 * (§0.6, §0.1: no hue on a control).
 *
 * A second component rather than a mode on `OptionChips`, whose own docblock refuses modes: a
 * press there picks one value or clears it, a press here toggles one member, and a screen reader
 * hears the second as a checkbox rather than a button. The look stays one rule because the
 * style keys are the same ones.
 *
 * **A token this build does not offer is kept, never dropped** (§10: store and flag). A newer
 * client's `cavern` has no chip here, but pressing *Reef* must not quietly delete it from the
 * row; it follows the offered ones in its stored order.
 */
export function TokenChips<T extends string>({
  label,
  values,
  options,
  displayLabel,
  onChange,
  scheme,
  caption,
  disabled,
  layout = 'chips',
  columns = 3,
  icon,
}: TokenChipsProps<T>) {
  const styles = makeStyles(scheme);
  const toggle = (option: T) => {
    const next = values.includes(option) ? values.filter((value) => value !== option) : [...values, option];
    onChange([...options.filter((offered) => next.includes(offered)), ...next.filter((value) => !options.includes(value))]);
  };
  // A press toggles one member, and a screen reader hears a checkbox; the look is `ChoiceGrid`'s.
  const behaviour = (option: T): ChoiceBehaviour => {
    const checked = values.includes(option);
    return {
      on: checked,
      onPress: () => toggle(option),
      role: 'checkbox',
      state: { checked, disabled: disabled === true },
    };
  };
  return (
    <View style={styles.formField}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        {caption !== undefined && (
          <View style={styles.formFieldValue}>
            <Text style={styles.formFieldCaption}>{caption}</Text>
          </View>
        )}
      </View>
      <ChoiceGrid
        label={label}
        options={options}
        displayLabel={displayLabel}
        scheme={scheme}
        layout={layout}
        columns={columns}
        icon={icon}
        disabled={disabled}
        behaviour={behaviour}
      />
    </View>
  );
}

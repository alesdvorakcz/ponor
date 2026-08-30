import { forwardRef } from 'react';
import { Text, TextInput, View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

export interface FormFieldProps {
  /** Wraps rather than truncates — never `numberOfLines`, never `ellipsizeMode` (DESIGN.md
   * §0.5: Czech runs 20-30% longer than English, so a label that fit in English must still
   * be free to grow to a second line rather than clip). */
  label: string;
  /**
   * Always a string. `diveFormSchema.ts`'s coercion contract already owns turning an
   * empty string into `null` at the write boundary (`optionalNumber`/`optionalText`), so
   * this component never has to hold or format a `number | null` itself — the
   * `Controller` render prop that wires this up is what bridges a `DiveFormValues` field
   * to one plain string.
   */
  value: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  scheme: ColorScheme;
  /** Numeric fields get the decimal-pad keyboard (M1d task 4 brief); every other field
   * takes this input's own default keyboard. */
  keyboardType?: 'default' | 'decimal-pad';
  multiline?: boolean;
  placeholder?: string;
}

/**
 * One form row (DESIGN.md §2.2): a label above an input, with the label's own row left
 * open at its trailing edge — `formFieldHeader`'s `justifyContent: 'space-between'` — for
 * the `carried ×` chip Task 5 adds (§0.6). This task only reserves that space; it does not
 * guess the chip's shape.
 *
 * `forwardRef`s its `TextInput` so a `Controller`'s `field.ref` can attach to the real
 * input for react-hook-form's own focus management, rather than being destructured and
 * discarded — the exact risk M1d task 1's probe checked for before this screen existed,
 * confirming `field.ref` forwarded straight through as a prop survives this repo's lint
 * and typecheck gates.
 */
export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, value, onChange, onBlur, scheme, keyboardType, multiline, placeholder },
  ref,
) {
  const styles = makeStyles(scheme);
  return (
    <View style={styles.formField}>
      <View style={styles.formFieldHeader}>
        <Text style={styles.formFieldLabel}>{label}</Text>
      </View>
      <TextInput
        ref={ref}
        style={[styles.formFieldInput, multiline && styles.formFieldInputMultiline]}
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={styles.formFieldLabel.color}
        accessibilityLabel={label}
      />
    </View>
  );
});

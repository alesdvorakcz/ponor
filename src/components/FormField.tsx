import { forwardRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

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
  /**
   * Numeric fields get the decimal-pad keyboard (M1d task 4 brief); every other field
   * takes this input's own default keyboard.
   *
   * `'number-pad'` is the third option and it is not decoration: a field that counts
   * whole things — the cylinder `count`, "twinset = 2" (DESIGN.md §6) — must not offer a
   * separator key at all. `decimal-pad` shows one, and on a Czech, German or French device
   * it types a comma, so the keypad was inviting a value `derived.ts` treats as
   * *contradictory*: a fractional count voids the whole dive's gas figure rather than
   * skipping one cylinder. `number-pad` has no separator to press.
   */
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  multiline?: boolean;
  placeholder?: string;
  /**
   * DESIGN.md §0.6: "A prefilled field shows a `carried ×` chip." Owned entirely by the
   * caller (`DiveFormScreen.tsx` derives it from `CARRIED_FIELDS`, M1d task 3) — this
   * component has no opinion on WHY a value is carried, only on how to show that it is.
   * There is no internal "was this edited" state here either: a caller drops the chip by
   * simply rendering this component again with `carried={false}` (or omitted) the next
   * time, which is exactly what happens the instant `onChange`/`onClear` fires and the
   * caller's own state updates — "overwriting is just typing, and drops the chip" (§0.6)
   * is a fact about the CALLER's state, not something this component tracks itself.
   */
  carried?: boolean;
  /**
   * Fired when the diver taps the chip's `×`, with the field's new value — always `''`,
   * the same "the value the field reports after clearing must be ''" contract `onChange`
   * itself already carries. Never `0`: `diveFormSchema.ts`'s coercion contract
   * (`optionalNumber`/`optionalText`) turns `''` into `null` at the write boundary, where
   * a `0` would reach `derived.ts` as *contradictory* data and void the dive's whole gas
   * figure (DESIGN.md §10) — this is the one interaction that could violate that contract
   * from the UI side, so this component only ever passes the literal empty string, never
   * derives one from the field's own (numeric-looking) current value. Kept as a distinct
   * prop from `onChange`, rather than this component calling `onChange('')` itself on `×`,
   * so a caller that wants to tell "the diver cleared this" apart from "the diver typed a
   * value" — `DiveFormScreen.tsx` does, to drop the field from its carried set either way
   * but through one shared path — still can.
   */
  onClear?: (value: string) => void;
}

/**
 * 48 dp (§0.5's own floor) around the chip's `×`, via `hitSlop` rather than an inflated
 * visible box — the same "small visible control, generous hidden target" split
 * `ReorderControls.tsx`'s own `ARROW_HIT_SLOP` documents at length, and for the same
 * reason: the chip sits inline in a field's label row, and a 48 x 48 visible box would
 * make that row far taller than the 14 px label text beside it. Unlike `ARROW_HIT_SLOP`,
 * there is no fixed visible box to subtract from here — the `×` is one mono glyph inside
 * `formFieldCarriedClear`'s own padding, which sizes itself to the text — so these numbers
 * are deliberately generous rather than measured precisely, to clear 48 dp with margin
 * regardless of exact glyph metrics on a given device.
 */
const CLEAR_HIT_SLOP = { top: 14, bottom: 14, left: 12, right: 12 };

/**
 * One form row (DESIGN.md §2.2): a label above an input, with the label's own row left
 * open at its trailing edge — `formFieldHeader`'s `justifyContent: 'space-between'` — for
 * the `carried ×` chip below (§0.6).
 *
 * `forwardRef`s its `TextInput` so a `Controller`'s `field.ref` can attach to the real
 * input for react-hook-form's own focus management, rather than being destructured and
 * discarded — the exact risk M1d task 1's probe checked for before this screen existed,
 * confirming `field.ref` forwarded straight through as a prop survives this repo's lint
 * and typecheck gates.
 */
export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, value, onChange, onBlur, scheme, keyboardType, multiline, placeholder, carried, onClear },
  ref,
) {
  const styles = makeStyles(scheme);
  return (
    <View style={styles.formField}>
      <View style={styles.formFieldHeader}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        {carried && (
          <View style={styles.formFieldCarried}>
            <Text style={styles.formFieldCarriedLabel}>carried</Text>
            {/* The owner's own correction (task brief): an earlier design made the whole
                chip tappable with no visible `×` — "nothing about the word 'carried' says
                tap me to remove it... a label you are expected to guess is tappable is not
                an affordance." `formFieldCarriedClear`'s left border is the divider that
                makes only THIS segment read as a control. */}
            <Pressable
              style={styles.formFieldCarriedClear}
              onPress={() => onClear?.('')}
              accessibilityRole="button"
              accessibilityLabel={`Clear carried ${label}`}
              hitSlop={CLEAR_HIT_SLOP}
            >
              <Text style={styles.formFieldCarriedClearLabel}>×</Text>
            </Pressable>
          </View>
        )}
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

import { type CSSProperties, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { ClearFieldControl } from './ClearFieldControl';
import type { DateTimeField as NativeDateTimeField, DateTimeFieldProps } from './DateTimeField';

/**
 * The browser's `DateTimeField`. Web only; Metro picks this file over `DateTimeField.tsx`
 * for `--platform web`, and Jest's platforms are iOS-only, so nothing here reaches a device
 * build or a test run.
 *
 * It exists because `@react-native-community/datetimepicker` ships `.android`, `.ios` and
 * `.windows` implementations and nothing for the web: in a browser the native file renders
 * its row, opens on tap, and then draws no picker at all. Confirmed in Chrome before this
 * file was written — the Date row took its focus fill and nothing appeared under it.
 *
 * **The browser's own date and time inputs are the picker here**, and they keep the property
 * DESIGN.md §10 chose a picker for in the first place: an `<input type="date">` cannot hold
 * anything but a real date, and an `<input type="time">` cannot hold anything but a real
 * time. They keep a second one for free — both report their value as `YYYY-MM-DD` / `HH:MM`
 * regardless of the locale they *display*, which is exactly the string this app stores. So
 * unlike the native file, this one converts nothing: no `Date` is built, parsed or handed
 * around, and `domain/datetime.ts` is not consulted because there is nothing to ask it.
 * That is why `day` is unused here — it exists on native to decide which day a wall-clock
 * time is seeded onto, and nothing here seeds anything.
 *
 * **What is deliberately different from native, and why.** The browser draws the value in
 * the viewer's own locale format, so `format/display.ts`'s `formatDiveDate` does not produce
 * the text a diver reads here. That is delegation, not a second implementation — the same
 * delegation the native file already makes when it hands the OS the picker — and nothing in
 * this file formats a date itself. Two consequences follow, both accepted for a testing
 * target: the date reads as the browser spells it, and a stored value this app cannot read
 * (a hand-edited row, an M2 sync from a client that spells dates its own way) shows as empty
 * here rather than being shown as it stands, because an `<input type="date">` has nowhere to
 * put it. `placeholder` is unused for the same reason: browsers ignore it on these inputs
 * and draw their own `dd/mm/yyyy` hint instead.
 */
export function DateTimeField({ label, value, onChange, mode, scheme, onClear }: DateTimeFieldProps) {
  const styles = makeStyles(scheme);
  const [focused, setFocused] = useState(false);

  const stored = value ?? '';
  const recorded = stored.trim() !== '';

  // The row's typography, read off the one place tokens meet style properties rather than
  // written again here — the ink and the face are whatever `styles.ts` says they are, and a
  // token change reaches this input without anyone remembering to come back. It is read
  // rather than spread because a DOM node takes CSS, not a React Native `TextStyle`: RN
  // spells the numeric face as `fontVariant: ['tabular-nums']` and CSS as
  // `font-variant-numeric`, so that one is translated, not copied.
  //
  // Everything below it is structural — stripping the browser's default box so the input
  // sits in the row the way the native trigger's `Text` does, and filling §0.5's 48 dp
  // target so the whole value area is tappable — and carries no colour of its own.
  // `colorScheme` is the exception that earns its place: it is what makes the browser render
  // its *own* calendar and clock chrome dark, and without it a dark app opens a white picker.
  const { color, fontFamily, fontSize, fontVariant } = StyleSheet.flatten(
    recorded ? styles.formFieldPickerText : styles.formFieldPickerTextUnset,
  );
  const inputStyle: CSSProperties = {
    color: typeof color === 'string' ? color : undefined,
    fontFamily,
    fontSize,
    fontVariantNumeric: fontVariant?.join(' '),
    textAlign: 'right',
    width: '100%',
    height: 48,
    padding: 0,
    background: 'none',
    border: 'none',
    outline: 'none',
    colorScheme: scheme,
  };

  return (
    <View style={[styles.formField, focused && styles.formFieldFocused]}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        <View style={styles.formFieldPicker}>
          <input
            type={mode}
            value={stored}
            aria-label={label}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              const next = event.target.value;
              // Emptying the control is not the same gesture as clearing the field, and on a
              // required field it is not a gesture this form has: the native file's `commit`
              // ignores a picker that hands back nothing and leaves the row exactly as it
              // was, and so does this. Clearing stays the `×` below, which a required field
              // never renders — so a date cannot be emptied here any more than it can be
              // mistyped, which is the whole of what §10 asked a picker for.
              if (next === '' && onClear === undefined) return;
              onChange(next);
            }}
            style={inputStyle}
          />
        </View>
        {onClear !== undefined && recorded && (
          <ClearFieldControl
            // `''`, never a value derived from what this field currently holds — see
            // `FormField.onClear`'s own docblock, and DESIGN.md §10's coercion contract.
            onPress={() => onClear('')}
            accessibilityLabel={`Clear ${label}`}
            scheme={scheme}
          />
        )}
      </View>
    </View>
  );
}

type Assert<T extends true> = T;

/**
 * Type-level proof that the browser's field is still substitutable for the native one — the
 * same device `TankFormFieldsMatchTank` uses in `diveFormSchema.ts`. The form imports one
 * name and must not be able to tell which implementation it got.
 *
 * **What it catches, exactly:** this file growing a contract of its own that is narrower than
 * the native one — its own props interface, or a prop restricted to fewer values (`mode:
 * 'date'` because the browser's time input was never wired up). Verified by making that last
 * mutation: `tsc` fails on this line with "Type 'false' does not satisfy the constraint
 * 'true'". **What it does not catch:** a prop *added* to `DateTimeField.tsx`. Both files read
 * the same `DateTimeFieldProps`, so a new prop type-checks in both and this file would simply
 * ignore it. There is no type that would catch that, and pretending otherwise would be worse
 * than saying so.
 *
 * The import above is `import type`, so Babel erases it: TypeScript reads `./DateTimeField`
 * as the native file (it does not apply Metro's platform extensions), while the web bundle
 * never resolves the specifier at all and cannot import itself.
 */
export type WebDateTimeFieldMatchesNative = Assert<
  typeof DateTimeField extends typeof NativeDateTimeField ? true : false
>;

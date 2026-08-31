import { forwardRef, useState } from 'react';
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
   * DESIGN.md §0.6: "**Figures in mono, names in sans.** A depth, duration, pressure or
   * temperature is a data figure and takes Plex Mono 15 with tabular figures (§0.2); a site,
   * centre or buddy is a name and stays Archivo."
   *
   * Set **explicitly at every call site**, exactly as `DiveDetailScreen`'s own `Field.mono`
   * is, and deliberately NOT inferred from `keyboardType` above: the two answer different
   * questions. A latitude and a cylinder count both take a numeric keypad; only one of them
   * is a figure a diver reads back off a slate. Inferring it would let a new field pick up
   * the wrong face silently, which is the whole reason this form and the detail screen
   * drifted apart in the first place.
   */
  mono?: boolean;
  /**
   * The unit this field's figure is measured in — `m`, `min`, `bar`, `kg`, `°C`.
   *
   * DESIGN.md §0.6 gives it two jobs and they are the same word in the same slot: it follows
   * a figure "as a muted suffix, exactly as `12.2 m` reads on the detail", and an **empty**
   * field "shows that unit as its placeholder so the row still says what belongs in it." So
   * one is drawn or the other, never both.
   *
   * Distinct from `placeholder` above, which is for a field whose hint is not a unit — the
   * `0-3` of a conditions scale, the `1-5` of a rating. Rendering "3 0-3" would be nonsense,
   * and a single prop could not tell the two cases apart.
   */
  unit?: string;
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
 * 48 dp (§0.5's own floor) around a form row's `×`, via `hitSlop` rather than an inflated
 * visible box — the same "small visible control, generous hidden target" split
 * `ReorderControls.tsx`'s own `ARROW_HIT_SLOP` documents at length, and for the same
 * reason: the control sits inline in a field's row, and a 48 x 48 visible box would make
 * that row far taller than the 15 px label text beside it.
 *
 * **Exported, because two components clear a form row**: this file's `carried ×` chip and
 * `DateTimeField`'s picker `×`. They are the same control in the same row and were two
 * byte-identical `const CLEAR_HIT_SLOP` declarations, each under its own copy of the
 * reasoning below — §4.1's "one rule written in two places, then drifting", with the
 * drift still pending. One definition now, imported there; a number that has to move
 * moves once.
 *
 * **All of it points away from the label. That is the load-bearing property, not the
 * numbers.** The previous values were `{ top: 14, bottom: 14, left: 21, right: 0 }`, which
 * reached the floor by extending the clear target 21 dp INWARD — over the word "carried" —
 * so tapping that word cleared the field. The owner asked for a visible cross specifically
 * so that clearing would be a deliberate act ("a label you are expected to guess is
 * tappable is not an affordance"), and a target covering the label undoes exactly that, the
 * more so because the word sits inside the same filled chip and reads as part of the same
 * object. `left: 0` is therefore not a spare zero to be balanced away if the numbers are
 * ever retuned; both components' tests assert it directly.
 *
 * Inward is worse still on `DateTimeField`'s copy of this control, and for a second reason:
 * since §0.6's design pass the picker's own trigger sits immediately to that `×`'s LEFT, so
 * left slop would put "clear the field" over "open the picker" — the same mistake with a
 * control in place of a word. There it was never merely wasteful; on a field whose `×` sits
 * alone the old inward slop fell across empty space in the label row and cost nothing, which
 * is why that copy went unnoticed while this one was being fixed.
 *
 * **What made inward look like the only direction, and why it was not.** The reasoning
 * recorded here was "slop is only delivered where every ancestor also contains the point",
 * so anything right of a chip flush with the row's trailing edge is delivered to nobody.
 * That is not what React Native does: `RCTView.hitTest` descends into a view's subviews
 * for a point outside that view whenever the view does **not** clip to bounds
 * (`if (![self clipsToBounds] || isPointInside)`). Every ancestor here is unclipped except
 * one — `formFieldCarried` carried `overflow: 'hidden'`, clipping nothing visible and the
 * slop with it. Dropping that property (theme/styles.ts) is what makes outward real.
 *
 * **The arithmetic.** The `×` zone is `formFieldCarriedClear`'s own `paddingHorizontal: 14`
 * plus one mono glyph at fontSize 11 — call it 35 dp — and 14 dp of slop to its right
 * brings it past 48. That 14 has somewhere to go: `formField`'s own trailing padding
 * (`FORM_ROW_INSET`, theme/styles.ts) is 20 dp of room inside the row's own unclipped box,
 * between the chip's trailing edge and the row's. Before §0.6's design pass the same 20 came
 * from `formScrollContent`'s padding, outside the field entirely; the room moved inward with
 * the inset and got no smaller. Vertically the 14 above and below is spent inside
 * `formField`'s `minHeight: 48`, which is what makes the target the row's full height
 * whatever the glyph's exact metrics turn out to be. `DateTimeField`'s row is the same
 * `formField`, so the arithmetic holds there unchanged — which is what made the two
 * declarations identical in the first place.
 */
export const CLEAR_HIT_SLOP = { top: 14, bottom: 14, left: 0, right: 14 };

/**
 * One form field (DESIGN.md §2.2, restyled to §0.6): **a row, not a box** — the label at the
 * leading edge, the typed value trailing, and a hairline on the row's own top edge. It is
 * `DiveDetailScreen`'s `Row` made typeable, which is the whole point of §0.6's form section:
 * "The form is the dive detail you can type into."
 *
 * What it replaces: a label stacked above a bordered, `surface`-filled input drawn in advance
 * for every field whether or not it was being used. §0.6: "Five bordered boxes down the core
 * strip was the heaviest chrome in the app."
 *
 * **Focus is what draws the affordance** (§0.6). The row fills with `surface` while the input
 * holds focus and nothing else does, so the box appears where it is wanted instead of five
 * times over. The state is local: nothing outside this component has any use for it, and
 * `onBlur` is still forwarded to whatever the caller passed — react-hook-form's own
 * `field.onBlur`, which is what marks a field touched — rather than being swallowed here.
 *
 * `forwardRef`s its `TextInput` so a `Controller`'s `field.ref` can attach to the real
 * input for react-hook-form's own focus management, rather than being destructured and
 * discarded — the exact risk M1d task 1's probe checked for before this screen existed,
 * confirming `field.ref` forwarded straight through as a prop survives this repo's lint
 * and typecheck gates.
 */
export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, value, onChange, onBlur, scheme, keyboardType, multiline, placeholder, mono, unit, carried, onClear },
  ref,
) {
  const styles = makeStyles(scheme);
  const [focused, setFocused] = useState(false);

  // Notes, and notes alone. The detail screen renders notes as a full-width paragraph rather
  // than as a row (`detailNotes`), because a paragraph right-aligned into a trailing slot is
  // unreadable — so this follows it there: the label keeps its row, and the box drops to the
  // full width beneath it, in the slot §0.6 gives a field's second line.
  const stacked = multiline === true;

  const input = (
    <TextInput
      ref={ref}
      style={[styles.formFieldInput, mono === true && styles.formFieldInputMono, stacked && styles.formFieldInputMultiline]}
      value={value}
      onChangeText={onChange}
      onFocus={() => setFocused(true)}
      // Both, in this order: the row stops being the focused one, and the caller still hears
      // about the blur it asked for.
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
      keyboardType={keyboardType ?? 'default'}
      multiline={multiline}
      // §0.6: an empty numeric field shows its unit as the placeholder, "so the row still
      // says what belongs in it". `placeholder` covers the fields whose hint is not a unit —
      // a conditions scale's `0-3`, a rating's `1-5`.
      placeholder={unit ?? placeholder}
      placeholderTextColor={styles.formFieldLabel.color}
      accessibilityLabel={label}
    />
  );

  return (
    <View style={[styles.formField, focused && styles.formFieldFocused]}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        {!stacked && (
          <View style={styles.formFieldValue}>
            {input}
            {/* The muted suffix (§0.6), drawn only while there is a figure for it to follow:
                an empty field is already showing this same word as its placeholder, and both
                at once would read as "m m". */}
            {unit !== undefined && value !== '' && <Text style={styles.formFieldUnit}>{unit}</Text>}
          </View>
        )}
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
      {stacked && input}
    </View>
  );
});

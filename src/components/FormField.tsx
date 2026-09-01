import { forwardRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { type Suggestion } from '../domain/suggest';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { CarriedMark, CLEARED_ANNOUNCEMENT, CLEARED_TAG } from './CarriedMark';
import { ClearFieldControl } from './ClearFieldControl';

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
   * whole things must not offer a separator key at all. `decimal-pad` shows one, and on a
   * Czech, German or French device it types a comma, so such a keypad invites a fraction
   * into a field where a fraction is not merely odd but wrong. `number-pad` has no separator
   * to press.
   *
   * **Its one caller is Settings' `dives_before` now.** It was written for the cylinder
   * `count`, where a fractional value was *contradictory* in `derived.ts`'s sense and voided
   * the whole dive's gas figure; M1h replaced that field with a rig picked from chips
   * (§10), which no keypad can produce a fraction of. The option stays because the hazard is
   * a property of counting rather than of that one field — but a reader looking for the
   * cylinder count it used to name will not find one.
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
   * DESIGN.md §0.6: a prefilled field shows a drawn return mark and a clear control, together
   * at the row's trailing edge (the owner's ruling — see `formFieldCarryState`, theme/styles.ts,
   * for what the sheet's own placement did on a device). Owned entirely by the caller
   * (`DiveFormScreen.tsx` derives it from `CARRIED_FIELDS`, M1d task 3) — this component has
   * no opinion on WHY a value is carried, only on how to show that it is. There is no
   * internal "was this edited" state here either: a caller drops the mark by simply rendering
   * this component again with `carried={false}` (or omitted) the next time, which is exactly
   * what happens the instant `onChange`/`onClear` fires and the caller's own state updates —
   * "overwriting is just typing, and drops the chip" (§0.6) is a fact about the CALLER's
   * state, not something this component tracks itself.
   */
  carried?: boolean;
  /**
   * DESIGN.md §0.6, M1h: **the diver emptied this field on purpose**, so the row reads
   * `— cleared` instead of looking exactly like a field carry-over never filled.
   *
   * That distinction is the whole reason this prop exists. Before it, a diver who threw away
   * a carried buddy saw precisely what a diver whose last dive had no buddy saw — an empty
   * row — so the app knew something it never showed. Three states, three readings: nothing
   * carried is a plain empty row, carried is the mark plus the value plus the clear control,
   * cleared is the tag alone.
   *
   * **Never `carried` at the same time**, and this component does not have to police that:
   * clearing is what puts a field here, and it drops the mark in the same gesture. What this
   * component DOES police is the tag against the field's own `value` — see the render body.
   * The state is the caller's (`SeedState.cleared`, DiveFormScreen.tsx), because only the
   * caller knows which gesture emptied the field and only the caller's copy survives a
   * reseed.
   */
  cleared?: boolean;
  /**
   * Fired when the diver taps the clear control, with the field's new value — always `''`,
   * the same "the value the field reports after clearing must be ''" contract `onChange`
   * itself already carries. Never `0`: `diveFormSchema.ts`'s coercion contract
   * (`optionalNumber`/`optionalText`) turns `''` into `null` at the write boundary, where
   * a `0` would reach `derived.ts` as *contradictory* data and void the dive's whole gas
   * figure (DESIGN.md §10) — this is the one interaction that could violate that contract
   * from the UI side, so this component only ever passes the literal empty string, never
   * derives one from the field's own (numeric-looking) current value. Kept as a distinct
   * prop from `onChange`, rather than this component calling `onChange('')` itself on the
   * ring, so a caller that wants to tell "the diver cleared this" apart from "the diver typed
   * a value" still can — `DiveFormScreen.tsx` does, and since M1h it does something with the
   * answer: only the clearing gesture leaves `— cleared` behind.
   */
  onClear?: (value: string) => void;
  /**
   * DESIGN.md §2.3's autocomplete, for the four fields that have it — what `suggestFrom`
   * (domain/suggest.ts) offered for this field's current text. **Optional, and omitted at
   * every other call site**: a field given neither this nor `onPickSuggestion` renders
   * exactly what it rendered before either existed, which is what lets the 24 other fields on
   * the dive form, both fields on Settings, and the cylinder-preset work landing beside this
   * one go on passing neither.
   *
   * This component decides only WHERE the list goes and WHEN it is drawn; it has no opinion
   * on what belongs in it or in what order — the same split `carried` above draws, where the
   * caller knows WHY a value is carried and this knows how to show that it is. §0.6 makes the
   * position a fact about the row ("The list belongs directly under the focused row"), which
   * is why it is drawn here at all rather than by the screen: a list positioned by the caller
   * would be positioned four times.
   */
  suggestions?: Suggestion[];
  /**
   * Fired with the **whole** `Suggestion` the diver tapped, never just its text.
   *
   * The id half is DESIGN.md §6's `site_id` + `site_name` snapshot pair, and handing back the
   * text alone would leave the caller with a name and no way to know which site record it
   * named — §10, for this task: "picking a suggestion sets both together... otherwise a dive
   * carries one site's id under another's name."
   *
   * Deliberately NOT routed through `onChange`, exactly as `onClear` above is not: a caller
   * that has to tell "the diver typed this" from "the diver picked this" still can, and
   * DiveFormScreen does — typing over a site name CLEARS the paired id, so delivering a pick
   * through the typing path would set the id and clear it again in one gesture.
   */
  onPickSuggestion?: (suggestion: Suggestion) => void;
}

/*
 * `CLEAR_HIT_SLOP` used to live here: 48 dp around a form row's `×` via `hitSlop`, exported
 * because two components (this one's `carried ×` chip and `DateTimeField`'s picker `×`) each
 * reached §0.5's floor that way. Both draw `ClearFieldControl` now, which is a real 48 dp box,
 * so there is no slop left to point anywhere and no constant to share.
 *
 * The reasoning did not go with it — see `ClearFieldControl.tsx` and `clearFieldControl`
 * (theme/styles.ts), which carry the whole account of why an invisible target is free to point
 * the wrong way and did (21 dp inward, over the word "carried", so tapping the label cleared
 * the field), and why a box cannot.
 */

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
  { label, value, onChange, onBlur, scheme, keyboardType, multiline, placeholder, mono, unit, carried, cleared, onClear, suggestions, onPickSuggestion },
  ref,
) {
  const styles = makeStyles(scheme);
  const [focused, setFocused] = useState(false);

  // **The tag is drawn only over a row that is actually empty**, and that guard belongs here
  // rather than only in the caller. `cleared` is a claim about a gesture; `— cleared` is a
  // claim about what the row HOLDS, and this is the only place that can see both. A tag
  // sitting beside a value the diver has since typed would be the loudest kind of lie this
  // form can tell — the row would say it is empty while showing a number that is about to be
  // saved. The caller drops `cleared` on every gesture that writes a value (DiveFormScreen's
  // own `noteTouched`), so in practice this never fires; it is what makes the rendering
  // honest whatever the caller's state does.
  const showCleared = cleared === true && value === '';

  // Notes, and notes alone. The detail screen renders notes as a full-width paragraph rather
  // than as a row (`detailNotes`), because a paragraph right-aligned into a trailing slot is
  // unreadable — so this follows it there: the label keeps its row, and the box drops to the
  // full width beneath it, in the slot §0.6 gives a field's second line.
  const stacked = multiline === true;

  // §0.6 gives the list to the FOCUSED row, and the same `focused` state the fill already
  // reads is what says which row that is — so a form with four autocompleting fields shows
  // one list, under the field the diver is actually in, rather than four stacked lists. An
  // empty array draws nothing at all rather than an empty container: a field holding its
  // carried value matches nothing but itself, which is most of a logging session.
  const offered = focused && suggestions !== undefined ? suggestions : [];

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
      //
      // **A cleared row shows neither**, for the same reason a filled one shows no
      // placeholder: the slot says one thing at a time. `kg — cleared` reads as two competing
      // claims about a row that is simply empty on purpose, and the tag is the one the diver
      // has not seen before. The hint comes back the moment they type, which is the moment it
      // is useful again.
      placeholder={showCleared ? undefined : (unit ?? placeholder)}
      placeholderTextColor={styles.formFieldLabel.color}
      accessibilityLabel={label}
    />
  );

  // The third state (§0.6, M1h), hoisted so it can reach BOTH shapes of row. It stands where
  // the value would be — a row the diver emptied on purpose has to read differently from one
  // carry-over never filled, which is the entire point of the state and the thing this form
  // knew and never showed.
  const clearedTag = showCleared ? (
    <Text style={styles.formFieldCleared} accessibilityLabel={CLEARED_ANNOUNCEMENT}>
      {CLEARED_TAG}
    </Text>
  ) : null;

  return (
    <View style={[styles.formField, focused && styles.formFieldFocused]}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        {!stacked ? (
          <View style={styles.formFieldValue}>
            {input}
            {/* The muted suffix (§0.6), drawn only while there is a figure for it to follow:
                an empty field is already showing this same word as its placeholder, and both
                at once would read as "m m". */}
            {unit !== undefined && value !== '' && <Text style={styles.formFieldUnit}>{unit}</Text>}
            {clearedTag}
          </View>
        ) : (
          // **A stacked row keeps the tag, and that is a correction rather than symmetry for
          // its own sake.** Its box drops to the full width below, so it has no trailing value
          // slot of its own — and a version of this that simply skipped the tag drew a carried
          // multiline row with a ring, no mark and no way to say it had been cleared. That was
          // unreachable only because §2.1 happens to mark `notes` fresh; the screen hands every
          // row the same `carryOver` prop, so "unreachable" there is one line of
          // `CARRIED_FIELDS` away from being wrong, and a row given part of the treatment must
          // not fail quietly.
          clearedTag !== null && <View style={styles.formFieldValue}>{clearedTag}</View>
        )}
        {/* §0.6's carried treatment, as one object at the row's trailing edge: the return mark
            and the 20 pt ring in its 48 dp box.
            
            **Together, on the owner's ruling** — the mark began at the leading edge of the
            value slot, where the sheet draws it, and on a device landed against the label
            rather than the value and at a different x on every row. `formFieldCarryState`
            (theme/styles.ts) carries the whole account.

            Only ever on a carried row: clearing is what a diver does to a value they did not
            enter, and a control offering to empty one they typed themselves would be offering
            to destroy their own work. Both halves go in the same gesture, so a cleared row has
            neither and shows the tag instead. */}
        {carried === true && (
          <View style={styles.formFieldCarryState}>
            <CarriedMark scheme={scheme} />
            <ClearFieldControl
              accessibilityLabel={`Clear carried ${label}`}
              onPress={() => onClear?.('')}
              scheme={scheme}
            />
          </View>
        )}
      </View>
      {stacked && input}
      {/* §2.3's autocomplete list, in the slot §0.6 fixes for it — "directly under the
          focused row", the same second line `OptionChips` fills with chips and `stacked`
          notes fills with its box. Inside this field's own View rather than beside it, so
          the focused row's `surface` fill runs behind the list and visually attaches it to
          the field it will fill.

          **A tap reaches it while the keyboard is up** because both ScrollViews that host a
          `FormField` set `keyboardShouldPersistTaps="handled"` — DiveFormScreen.tsx's form
          scroll and SettingsScreen.tsx's — so a touch on a child that handles it is
          delivered rather than being swallowed as a keyboard dismissal. Without that the
          input would blur first, `focused` would go false, and this list would unmount out
          from under the finger that was pressing it. It is a property of the hosts, not of
          this component, which is why it is named here rather than assumed. */}
      {offered.length > 0 && (
        <View style={styles.formSuggestions}>
          {offered.map((suggestion) => (
            <Pressable
              // The value, not an index: `suggestFrom` yields values that are distinct
              // case-insensitively, and a key by position would re-use a row's identity for a
              // different suggestion each keystroke.
              key={suggestion.value}
              style={styles.formSuggestion}
              // The whole suggestion, id and all — see `onPickSuggestion` for why the pair
              // must not be split, and why this is not `onChange`.
              onPress={() => onPickSuggestion?.(suggestion)}
              accessibilityRole="button"
              // Names the field as well as the value: the form has four autocompleting
              // fields, and "Blue Hole, button" on its own says nothing about where a pick
              // would land.
              accessibilityLabel={`Fill ${label} with ${suggestion.value}`}
            >
              <Text style={styles.formSuggestionText}>{suggestion.value}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
});

import { Pressable, Text, View, type ColorValue } from 'react-native';
import { type ReactNode } from 'react';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { CarriedMark, CLEARED_ANNOUNCEMENT, CLEARED_TAG } from './CarriedMark';
import { ClearFieldControl } from './ClearFieldControl';

/**
 * What a chip's value may be: a member of a closed vocabulary (`Entry`, `Suit`, …) or **a
 * level of an ordered numeric scale** (`waves`, `current`, `surge` — 0–3).
 *
 * The numbers arrived in M1h, when §0.6's icon sheet turned those three text fields into chip
 * rows, and the alternative was worse in a specific way worth recording. The obvious fix was
 * to leave this `string` and give the scales a digit-string vocabulary (`'0' | '1' | '2' |
 * '3'`), which costs nothing at the boundary — `optionalNumber` already coerces `'2'` to `2`,
 * and the form's own text fields have always held these values as strings. It fails one level
 * up: `domain/types.ts` **derives each type from its list**, so a digit-string list yields a
 * *string type standing for an integer column*, and the next person to read `WavesLevel` and
 * write `dive.waves === '2'` gets a comparison that is false for every dive ever stored.
 *
 * So the vocabulary stays honest about what it is and this component takes one more kind of
 * key. Nothing else in the body changes: `key`, `===` and the `''` sentinel are all
 * type-agnostic, and `displayLabel` was always the caller's to supply.
 *
 * The alternative to *that* was a second chip component for numeric scales, which §4.1 calls
 * a defect rather than a style preference — what makes a chip read as chosen is a rule, and a
 * second implementation of it is how two chip rows end up looking different.
 */
export interface OptionChipsProps<T extends string | number> {
  label: string;
  value: T | '' | null | undefined;
  options: readonly T[];
  displayLabel: (option: T) => string;
  /**
   * Called with the pressed option, or with `''` when the diver presses the option that is
   * already selected — "tapping the already-selected chip clears it back to `''`".
   *
   * A caller whose field has **no cleared state** ignores that `''` rather than this
   * component growing a mode to suppress it: the Settings screen's unit system is always
   * one of two values (`readUnitSystem` degrades an unreadable row to a default rather than
   * to nothing), so pressing the chosen chip there simply leaves the choice where it is.
   * The alternative — a `clearable` flag discriminating this signature — would put a second
   * behaviour inside the one component both screens share, to save each caller one line.
   */
  onChange: (value: T | '') => void;
  scheme: ColorScheme;
  /**
   * DESIGN.md §0.6: "**An icon appears only where the value has one.** ... the icon is
   * information, not decoration, and it **supplements the label rather than replacing it** —
   * never an icon alone."
   *
   * Optional, and omitted at every call site but one — only `entry` has values with
   * conventional symbols (`EntryIcon`, which owns that judgement and returns nothing for
   * `other`). A render prop rather than a `Record` this component looks values up in,
   * because the mapping is per FIELD, not per chip row: a table here would have to be keyed
   * by both field and value, which is a second hand-maintained list of exactly the shape
   * §4.1 warns about, one call site away from the file that already owns it.
   *
   * `tintColor` is handed OUT rather than taken in: which ink a chip's contents wear depends
   * on whether that chip is selected, and this component is the only thing that knows. A
   * call site choosing the colour itself would have to be told the selection state, and
   * would then own a rule ("the icon matches the label beside it") that belongs here.
   */
  icon?: (option: T, tintColor: ColorValue) => ReactNode;
  /**
   * DESIGN.md §0.6 as M1h's design sheet redrew it: this field's value came from the previous
   * dive, so the row shows the return mark and offers a way to throw it away.
   *
   * **One mark and one clear for the whole group, on the group's LABEL row — never on a
   * chip**, which is the sheet's own instruction and is forced anyway. A chip row has one
   * value spread across several controls; a mark on the selected chip would read as a fact
   * about that option rather than about the field, and a clear attached to a chip would be a
   * second thing that chip's own press already does.
   *
   * The mark sits in `formFieldValue` — the same trailing slot `FormField` puts it in, and
   * for the same reason: this is where a row says what it holds. That the chips themselves
   * live on the line below (§0.6: "a set of options to read through, not a value to read
   * off") does not move the state that describes them.
   */
  carried?: boolean;
  /**
   * The third state, exactly as `FormField.cleared` is and for the same reason: a chip row a
   * diver deliberately emptied must not read as one carry-over never filled. See that prop's
   * own docblock — the state, its owner, and why it is not `carried`'s opposite.
   *
   * **Note this component already had a way to clear itself** — "tapping the already-selected
   * chip clears it back to `''`" — and that gesture is emphatically NOT this one. It hands
   * `onChange('')` back, so the caller sees a diver *choosing*, which is what it is: a
   * deselection, indistinguishable from picking an option and picking it away again. The
   * clear control below is the gesture that says "this value was not mine", and only it
   * leaves the tag.
   */
  cleared?: boolean;
  /**
   * Fired when the diver presses the clear control. No value: unlike `FormField`'s, which
   * reports the `''` its `TextInput` now holds, there is nothing here for a caller to be told
   * — the field's value is `''` by definition after this, and passing it would invite a call
   * site to route this through `onChange` and lose the distinction the tag depends on.
   *
   * Omitted wherever `carried` is false; the control is drawn only for a carried row.
   */
  onClear?: () => void;
}

/**
 * A fixed-choice field, rendered as §0.6's filled chips: `surface` behind an unselected
 * chip, `action` ink behind the selected one — "the chosen thing is the inverted thing",
 * one rule across the app.
 *
 * **It lives in `components/` rather than inside `DiveFormScreen.tsx` because two screens
 * now ask the same question.** The form asks it of `entry`, `salinity`, `water_body`,
 * `suit` and cylinder `material`; Settings asks it of the unit system (§3), which is a
 * choice between exactly the members of `UNIT_SYSTEMS` and nothing else. §4.1: "A second
 * implementation is a defect, not a style preference" — and a second chip row would have
 * been one, since what makes a chip read as chosen is a rule, not a coincidence.
 *
 * On the form the restriction is load-bearing beyond looks. `diveFormSchema.ts`'s docblock
 * on `optionalPicked` is explicit that these values are "never something a diver could
 * type... rejecting one is catching a real bug upstream", and that guarantee only holds if
 * the UI actually restricts input to the fixed list: a free-text field would let a diver
 * mistype one, `zodResolver` would fail validation on that one field, and
 * react-hook-form's `handleSubmit` would refuse to call `onValid` for the WHOLE form —
 * exactly the "never block a save" (§1) failure that screen exists to avoid.
 */
export function OptionChips<T extends string | number>({ label, value, options, displayLabel, onChange, scheme, icon, carried, cleared, onClear }: OptionChipsProps<T>) {
  const styles = makeStyles(scheme);
  // The same guard `FormField` applies to its own tag, for the same reason and against the
  // same lie: `cleared` is a claim about a gesture, `— cleared` is a claim about what the row
  // holds, and a tag standing beside a chip the diver has since chosen would say the row is
  // empty while an inverted chip says otherwise. `''` is what this component's own
  // deselection reports and `null`/`undefined` is what a field nobody has touched holds, so
  // all three count as empty here.
  const empty = value === null || value === undefined || value === '';
  const showCleared = cleared === true && empty;
  return (
    // The same `formField` row as every other field (§0.6), with the chips in the slot §0.6
    // gives a field's second line rather than in the row's trailing value slot: five suit
    // options at Czech length cannot sit beside a label without wrapping into a column two
    // words wide. They are left-aligned there, deliberately and not by omission — see
    // `formChipRow` (theme/styles.ts), which records that trailing them was tried on the
    // simulator and left one orphan chip hanging under the last of a filled first line. (An
    // earlier version of this comment claimed `formChipRow` carried a `justifyContent:
    // 'flex-end'` that keeps them in the value column; it never did, and the style's own
    // comment one file over says the opposite.)
    <View style={styles.formField}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        {/* Absent entirely for a field that carried nothing, so every chip row on this form
            that §2.1 marks fresh renders exactly the tree it rendered before this existed —
            label row, chip row, nothing between them. */}
        {(carried === true || showCleared) && (
          <View style={styles.formFieldValue}>
            {carried === true && <CarriedMark scheme={scheme} />}
            {showCleared && (
              <Text style={styles.formFieldCleared} accessibilityLabel={CLEARED_ANNOUNCEMENT}>
                {CLEARED_TAG}
              </Text>
            )}
          </View>
        )}
        {carried === true && (
          <ClearFieldControl
            accessibilityLabel={`Clear carried ${label}`}
            onPress={() => onClear?.()}
            scheme={scheme}
          />
        )}
      </View>
      <View style={styles.formChipRow}>
        {options.map((option) => {
          const selected = value === option;
          // The ink the chip's own label is about to wear, read off the style rather than
          // from the theme directly — the same "take the colour from the style you are
          // matching" move `DateTimeField` makes for the native picker's `textColor`. It is
          // handed to `icon` so a symbol beside the label inverts with it (§0.6), instead of
          // staying `fg` on an `action` ground where it would vanish.
          const ink = (selected ? styles.formChipTextSelected.color : styles.formChipText.color) as ColorValue;
          return (
            <Pressable
              key={option}
              style={[styles.formChip, selected && styles.formChipSelected]}
              onPress={() => onChange(selected ? '' : option)}
              accessibilityRole="button"
              // Unchanged by the icon, deliberately: §0.6 makes the icon a supplement to the
              // label, so what a screen reader hears is exactly what it heard before — the
              // symbol adds nothing to say that the words do not already say.
              accessibilityLabel={`${label}: ${displayLabel(option)}`}
              accessibilityState={{ selected }}
            >
              {icon?.(option, ink)}
              <Text style={[styles.formChipText, selected && styles.formChipTextSelected]}>{displayLabel(option)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

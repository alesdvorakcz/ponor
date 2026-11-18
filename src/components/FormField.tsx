import { forwardRef, useCallback, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { type Suggestion } from '../domain/suggest';
import { t } from '../i18n';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { CarriedMark, clearedAnnouncement, clearedTag } from './CarriedMark';
import { ClearFieldControl } from './ClearFieldControl';
import { useKeepInView } from './FormReveal';

/**
 * A suggestion as the list draws it (2026-11-14, the design canvas): the suggestion itself, and
 * what the diver has done with it — `meta`, the muted line under the name ("4 dives · last
 * 18 kvě 2026"). The caller's words, already formatted: this component decides where they go,
 * never what they say. A pick hands back the whole object, details and all, so nothing a caller
 * pairs with it is lost.
 */
export interface OfferedSuggestion extends Suggestion {
  readonly meta?: string | null;
}

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
   *
   * `'email-address'` is M2e's, for the account screen's one address row: a keyboard with
   * `@` and `.` on it and no space bar to walk into the middle of an address. `'url'` is the
   * same for the *New dive centre* page's *Website* (issue #19): `/` and `.` on the keys.
   * `'numbers-and-punctuation'` is a site's *Altitude* (issue #31): digits with a minus sign on
   * iOS, which `'decimal-pad'` lacks, for a place below sea level.
   */
  keyboardType?:
    | 'default'
    | 'decimal-pad'
    | 'number-pad'
    | 'phone-pad'
    | 'email-address'
    | 'url'
    | 'numbers-and-punctuation';
  multiline?: boolean;
  /**
   * Masks what is typed — the account screen's password rows (signing in or up, and the new
   * password after a reset) and nothing else in this app (M2e). A password is the one value in
   * Ponor that is a secret, and the three rules that follow from that live where they can be
   * enforced (`cloud/auth.ts`): it is never logged, never wrapped into an error, and never
   * persisted anywhere but the auth call.
   *
   * **This component adds no rule of its own for it, deliberately.** A "clear the value on
   * blur" or "never hand it to `onChange`" here would break the field for its callers while
   * protecting nothing: the value has to live in the caller's state to be typed at all. Nor
   * does it add a rule about editing one (issue #29, owner's call): each platform's own secure
   * field already has one — iOS's empties on the first backspace after the diver comes back,
   * Android's takes a character per press — and the field hands on what it sends. What this
   * prop does is exactly what its name says.
   *
   * Never combined with `multiline` — React Native ignores masking on a multiline input, and
   * a password that renders in the clear because a second prop was set is precisely the kind
   * of silent failure §0.6's "shipped once and only found by using the app" collects.
   */
  secureTextEntry?: boolean;
  /**
   * Whether the keyboard capitalises for this field, and — with `autoCorrect` below — the
   * pair that stops a device "helping" with a value that is not prose.
   *
   * Set **explicitly at the two call sites that need `'none'`** rather than inferred from
   * `keyboardType` or from `secureTextEntry`, on `mono`'s own reasoning above: the two
   * questions look joined and are not. An address and a password must not be capitalised or
   * corrected; a name must still be capitalised — a buddy's or a guide's word by word (`'words'`),
   * a new site's or centre's on its own page by its first letter only (`'sentences'`, owner's call
   * on PR #35: most languages do not title-case a place, and the name joins a shared catalogue) —
   * and they reach this component through the same props.
   *
   * Omitted everywhere else, which leaves React Native's own defaults exactly as they were
   * before this prop existed.
   */
  autoCapitalize?: 'none' | 'sentences' | 'words';
  /** The other half of the pair above. An e-mail address run through autocorrect is a
   * different address, and the diver does not see it happen — and M3n found the same sentence
   * true of a **place name**: `Divoka Sarka` came back from iOS as `Divoká sarka`, an accent
   * added and a capital taken, on a word bound for a shared catalogue under the diver's name. */
  autoCorrect?: boolean;
  /**
   * Whether the platform draws its dictionary's opinion under the text (M3n).
   *
   * A third question rather than a restatement of `autoCorrect`, and they come apart in the
   * direction that matters: `autoCorrect={false}` stops the keyboard REWRITING a word, and
   * leaves the red squiggle underneath it. On a form of Czech place names that is a row of
   * misspelling marks under text that is spelled correctly.
   */
  spellCheck?: boolean;
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
  /** A muted word about where the value came from, on a stacked (multiline) row's label row —
   * the slot `OptionChips`' caption takes, and never beside the `— cleared` tag. A one-line row
   * keeps its value in that slot, so it has no room for one. */
  caption?: string;
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
   * DESIGN.md §2.3's autocomplete, for the fields that have it inline — the dive form's buddy and
   * guide — what `suggestFrom` (domain/suggest.ts) offered for this field's current text.
   * **Optional, and omitted at every other call site**: a field given neither this nor
   * `onPickSuggestion` renders exactly what it rendered before either existed, which is what
   * lets every other field on the dive form, both fields on Settings, and the place pages go on
   * passing neither.
   *
   * This component decides only WHERE the list goes and WHEN it is drawn; it has no opinion
   * on what belongs in it or in what order — the same split `carried` above draws, where the
   * caller knows WHY a value is carried and this knows how to show that it is. §0.6 makes the
   * position a fact about the row ("The list belongs directly under the focused row"), which
   * is why it is drawn here at all rather than by the screen: a list positioned by the caller
   * would be positioned once per field.
   */
  suggestions?: readonly OfferedSuggestion[];
  /**
   * The group header over the suggestions — "Your buddies · 3", the design canvas's cluster
   * label (2026-11-14). The caller's whole phrase, count included, for the reason `meta` is
   * the caller's: only it knows what kind of thing is being offered. Drawn only while there is
   * a suggestion under it.
   */
  suggestionsTitle?: string;
  /**
   * What the keyboard's return key says, and what pressing it does (2026-11-14, found on a
   * phone: the key closed the keyboard, so a diver walking down the form re-opened it on every
   * row). A caller that knows which field comes next passes `'next'` and moves focus in
   * `onSubmitEditing`; this component then keeps the keyboard up through the press
   * (`submitBehavior="submit"`) so it does not drop and rise again between two fields. A caller
   * that passes neither leaves the platform's own key exactly as it was.
   */
  returnKeyType?: 'next' | 'done' | 'go';
  onSubmitEditing?: () => void;
  /**
   * What the field holds, for the platform's AutoFill (2026-11-14, the account screen): iOS
   * offers a saved address, a saved password, or a strong new one only when the field says
   * which it is (`textContentType`), and Android reads the same answer from `autoComplete`.
   * Passed through where a caller says, and left to the platform everywhere else.
   *
   * **And the opposite answer** (#31): a field whose text is published to every diver — a
   * centre's phone, email and address — must not be offered the diver's own. Saying nothing is
   * not that: Android's Autofill picks fields by their input type, and iOS may guess from the
   * keyboard. So such a field says so outright — `textContentType="none"` (React Native hands
   * iOS an empty content type), `autoComplete="off"` and, Android only, `importantForAutofill="no"`
   * (both of which take the view out of Autofill). What the keyboard itself suggests is the
   * keyboard's, and the app cannot see it.
   */
  textContentType?: 'username' | 'emailAddress' | 'password' | 'newPassword' | 'URL' | 'none';
  autoComplete?: 'email' | 'current-password' | 'new-password' | 'off';
  importantForAutofill?: 'no';
  /**
   * `false` while the value is being saved somewhere — the *New dive site* page holds its fields
   * still from Save to the row existing (issue #19), so nothing typed meanwhile is silently left
   * out of what was written. It shuts the input, the one way this row edits its value (the
   * focused clear ring that was a second went with issue #29); omitted, the field is editable as
   * it always was.
   */
  editable?: boolean;
  /**
   * **One row of a card of rows** (issue #24) — the account screen holds its address and
   * password in one `surface` card, so this row draws no hairline over itself and no focus card
   * inside a card that is already the fill. Focus still shows, as the caret. Omitted everywhere
   * else, where a field is a row on the screen's own ground.
   */
  grouped?: boolean;
  /**
   * Fired with the **whole** `Suggestion` the diver tapped, never just its text — its id
   * included, so a caller that pairs a name with a record is never left holding a name and no
   * way to know which record it named (§10: *"otherwise a dive carries one site's id under
   * another's name"*).
   *
   * Deliberately NOT routed through `onChange`, exactly as `onClear` above is not: a caller
   * that has to tell "the diver typed this" from "the diver picked this" still can.
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
 * **Focus is what draws the affordance** (§0.6). While the input holds focus the row becomes a
 * `surface` card (the design canvas's, since 2026-11-14) and nothing else does, so the box
 * appears where it is wanted instead of five times over. The state is local, apart from the one
 * fact the form needs — which node to keep in view above the keyboard (`FormReveal.tsx`) — and
 * `onBlur` is still forwarded to whatever the caller passed — react-hook-form's own
 * `field.onBlur`, which is what marks a field touched — rather than being swallowed here.
 *
 * **The whole row is the field** (2026-11-14). A press anywhere on the card that no control
 * inside it takes — the label above all — focuses the input. The label used to be plain text,
 * which left the leading third of every row dead to a tap, wider still in Czech.
 *
 * `forwardRef`s its `TextInput` so a `Controller`'s `field.ref` can attach to the real
 * input for react-hook-form's own focus management, rather than being destructured and
 * discarded — the exact risk M1d task 1's probe checked for before this screen existed,
 * confirming `field.ref` forwarded straight through as a prop survives this repo's lint
 * and typecheck gates.
 */
export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, value, onChange, onBlur, scheme, keyboardType, multiline, secureTextEntry, autoCapitalize, autoCorrect, spellCheck, placeholder, mono, unit, caption, carried, cleared, onClear, suggestions, suggestionsTitle, onPickSuggestion, returnKeyType, onSubmitEditing, textContentType, autoComplete, importantForAutofill, editable, grouped },
  ref,
) {
  const styles = makeStyles(scheme);
  const [focused, setFocused] = useState(false);
  const keepInView = useKeepInView();

  // The input, held here as well as handed to the caller: the row focuses it when the diver
  // presses the label, and react-hook-form's `field.ref` still has to reach the same input for
  // its own focus management (`setFocus`, which the form's return key now walks through).
  const inputRef = useRef<TextInput | null>(null);
  const attachInput = useCallback(
    (node: TextInput | null) => {
      inputRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref !== null) ref.current = node;
    },
    [ref],
  );

  // The node the form keeps in view — the whole field, card AND list, since the list is what
  // has to fit above the keyboard.
  const fieldRef = useRef<View | null>(null);
  const hold = (holding: boolean) => {
    if (fieldRef.current !== null) keepInView(fieldRef.current, holding);
  };

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
  // reads is what says which row that is — so a form with several autocompleting fields shows
  // one list, under the field the diver is actually in, rather than a stack of them. An empty
  // array draws nothing at all rather than an empty container: a field holding its carried
  // value matches nothing but itself, which is most of a logging session.
  const offered = focused && suggestions !== undefined ? suggestions : [];

  const input = (
    <TextInput
      ref={attachInput}
      style={[styles.formFieldInput, mono === true && styles.formFieldInputMono, stacked && styles.formFieldInputMultiline]}
      value={value}
      onChangeText={onChange}
      onFocus={() => {
        setFocused(true);
        hold(true);
      }}
      // All three, in this order: the row stops being the focused one, the form stops keeping
      // it in view, and the caller still hears about the blur it asked for.
      onBlur={() => {
        setFocused(false);
        hold(false);
        onBlur?.();
      }}
      // Ink rather than the platform's blue (2026-11-14): see `formFieldCaret`. `cursorColor`
      // is Android's half of the same thing; iOS reads both from `selectionColor`.
      selectionColor={styles.formFieldCaret.color}
      cursorColor={styles.formFieldCaret.color}
      returnKeyType={returnKeyType}
      onSubmitEditing={onSubmitEditing}
      textContentType={textContentType}
      autoComplete={autoComplete}
      importantForAutofill={importantForAutofill}
      editable={editable}
      // Kept up through a press that moves focus to the next field, so the keyboard does not
      // drop and rise again between two rows. Only where a caller handles the press.
      submitBehavior={onSubmitEditing === undefined ? undefined : 'submit'}
      keyboardType={keyboardType ?? 'default'}
      multiline={multiline}
      // Passed straight through, and only where a caller asked: `undefined` leaves React
      // Native's own default in place, so every field written before these existed renders
      // exactly as it did.
      secureTextEntry={secureTextEntry}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      spellCheck={spellCheck}
      // `placeholder` is for the fields whose hint is not a unit — a conditions scale's `0-3`,
      // a rating's `1-5`. **A unit is never a placeholder any more** (2026-11-14): it is drawn
      // as the suffix below in every state, because a right-aligned empty input puts its caret
      // exactly where a right-aligned placeholder ends, and focusing an empty `min` row drew
      // the caret through the `n`.
      //
      // **A cleared row shows no hint at all**: the slot says one thing at a time, and
      // `kg — cleared` reads as two competing claims about a row that is simply empty on
      // purpose. The hint comes back the moment the diver types.
      placeholder={showCleared || unit !== undefined ? undefined : placeholder}
      placeholderTextColor={styles.formFieldLabel.color}
      accessibilityLabel={label}
    />
  );

  // The third state (§0.6, M1h), hoisted so it can reach BOTH shapes of row. It stands where
  // the value would be — a row the diver emptied on purpose has to read differently from one
  // carry-over never filled, which is the entire point of the state and the thing this form
  // knew and never showed.
  const clearedNode = showCleared ? (
    <Text style={styles.formFieldCleared} accessibilityLabel={clearedAnnouncement()}>
      {clearedTag()}
    </Text>
  ) : null;

  // **No clear control while the diver edits a value of their own** (issue #29, owner's call,
  // undoing 2026-11-14's). The canvas draws one inside the focused field; here it pushed the
  // right-aligned value 60 pt left on every focus and back on every blur, so Next moved two rows
  // at once. Reserving its place on every row and animating the slide were both prototyped and
  // both turned down. The form's values are short and holding backspace empties them; a
  // password is left to the platform's own secure field (`secureTextEntry`). The carried ring
  // is a different act — throwing away what carry-over filled in — and stays.

  return (
    <View
      ref={fieldRef}
      style={[styles.formField, focused && styles.formFieldFocused, grouped === true && styles.formFieldGrouped]}
      // While focused, every layout change — the list arriving, growing, shrinking — re-asks
      // the form to keep this field in view, so a list that grows under the keyboard is lifted
      // above it rather than left for the diver to find.
      onLayout={focused ? () => hold(true) : undefined}
    >
      {/* The card: the field itself. A `Pressable` so that a press nothing inside it takes —
          the label above all — focuses the input; `accessible={false}` so a screen reader
          still lands on the input alone, which announces itself by the label already. */}
      <Pressable
        style={[
          styles.formFieldCard,
          grouped === true ? styles.formFieldCardGrouped : focused && styles.formFieldCardFocused,
        ]}
        onPress={() => inputRef.current?.focus()}
        accessible={false}
      >
        <View style={styles.formFieldRow}>
          <Text style={styles.formFieldLabel}>{label}</Text>
          {!stacked ? (
            <View style={styles.formFieldValue}>
              {input}
              {/* The muted suffix (§0.6), in every state but cleared — see `placeholder` above
                  for why an empty figure's unit is a suffix rather than a placeholder now. */}
              {unit !== undefined && !showCleared && <Text style={styles.formFieldUnit}>{unit}</Text>}
              {clearedNode}
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
            (clearedNode !== null || caption !== undefined) && (
              <View style={styles.formFieldValue}>
                {clearedNode ?? <Text style={styles.formFieldCaption}>{caption}</Text>}
              </View>
            )
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
                accessibilityLabel={t('field.clearCarried', { label })}
                onPress={() => onClear?.('')}
                scheme={scheme}
              />
            </View>
          )}
        </View>
        {stacked && input}
      </Pressable>
      {/* §2.3's autocomplete list, in the slot §0.6 fixes for it — "directly under the
          focused row" — and since 2026-11-14 under the CARD rather than inside it, on the
          screen's own ground, as the design canvas draws it: the card is the field, and the
          rows beneath are what it offers. Still inside this field's own View, so the form
          keeps the card and its list in view as one thing.

          **A tap reaches it while the keyboard is up** because both ScrollViews that host a
          `FormField` set `keyboardShouldPersistTaps="handled"` — DiveFormScreen.tsx's form
          scroll and SettingsScreen.tsx's — so a touch on a child that handles it is
          delivered rather than being swallowed as a keyboard dismissal. Without that the
          input would blur first, `focused` would go false, and this list would unmount out
          from under the finger that was pressing it. It is a property of the hosts, not of
          this component, which is why it is named here rather than assumed. */}
      {offered.length > 0 && (
        <View style={styles.formSuggestions}>
          {/* "YOUR BUDDIES · 3" — over the diver's own history, and only while there is some: a
              header over nothing would name a group that is not there. */}
          {suggestionsTitle !== undefined && (
            <Text style={styles.formSuggestionsTitle}>{suggestionsTitle}</Text>
          )}
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
              // Names the field as well as the value: the form has two autocompleting fields
              // side by side, and "Petr, button" on its own says nothing about where a pick
              // would land.
              accessibilityLabel={t('field.fillWith', { label, value: suggestion.value })}
            >
              {/* The canvas's row: the name over what the diver has done with it. The second line
                  is drawn only when the caller has something to say — an empty `Text` would
                  still take its line. */}
              <View style={styles.formSuggestionBody}>
                <Text style={styles.formSuggestionText}>{suggestion.value}</Text>
                {suggestion.meta != null && suggestion.meta !== '' && (
                  <Text style={styles.formSuggestionMeta}>{suggestion.meta}</Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
});

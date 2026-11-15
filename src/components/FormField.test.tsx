import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { createRef } from 'react';
import { type TextInput, View } from 'react-native';

import { type Suggestion } from '../domain/suggest';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { FormField, isDeletion, type FieldMatch, type OfferedSuggestion } from './FormField';
import { FormRevealContext } from './FormReveal';

// Same RTL adaptation every test file in this codebase uses (DiveRow.test.tsx,
// DiveDetailScreen.test.tsx): `render` is async and its `root` is a test-renderer
// `TestInstance` exposing `queryAll(predicate)`, not `findAllByType`.
function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function inputsOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'TextInput') : [];
}

/** Every control this component declares to a screen reader — the same query
 * DiveFormScreen.test.tsx uses, kept local per this codebase's own no-shared-test-utils
 * convention (`src/testing/` is for guards, not for three-line queries). */
function buttonsOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : [];
}

/** The controls the list itself offers — `buttonsOf` minus a clear control (a carried row's
 * ring), which is the field's rather than one of its offers. */
function offersOf(t: RenderResult) {
  return buttonsOf(t).filter((n) => !String(n.props?.accessibilityLabel ?? '').startsWith('Clear '));
}

// The §0.4/§0.1 guard now lives in `src/testing/unexpectedGraphics.ts` — one owner, because
// five files carried the same copy and all five were wrong in the same way: the check read
// `!style.some(known.includes)`, so one known style excused every literal beside it and
// `[styles.x, { backgroundColor: '#f00' }]` — the only shape anyone writes — passed. See that
// module and its own test for what it enforces and why the scheme is now explicit here.

it('shows the label and the current value, and labels its input for typeInto helpers', async () => {
  const t = await render(<FormField label="Site" value="Blue Hole" onChange={() => {}} scheme="light" />);
  expect(textIn(t)).toContain('Site');
  const input = inputsOf(t)[0];
  expect(input?.props.value).toBe('Blue Hole');
  // Task 6's own `typeInto` helper (m1d-task-6-brief.md) finds a field by exact
  // `accessibilityLabel` match against the field's label — this is what makes that work.
  expect(input?.props.accessibilityLabel).toBe('Site');
});

it("calls onChange with what the diver typed, not a stale value it already held", async () => {
  const onChange = jest.fn();
  const t = await render(<FormField label="Buddy" value="" onChange={onChange} scheme="light" />);
  const input = inputsOf(t)[0];
  if (!input) throw new Error('no TextInput found');
  fireEvent.changeText(input, 'Jana');
  expect(onChange).toHaveBeenCalledWith('Jana');
});

// Testing one field's keyboardType in isolation would pass whether or not the prop is
// actually wired — RN's own TextInput default is 'default' either way. Rendering a
// numeric and a non-numeric field side by side, and checking them against each other, is
// what proves `keyboardType` is read from THIS field's own prop rather than always being
// the same value. A real `<View>` root (not a bare `<>...</>` Fragment) is required here:
// `render().root` is literally `container.children[0]`, so two top-level siblings behind
// a Fragment would leave `root.queryAll` searching only inside the first one.
it('gives each field the keyboard it asked for, decimal-pad and whole-number apart', async () => {
  const t = await render(
    <View>
      <FormField label="Max depth" value="" onChange={() => {}} scheme="light" keyboardType="decimal-pad" />
      <FormField label="Count" value="" onChange={() => {}} scheme="light" keyboardType="number-pad" />
      <FormField label="Site" value="" onChange={() => {}} scheme="light" />
    </View>,
  );
  const [numeric, whole, text] = inputsOf(t);
  expect(numeric?.props.keyboardType).toBe('decimal-pad');
  // A field that counts whole things must not be handed the keypad with a separator on it
  // — `decimal-pad` types a comma on a Czech device, and a fractional cylinder count is
  // *contradictory* in derived.ts: it voids the dive's whole gas figure.
  expect(whole?.props.keyboardType).toBe('number-pad');
  expect(text?.props.keyboardType).not.toBe('decimal-pad');
  expect(text?.props.keyboardType).not.toBe('number-pad');
});

// DESIGN.md §0.5: "Czech runs 20-30% longer than English. Labels wrap to two lines
// rather than truncate." A long, real fixture label (matching the one `styles.ts`'s own
// `tripTitle` comment cites) with neither `numberOfLines` nor `ellipsizeMode` set is what
// lets RN's own default wrapping behaviour take over; either prop present would defeat it.
it('lets a long label wrap instead of truncating it', async () => {
  const t = await render(<FormField label="Šenkýřův lom" value="" onChange={() => {}} scheme="light" />);
  const label = textNodesOf(t).find((n) => String(n.children[0] ?? '') === 'Šenkýřův lom');
  expect(label?.props.numberOfLines).toBeUndefined();
  expect(label?.props.ellipsizeMode).toBeUndefined();
});

it('draws nothing outside its own label-and-input treatment (§0.4/§0.1)', async () => {
  const t = await render(<FormField label="Notes" value="" onChange={() => {}} scheme="light" multiline />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
});

// Beyond the brief's own sample: the check above never renders a chip (`multiline`, no
// `carried`), so it cannot see whether the chip's own Views stay inside `makeStyles`
// (Task 5 brief's own explicit constraint) or reach for an inline style instead.
it('draws nothing outside its own treatment when a chip is showing either (§0.4/§0.1)', async () => {
  const t = await render(
    <FormField label="Weights" value="6" carried onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
});

// --- §0.6, M1h: three states, and they must read as three ---
//
// The rule this section defends is a distinction, not a feature, so every test here renders
// more than one state at a time. A carried row and an untouched one, or a cleared row and an
// untouched one, are each half the claim — and half is satisfiable by an implementation that
// has lost the whole point: a component that marked everything passes "carried shows a mark",
// and one that marked nothing passes "a fresh field shows none".
//
// The `<View>` root rather than a bare `<>...</>` Fragment is this file's own established
// gotcha (see the keyboardType test above): `render().root` is literally
// `container.children[0]`, so two top-level siblings behind a Fragment leave `root.queryAll`
// searching only inside the first one — and a test written that way would report the right
// number and be checking one field of the two.

/** That same test-renderer instance type, named so a helper can take one — `RenderResult['root']`
 * is nullable and every query here guards it before handing it on. */
type TestNode = NonNullable<RenderResult['root']>;

/** Every drawn mark under one node, of either kind this component uses — the return mark and
 * the clear control's ring. Matched on the host node a real `SymbolView` renders down to, the
 * same `SymbolModule` match `EntryIcon.test.tsx` and `SearchCapsule.test.tsx` use, so a drawn
 * approximation or a typed glyph standing in for either would not answer to it.
 *
 * Takes a NODE rather than the whole render, because the placement test below asks which
 * container each mark is in and a whole-tree count cannot tell a mark in the value slot from
 * one in the trailing state slot — which is the entire subject of the owner's ruling. */
function marksIn(node: TestNode | RenderResult | undefined) {
  const root = node === undefined ? undefined : 'root' in node ? (node.root ?? undefined) : node;
  return root ? root.queryAll((n) => typeof n.type === 'string' && n.type.includes('SymbolModule')) : [];
}

it('reads three different ways for never-carried, carried and cleared', async () => {
  const t = await render(
    <View>
      <FormField label="Site" value="Blue Hole" carried onChange={() => {}} onClear={() => {}} scheme="light" />
      <FormField label="Centre" value="" cleared onChange={() => {}} onClear={() => {}} scheme="light" />
      <FormField label="Buddy" value="" onChange={() => {}} scheme="light" />
    </View>,
  );

  // Carried: the mark, the value, and something to clear it with.
  expect(findClearCarried(t, 'Site')).toBeDefined();
  // Cleared: the tag, and nothing left to clear — the value is already gone.
  expect(textIn(t)).toContain('— cleared');
  expect(findClearCarried(t, 'Centre')).toBeUndefined();
  // Never carried: neither. The row says nothing about where its (absent) value came from,
  // because nothing came from anywhere.
  expect(findClearCarried(t, 'Buddy')).toBeUndefined();

  // ...and the tag appears exactly once, over the one row that was cleared. Without this the
  // assertion above would pass for a component that drew it on every empty row, which is the
  // very state — cleared and never-carried looking alike — this whole treatment exists to end.
  expect(textIn(t).filter((s) => s === '— cleared')).toHaveLength(1);
});

// The marks, counted rather than described. Three rows, and exactly three symbols between
// them: the carried row's return mark and its clear ring, and nothing at all on the other two
// — so a mark leaking onto a cleared or an untouched row fails here rather than being noticed
// on a device.
it('draws the return mark and the ring on the carried row alone', async () => {
  const carried = await render(
    <FormField label="Site" value="Blue Hole" carried onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  expect(marksIn(carried)).toHaveLength(2);

  const cleared = await render(
    <FormField label="Site" value="" cleared onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  expect(marksIn(cleared)).toHaveLength(0);

  const plain = await render(<FormField label="Site" value="Blue Hole" onChange={() => {}} scheme="light" />);
  expect(marksIn(plain)).toHaveLength(0);
});

// §0.6 as the owner ruled it after the first build: **the mark and the ring are one object at
// the row's trailing edge**, not a mark leading the value and a control at the far end.
//
// Read off the tree's structure rather than off a style, because that is what the ruling is
// about: the sheet's own placement (mark first inside the value slot) was legal, drawn, muted
// and tested — and on a device put the mark against the LABEL at a different x on every row.
// What this pins is the arrangement that fixed it: both halves inside one container, the mark
// first, and that container after the value rather than inside it.
it('draws the mark and the ring as one object after the value, mark first', async () => {
  const t = await render(
    <FormField label="Site" value="Blue Hole" carried onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  const styles = makeStyles('light');

  const slot = t.root?.queryAll((n) => stylesOn(n).includes(styles.formFieldValue))[0];
  if (!slot) throw new Error('no value slot found');
  // Nothing drawn in the value slot but the value itself — the mark used to live here.
  expect(marksIn(slot)).toHaveLength(0);

  const state = t.root?.queryAll((n) => stylesOn(n).includes(styles.formFieldCarryState))[0];
  if (!state) throw new Error('no carry-state slot found');
  // Both halves in it, and the mark first: the ring is the half a diver acts on, so it takes
  // the trailing position where every other control on this form sits.
  expect(marksIn(state)).toHaveLength(2);
  expect(state.queryAll((n) => n.props?.accessibilityRole === 'button')).toHaveLength(1);
  expect(marksIn(state)[0]?.props.name).toBe('return');
  expect(marksIn(state)[1]?.props.name).toBe('xmark.circle');

  // ...and it comes after the value in the row, which is what makes it trailing rather than
  // merely grouped. Compared as tree order inside the row both share.
  const row = t.root?.queryAll((n) => stylesOn(n).includes(styles.formFieldRow))[0];
  if (!row) throw new Error('no field row found');
  const order = row.queryAll(
    (n) => stylesOn(n).includes(styles.formFieldValue) || stylesOn(n).includes(styles.formFieldCarryState),
  );
  expect(stylesOn(order[0]).includes(styles.formFieldValue)).toBe(true);
  expect(stylesOn(order[1]).includes(styles.formFieldCarryState)).toBe(true);
});

// **A stacked row keeps the treatment too**, which is the half that used to fall through the
// `!stacked` guard: the mark and the ring were outside it and the tag inside, so a carried
// multiline row drew a ring with no mark and no way to say it had been cleared.
//
// Unreachable through the screen today — §2.1 marks `notes`, its only multiline field, fresh —
// but the screen hands every row the same `carryOver` prop, so that is one line of
// `CARRIED_FIELDS` away from being wrong, and §5.3's whole argument for bundling those props
// is that a row given part of the treatment fails loudly. This is the component asked
// directly, which is where the question can actually be put.
it('gives a stacked row the whole treatment, not the half that fits', async () => {
  const carried = await render(
    <FormField label="Notes" value="Vis dropped after 20 m" multiline carried onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  expect(findClearCarried(carried, 'Notes')).toBeDefined();
  expect(marksIn(carried)).toHaveLength(2);

  const cleared = await render(
    <FormField label="Notes" value="" multiline cleared onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  expect(textIn(cleared)).toContain('— cleared');
});

// The tag is a claim about what the row HOLDS, and the row is the only thing that can check
// it. A caller that left `cleared` set while a value arrived — a stale flag, a reseed, a bug
// one file away — would otherwise have this component announce an empty field over a figure
// that is about to be saved.
it('never says cleared over a value the field actually holds', async () => {
  const t = await render(
    <FormField label="Weights" value="6" cleared onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  expect(textIn(t)).not.toContain('— cleared');
  expect(inputsOf(t)[0]?.props.value).toBe('6');
});

// The two words the row says are one word to a screen reader: the em dash is typography, and
// "dash cleared" is what a reader makes of it unaided.
it('announces the tag as a word, not as punctuation', async () => {
  const t = await render(
    <FormField label="Weights" value="" cleared onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  const tag = textNodesOf(t).find((n) => String(n.children[0] ?? '') === '— cleared');
  expect(tag?.props?.accessibilityLabel).toBe('cleared');
});

// §0.6 gives the empty row's slot to the unit ("so the row still says what belongs in it") and
// M1h gives it to the tag when the diver emptied the field on purpose. One slot, one thing in
// it: `kg — cleared` is two competing claims about a row that is simply empty, and the hint
// comes back the moment the diver types, which is the moment it is useful again.
it('drops the unit hint while the row is saying it was cleared, and not otherwise', async () => {
  const cleared = await render(
    <FormField label="Weights" value="" cleared onChange={() => {}} onClear={() => {}} scheme="light" mono unit="kg" />,
  );
  expect(inputsOf(cleared)[0]?.props.placeholder).toBeUndefined();
  expect(textIn(cleared)).toContain('— cleared');

  expect(textIn(cleared)).not.toContain('kg');

  const empty = await render(<FormField label="Weights" value="" onChange={() => {}} scheme="light" mono unit="kg" />);
  expect(textIn(empty)).toContain('kg');
});

// --- §0.6's design pass: a field is a row, its figures are mono, and focus draws the box ---

/** Every style entry one node actually wears, flattened the way RN composes them. */
function stylesOn(node: { props?: { style?: unknown } } | undefined): unknown[] {
  return [node?.props?.style].flat(5).filter(Boolean);
}

// DESIGN.md §0.6: "**Figures in mono, names in sans.** A depth, duration, pressure or
// temperature is a data figure and takes Plex Mono 15 with tabular figures (§0.2); a site,
// centre or buddy is a name and stays Archivo."
//
// Two fields side by side, checked against each other, for the reason the keyboardType test
// above already gives: one field alone would pass whether or not the prop is read at all,
// since one of the two faces is the default either way. The mono face is compared against
// the sheet's own `formFieldInputMono` rather than a font name spelled out here — this test
// is about which treatment a field is given, not about what that treatment is.
it('sets a figure in mono and a name in sans, from the field\'s own prop', async () => {
  const t = await render(
    <View>
      <FormField label="Max depth" value="18.4" onChange={() => {}} scheme="light" mono />
      <FormField label="Site" value="Silfra" onChange={() => {}} scheme="light" />
    </View>,
  );
  const styles = makeStyles('light');
  const [figure, name] = inputsOf(t);
  expect(stylesOn(figure)).toContain(styles.formFieldInputMono);
  expect(stylesOn(name)).not.toContain(styles.formFieldInputMono);
  // Both are still the one shared input treatment underneath, so the mono style is an
  // override on top rather than a second, independently-drifting definition.
  expect(stylesOn(figure)).toContain(styles.formFieldInput);
  expect(stylesOn(name)).toContain(styles.formFieldInput);
  // Tabular figures are half of what §0.2 asks for and are easy to lose while keeping the
  // family, so they are pinned rather than assumed.
  expect(styles.formFieldInputMono.fontVariant).toContain('tabular-nums');
});

// §0.6: the unit "follows the figure as a muted suffix, exactly as `12.2 m` reads on the
// detail, and an empty numeric field shows that unit as its placeholder so the row still
// says what belongs in it."
//
// Both halves in one test, because the rule is that they are the SAME word in the SAME slot:
// a component that drew both at once would read as "m m", and one that drew neither would
// leave the row saying nothing about what belongs in it.
//
// **The unit is a suffix in both states now** (2026-11-14, found on a phone). It used to be the
// empty field's placeholder, and a right-aligned empty input draws its caret at the trailing
// edge — exactly where a right-aligned placeholder ends — so focusing an empty `min` row put
// the caret through the `n`. A sibling `Text` keeps the caret before the unit in every state,
// and the row still says what belongs in it.
it('shows the unit as a suffix whether or not there is a figure yet, and never as a placeholder', async () => {
  const filled = await render(<FormField label="Max depth" value="18.4" onChange={() => {}} scheme="light" mono unit="m" />);
  // A real `Text` node reading exactly the unit, beside the value — never concatenated into
  // the value itself, which has to stay exactly what the diver typed.
  expect(textIn(filled)).toContain('m');
  expect(inputsOf(filled)[0]?.props.value).toBe('18.4');

  const empty = await render(<FormField label="Max depth" value="" onChange={() => {}} scheme="light" mono unit="m" />);
  expect(textIn(empty)).toContain('m');
  // ...and NOT also as a placeholder: the same word in the same slot twice would read "m m".
  expect(inputsOf(empty)[0]?.props.placeholder).toBeUndefined();
});

// A field whose hint is not a unit — a conditions scale's `0-3`, a rating's `1-5` — keeps it
// as a placeholder and never grows a suffix. "3 0-3" is the reading this separation exists to
// prevent, and a single prop could not tell the two cases apart.
it('never turns a plain hint into a suffix beside the value', async () => {
  const t = await render(<FormField label="Waves" value="2" onChange={() => {}} scheme="light" mono placeholder="0-3" />);
  expect(textIn(t)).not.toContain('0-3');
  expect(inputsOf(t)[0]?.props.placeholder).toBe('0-3');
});

// §0.6: "**Focus is what draws the affordance.**" Since the 2026-11-14 design pass the
// affordance is the design canvas's card — `surface`, rounded, inset from the screen edge —
// rather than a full-bleed band, and the rule above the focused row goes, because a filled
// card with a hairline on its top edge reads as a seam (the canvas's own note 2). Driven
// through the input's real `onFocus`/`onBlur`, so a card wired to a state it could never reach
// fails here rather than passing.
it('draws the focused field as a card and drops the rule above it, and draws nothing at rest', async () => {
  const t = await render(<FormField label="Site" value="" onChange={() => {}} scheme="light" />);
  const styles = makeStyles('light');
  // `t.root` for the field itself: `queryAll` walks descendants only and never returns the
  // instance it is called on.
  const field = () => stylesOn(t.root ?? undefined);
  const wearing = (style: unknown) => (t.root ? t.root.queryAll((n) => stylesOn(n).includes(style)) : []);
  const input = inputsOf(t)[0];
  if (!input) throw new Error('no TextInput found');

  expect(field()).toContain(styles.formField);
  expect(field()).not.toContain(styles.formFieldFocused);
  expect(wearing(styles.formFieldCardFocused)).toHaveLength(0);
  await fireEvent(input, 'focus');
  expect(field()).toContain(styles.formFieldFocused);
  expect(wearing(styles.formFieldCardFocused)).toHaveLength(1);
  await fireEvent(input, 'blur');
  expect(field()).not.toContain(styles.formFieldFocused);
  expect(wearing(styles.formFieldCardFocused)).toHaveLength(0);

  // The card's GEOMETRY is worn at rest too, so focusing changes the fill and nothing else —
  // a field that grew or shifted on focus would move the row out from under the finger.
  expect(wearing(styles.formFieldCard)).toHaveLength(1);
  expect(styles.formFieldCardFocused).toEqual({ backgroundColor: themeFor('light').surface });
});

// The blur that draws the fill must not swallow the blur the CALLER asked for:
// `field.onBlur` is what marks a field touched in react-hook-form, and a component that
// handled its own focus state by replacing the prop rather than calling it would break that
// silently — nothing on screen would change.
it('still reports the blur its caller asked for, now that it also tracks focus itself', async () => {
  const onBlur = jest.fn();
  const t = await render(<FormField label="Site" value="" onChange={() => {}} onBlur={onBlur} scheme="light" />);
  const input = inputsOf(t)[0];
  if (!input) throw new Error('no TextInput found');
  await fireEvent(input, 'focus');
  await fireEvent(input, 'blur');
  expect(onBlur).toHaveBeenCalledTimes(1);
});

/**
 * The clear control for one field, by the whole label `FormField` gives it.
 *
 * Matched exactly and per field rather than by substring, because every test above renders
 * more than one row: a substring match would find the first control in the tree and report it
 * as belonging to whichever field the test happened to ask about, which is how "carried shows
 * a clear and fresh does not" passes against a component that draws one for both.
 */
function findClearCarried(t: RenderResult, label: string) {
  return t.root
    ? t.root
        .queryAll((n) => n.props?.accessibilityRole === 'button')
        .find((n) => String(n.props?.accessibilityLabel ?? '') === `Clear carried ${label}`)
    : undefined;
}

// DESIGN.md §0.5: "Tap targets never below 48 dp" — met, since M1h, as a real box rather than
// by stretching a compact chip with `hitSlop`. Both halves are the assertion.
//
// The second half is what the redesign is FOR. The slop used to be
// `{ top: 14, bottom: 14, left: 21, right: 0 }`, reaching the floor by extending 21 dp INWARD
// over the chip's own label — so tapping the word "carried" cleared the field, which is
// precisely what the owner asked a visible control to prevent. An invisible target is free to
// point anywhere; a box is not, and the box is now all there is.
//
// There is no Yoga in this environment (react-test-renderer never lays anything out), so the
// geometry is read off the styles the component composes, exactly as ReorderControls.test.tsx
// reads its arrows'.
it('gives the clear control a 48 dp box and no invisible target beyond it', async () => {
  const t = await render(
    <FormField label="Weights" value="6" carried onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  const clear = findClearCarried(t, 'Weights');
  if (!clear) throw new Error('no clear control found');
  const styles = makeStyles('light');

  expect(stylesOn(clear)).toContain(styles.clearFieldControl);
  expect(styles.clearFieldControl.minWidth).toBeGreaterThanOrEqual(48);
  expect(styles.clearFieldControl.minHeight).toBeGreaterThanOrEqual(48);
  // Nothing beyond it: no slop, so no direction, so nothing that can reach back over the
  // value the diver is about to type into.
  expect(clear.props.hitSlop).toBeUndefined();
});

it('clears when the ring is pressed, and not when the mark beside it is', async () => {
  // The behaviour the geometry above exists for, stated directly — and the half that survives
  // the chip is the one the owner cared about: exactly one thing on this row clears the field,
  // and it is the thing that looks like a control. The word "carried" was the failed version
  // of that ("a label you are expected to guess is tappable is not an affordance"); the return
  // mark is its replacement, and it must not have inherited the same mistake.
  const onClear = jest.fn();
  const t = await render(
    <FormField label="Weights" value="6" carried onChange={() => {}} onClear={onClear} scheme="light" />,
  );

  // Exactly one control on this row, so the mark is not a second, silent one.
  expect(buttonsOf(t)).toHaveLength(1);

  const clear = findClearCarried(t, 'Weights');
  if (!clear) throw new Error('no clear control found');
  await fireEvent.press(clear);
  expect(onClear).toHaveBeenCalledWith('');
});

it('clears to an empty string, never a zero', async () => {
  const onClear = jest.fn();
  const t = await render(
    <FormField label="Weights" value="6" carried onChange={() => {}} onClear={onClear} scheme="light" />,
  );
  // `t.root` types as possibly-null in the installed RTL version (same guard
  // DiveFormScreen.test.tsx's own `findButton`/`buttonsOf` already carry), and a `.find`
  // result is possibly-undefined either way — both need a real guard to satisfy
  // `tsc --noEmit`, not the brief sample's unguarded `t.root.queryAll(...)`.
  const clear = t.root
    ? t.root
        .queryAll((n) => n.props?.accessibilityRole === 'button')
        .find((n) => String(n.props?.accessibilityLabel ?? '').toLowerCase().includes('clear'))
    : undefined;
  if (!clear) throw new Error('no clear control found');
  fireEvent.press(clear);
  expect(onClear).toHaveBeenCalled();
  // The brief's own assertion, kept as written: the reported value must not be a bare
  // zero — the schema turns '' into null; a 0 would reach the domain as contradictory
  // data (DESIGN.md §10) and void the dive's whole gas figure.
  expect(onClear.mock.calls[0]?.[0] ?? '').not.toBe(0);
  // Hardened beyond that: the line above would pass just as well if onClear were called
  // with NO argument at all (`undefined ?? '' ` is not `0` either), which would prove
  // nothing about what value is actually reported. This pins the exact value down.
  expect(onClear).toHaveBeenCalledWith('');
});

// --- §2.3's autocomplete list, in the slot §0.6 fixes for it ---
//
// "Autocomplete's position is fixed here; its styling is not. The list belongs directly under
// the focused row." Both halves of that are what these check: WHERE the list is and WHEN it
// is drawn are this component's, and what it looks like is deliberately the least this can
// get away with until M2 reworks site search around the shared catalogue.

/** Two offers, one of each shape a `Suggestion` comes in — a site with a paired id (§6's
 * snapshot pair) and one without. The id half is what proves the whole object reaches the
 * caller rather than just the text. */
const OFFERS: Suggestion[] = [
  { value: 'Blue Hole', id: 'site-blue' },
  { value: 'Silfra', id: null },
];

/** One suggestion row, by the label this component gives it. Queried by
 * `accessibilityRole="button"` first, so a row of plain untappable text would fail here
 * rather than be found by its words alone. */
function findSuggestion(t: RenderResult, label: string) {
  return t.root
    ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button').find((n) => String(n.props?.accessibilityLabel ?? '') === label)
    : undefined;
}

async function focusInput(t: RenderResult) {
  const input = inputsOf(t)[0];
  if (!input) throw new Error('no TextInput found');
  await fireEvent(input, 'focus');
  return input;
}

// §0.6 gives the list to the FOCUSED row, so a form with four autocompleting fields shows one
// list rather than four. Driven through the input's real focus/blur, exactly as the fill test
// above is, so a list wired to a condition it could never satisfy fails here.
it('draws the suggestion list only while its own row holds focus', async () => {
  const t = await render(
    <FormField label="Site" value="" onChange={() => {}} scheme="light" suggestions={OFFERS} onPickSuggestion={() => {}} />,
  );
  expect(textIn(t)).not.toContain('Blue Hole');

  const input = await focusInput(t);
  expect(textIn(t)).toContain('Blue Hole');
  expect(textIn(t)).toContain('Silfra');

  await fireEvent(input, 'blur');
  expect(textIn(t)).not.toContain('Blue Hole');
});

// An empty array is "nothing to offer", not "offer nothing visibly": no rows, and no empty
// container left behind under the row either — which is the state most of a session is in,
// since a field holding its carried value matches nothing but itself.
it('draws nothing at all when there is nothing to suggest', async () => {
  const t = await render(
    <FormField label="Site" value="Blue Hole" onChange={() => {}} scheme="light" suggestions={[]} onPickSuggestion={() => {}} />,
  );
  await focusInput(t);
  const styles = makeStyles('light');
  const containers = t.root ? t.root.queryAll((n) => stylesOn(n).includes(styles.formSuggestions)) : [];
  expect(containers).toHaveLength(0);
  expect(offersOf(t)).toHaveLength(0);
});

// The whole `Suggestion`, not its text: the id is half of §6's snapshot pair, and a component
// that handed back `suggestion.value` alone would leave the screen with a name and no way to
// know which site record it named. Both rows are pressed, because a handler wired to
// `suggestions[0]` would pass an assertion about the first one.
it('hands the caller the whole suggestion it pressed, id and all', async () => {
  const onPick = jest.fn();
  const t = await render(
    <FormField label="Site" value="" onChange={() => {}} scheme="light" suggestions={OFFERS} onPickSuggestion={onPick} />,
  );
  await focusInput(t);

  const silfra = findSuggestion(t, 'Fill Site with Silfra');
  if (!silfra) throw new Error('no Silfra suggestion found');
  await fireEvent.press(silfra);
  expect(onPick).toHaveBeenLastCalledWith({ value: 'Silfra', id: null });

  const blueHole = findSuggestion(t, 'Fill Site with Blue Hole');
  if (!blueHole) throw new Error('no Blue Hole suggestion found');
  await fireEvent.press(blueHole);
  expect(onPick).toHaveBeenLastCalledWith({ value: 'Blue Hole', id: 'site-blue' });
});

// Picking is NOT typing, and the difference is load-bearing one layer up: DiveFormScreen's
// `onChange` clears the paired `siteId` (a typed name no longer refers to the carried id), so
// a component that delivered a pick through `onChange` as well would set the id and clear it
// again in the same gesture — a defect no assertion about the field's text could see.
it('never routes a pick through the typing path', async () => {
  const onChange = jest.fn();
  const t = await render(
    <FormField label="Site" value="" onChange={onChange} scheme="light" suggestions={OFFERS} onPickSuggestion={() => {}} />,
  );
  await focusInput(t);
  const blueHole = findSuggestion(t, 'Fill Site with Blue Hole');
  if (!blueHole) throw new Error('no Blue Hole suggestion found');
  await fireEvent.press(blueHole);
  expect(onChange).not.toHaveBeenCalled();
});

// The label names the FIELD as well as the value, so a screen reader hears which field a
// suggestion fills — "Blue Hole, button" on its own says nothing about where it would land,
// and the form has four autocompleting fields.
it('names both the field and the value, so a screen reader hears where a pick lands', async () => {
  const t = await render(
    <FormField label="Buddy" value="" onChange={() => {}} scheme="light" suggestions={[{ value: 'Petr', id: null }]} onPickSuggestion={() => {}} />,
  );
  await focusInput(t);
  // `findSuggestion` filters on the button role and matches the whole label, so finding the
  // row is already the assertion that it announces both halves.
  expect(findSuggestion(t, 'Fill Buddy with Petr')).toBeDefined();
  // What that query does NOT settle, and what the second half of "so a screen reader hears
  // where a pick lands" is for: the field name belongs in the ANNOUNCEMENT and not on screen.
  // The row draws the value alone — a visible "Fill Buddy with Petr" would be a sentence in a
  // column of names, and repeating the label under its own row is noise a diver reads past.
  expect(textIn(t)).toEqual(['Buddy', 'Petr']);
});

// DESIGN.md §0.5: "Tap targets never below 48 dp" — a suggestion row is a control like every
// other, and it is one a diver taps with wet hands on a rocking boat. Read off the style the
// row composes, exactly as the clear control's geometry above is: there is no Yoga here.
it('gives a suggestion row §0.5\'s 48 dp floor', async () => {
  const t = await render(
    <FormField label="Site" value="" onChange={() => {}} scheme="light" suggestions={OFFERS} onPickSuggestion={() => {}} />,
  );
  await focusInput(t);
  const styles = makeStyles('light');
  const row = findSuggestion(t, 'Fill Site with Silfra');
  expect(stylesOn(row)).toContain(styles.formSuggestion);
  expect(styles.formSuggestion.minHeight).toBe(48);
});

// §0.6 froze the list's styling until M2, which means it borrows treatments this sheet
// already has rather than inventing any — so the same §0.4/§0.1 guard the rest of this file
// runs must hold with a list on screen. Nothing here may reach for an inline style.
it('draws nothing outside its own treatment with a list showing either (§0.4/§0.1)', async () => {
  const t = await render(
    <FormField label="Site" value="" onChange={() => {}} scheme="light" suggestions={OFFERS} onPickSuggestion={() => {}} />,
  );
  await focusInput(t);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
});

// The two props are opt-in, and every other field on the form — plus every field on Settings,
// plus the cylinder-preset work landing beside this — passes neither. A focused field with no
// suggestions must render exactly what it rendered before they existed.
it('is unchanged by the new props when a caller passes neither', async () => {
  const bare = await render(<FormField label="Size" value="12" onChange={() => {}} scheme="light" mono unit="l" />);
  const bareAtRest = JSON.stringify(bare.toJSON());
  await focusInput(bare);
  const bareFocused = JSON.stringify(bare.toJSON());

  // Focusing draws the card and nothing else: no list, no control, no extra text (the clear
  // control a value being edited had from 2026-11-14 went with issue #29).
  expect(buttonsOf(bare)).toHaveLength(0);
  expect(textIn(bare)).toEqual(['Size', 'l']);

  // ...and the same field GIVEN both props, with nothing to offer, renders the identical
  // tree in both states — so a call site that passes them and one that does not cannot
  // diverge, and no empty container is left behind when the list is empty. Whole-tree
  // equality rather than a query, because "renders exactly as before" is a claim about
  // everything, including the props a query would not think to ask about.
  const offered = await render(
    <FormField label="Size" value="12" onChange={() => {}} scheme="light" mono unit="l" suggestions={[]} onPickSuggestion={() => {}} />,
  );
  expect(JSON.stringify(offered.toJSON())).toBe(bareAtRest);
  await focusInput(offered);
  expect(JSON.stringify(offered.toJSON())).toBe(bareFocused);
});

// ---------------------------------------------------------------------------------------
// §2.3's create offer, in the list's own slot (M2o)
// ---------------------------------------------------------------------------------------

const ADD_SITE = 'Add “Kotelna” as a new site';

/** One offer, with a press this file can watch. `busy` is stated at every call site rather
 * than defaulted, because it is the difference between a control and a control that has gone
 * quiet, and a test that forgot it would be asserting about neither. */
const addition = (onPress: () => void, busy = false) => ({ label: ADD_SITE, onPress, busy });

// The same `focused` gate the list is under, and driven through the input's real focus/blur
// for the same reason: an offer wired to a condition it could never satisfy fails here.
it('draws the create offer only while its own row holds focus', async () => {
  const t = await render(
    <FormField label="Site" value="Kotelna" onChange={() => {}} scheme="light" addition={addition(() => {})} />,
  );
  expect(textIn(t)).not.toContain(ADD_SITE);

  const input = await focusInput(t);
  expect(textIn(t)).toContain(ADD_SITE);

  await fireEvent(input, 'blur');
  expect(textIn(t)).not.toContain(ADD_SITE);
});

// **The common case, and the one an "offer it under the suggestions" implementation misses**:
// a brand-new site matches nothing in the diver's history, so the list is empty and the offer
// is the only row there is. Without this the affordance would appear exactly when it was not
// needed and vanish when it was.
it('draws the offer with no suggestions above it at all', async () => {
  const t = await render(
    <FormField label="Site" value="Kotelna" onChange={() => {}} scheme="light" suggestions={[]} onPickSuggestion={() => {}} addition={addition(() => {})} />,
  );
  await focusInput(t);
  expect(findSuggestion(t, ADD_SITE)).toBeDefined();
});

// Last, after the offers: they are what the diver most likely meant, and publishing a new
// record is what is left when none of them was. Read off the drawn order rather than off a
// prop, because the order is the whole claim.
it('offers what the diver has already used first, and the new record last', async () => {
  const t = await render(
    <FormField label="Site" value="Blue" onChange={() => {}} scheme="light" suggestions={OFFERS} onPickSuggestion={() => {}} addition={addition(() => {})} />,
  );
  await focusInput(t);
  expect(textIn(t)).toEqual(['Site', 'Blue Hole', 'Silfra', ADD_SITE]);
});

// Creating a community record is a deliberate act, and this is the gesture. Neither of the
// two paths a field already has may hear about it: `onChange` clears the paired id one layer
// up (a typed name refers to no site), and `onPickSuggestion` fills the field from a
// suggestion that does not exist here.
it('runs the caller’s own gesture, and neither the typing nor the picking path', async () => {
  const onPress = jest.fn();
  const onChange = jest.fn();
  const onPick = jest.fn();
  const t = await render(
    <FormField label="Site" value="Kotelna" onChange={onChange} scheme="light" suggestions={OFFERS} onPickSuggestion={onPick} addition={addition(onPress)} />,
  );
  await focusInput(t);
  const row = findSuggestion(t, ADD_SITE);
  if (!row) throw new Error('no create offer found');
  await fireEvent.press(row);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
  expect(onPick).not.toHaveBeenCalled();
});

// In flight, the row says so and refuses a second press — `ControlledPositionField`'s
// *Locating…* is the same shape. **Both `disabled` and `accessibilityState`**: the first stops
// the press, the second stops a screen reader announcing an available control that ignores
// taps, and `busy` is the word for one that will come back.
it('shuts the offer while it is in flight, in both the press and the announcement', async () => {
  const onPress = jest.fn();
  const t = await render(
    <FormField label="Site" value="Kotelna" onChange={() => {}} scheme="light" addition={addition(onPress, true)} />,
  );
  await focusInput(t);
  const row = findSuggestion(t, ADD_SITE);
  if (!row) throw new Error('no create offer found');
  expect(row.props.accessibilityState).toEqual({ disabled: true, busy: true });
  await fireEvent.press(row);
  expect(onPress).not.toHaveBeenCalled();
});

// §0.5: "Tap targets never below 48 dp". The same box a suggestion gets, because it is the
// same kind of thing to a wet thumb.
it('gives the create offer §0.5\'s 48 dp floor', async () => {
  const t = await render(
    <FormField label="Site" value="Kotelna" onChange={() => {}} scheme="light" addition={addition(() => {})} />,
  );
  await focusInput(t);
  const styles = makeStyles('light');
  expect(stylesOn(findSuggestion(t, ADD_SITE))).toContain(styles.formSuggestion);
});

// **Names are records now, drawn the way a dive row draws a site** (2026-11-14, the design
// canvas). A suggestion used to be muted because "an offer is not yet a value" — and a column
// of muted names with no history under them read as greyed-out text rather than as places the
// diver has been. The canvas draws each name in ink with what the diver has done there muted
// beneath it, and that muted line is what says "a record to pick" now. The act keeps its own
// style key and its own sentence, so a question can still never be drawn as a second act
// (`draws a question as a name to pick` below), and in flight it still goes muted.
it('draws a name and the act both in ink, each in its own treatment', async () => {
  const scheme = 'light';
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);
  expect(styles.formSuggestionAdd.color).toBe(theme.fg);
  expect(styles.formSuggestionText.color).toBe(theme.fg);

  const t = await render(
    <FormField label="Site" value="Blue" onChange={() => {}} scheme={scheme} suggestions={OFFERS} onPickSuggestion={() => {}} addition={addition(() => {})} />,
  );
  await focusInput(t);
  const drawn = (label: string) =>
    textNodesOf(t).find((n) => n.children.includes(label));
  expect(stylesOn(drawn(ADD_SITE))).toContain(styles.formSuggestionAdd);
  expect(stylesOn(drawn('Blue Hole'))).toContain(styles.formSuggestionText);
});

// ...and goes muted again in flight, which is what says "gone quiet, will come back" rather
// than "dead" — the pairing `formFieldPickerText` / `formFieldPickerTextUnset` already draws.
it('mutes the offer while it is in flight', async () => {
  const styles = makeStyles('light');
  const t = await render(
    <FormField label="Site" value="Kotelna" onChange={() => {}} scheme="light" addition={addition(() => {}, true)} />,
  );
  await focusInput(t);
  const drawn = textNodesOf(t).find((n) => n.children.includes(ADD_SITE));
  expect(stylesOn(drawn)).toContain(styles.formSuggestionAddBusy);
  expect(styles.formSuggestionAddBusy.color).toBe(themeFor('light').fgMuted);
});

// The row announces its own sentence rather than the `Fill ... with ...` a suggestion
// announces: it does not fill the field, it publishes a record, and the two must not sound
// alike to anyone who only hears them.
it('announces the act, never a fill', async () => {
  const t = await render(
    <FormField label="Site" value="Kotelna" onChange={() => {}} scheme="light" addition={addition(() => {})} />,
  );
  await focusInput(t);
  const announced = offersOf(t).map((n) => String(n.props?.accessibilityLabel ?? ''));
  expect(announced).toEqual([ADD_SITE]);
});

it('draws nothing outside its own treatment with an offer showing either (§0.4/§0.1)', async () => {
  const t = await render(
    <FormField label="Site" value="Blue" onChange={() => {}} scheme="light" suggestions={OFFERS} onPickSuggestion={() => {}} addition={addition(() => {})} />,
  );
  await focusInput(t);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
});

// ---------------------------------------------------------------------------------------
// §2.3's fuzzy check, once it has answered (M2p)
// ---------------------------------------------------------------------------------------

const DID_YOU_MEAN_SHARK = 'Did you mean “Shark Point”?';
const ADD_ANYWAY = `${ADD_SITE} anyway`;

/** One near-match, in the shape the caller hands over: the sentence the row reads, and the
 * pair picking it delivers. Written out here rather than derived from the suggestion, because
 * the wording is the caller's and this file is its independent witness. */
const MATCHES: FieldMatch[] = [
  { question: DID_YOU_MEAN_SHARK, suggestion: { value: 'Shark Point', id: 'site-shark' } },
  { question: 'Did you mean “Shark Bay”?', suggestion: { value: 'Shark Bay', id: 'site-bay' } },
];

const asked = (onPress: () => void, matches: FieldMatch[] = MATCHES) => ({
  label: ADD_ANYWAY,
  onPress,
  busy: false,
  matches,
});

// §2.3's own words, one row per near-match, under the same `focused` gate everything in this
// slot is under — and driven through real focus/blur for the reason the list is: a question
// wired to a condition it could never satisfy fails here rather than passing.
it('asks §2.3’s question only while its own row holds focus', async () => {
  const t = await render(
    <FormField label="Site" value="Sharks Point" onChange={() => {}} scheme="light" onPickSuggestion={() => {}} addition={asked(() => {})} />,
  );
  expect(textIn(t)).not.toContain(DID_YOU_MEAN_SHARK);

  const input = await focusInput(t);
  expect(textIn(t)).toContain(DID_YOU_MEAN_SHARK);

  await fireEvent(input, 'blur');
  expect(textIn(t)).not.toContain(DID_YOU_MEAN_SHARK);
});

// **The order is the whole claim**: the question the diver has just been asked, and under it
// the way through. Read off the drawn order rather than off a prop.
it('draws every question above the act, in the order it was handed them', async () => {
  const t = await render(
    <FormField label="Site" value="Sharks Point" onChange={() => {}} scheme="light" onPickSuggestion={() => {}} addition={asked(() => {})} />,
  );
  await focusInput(t);
  expect(textIn(t)).toEqual(['Site', DID_YOU_MEAN_SHARK, 'Did you mean “Shark Bay”?', ADD_ANYWAY]);
});

/**
 * **A pending question takes the slot to itself.** The diver has committed to a name and been
 * interrupted; their own history is a third answer to something they already answered, and —
 * the concrete failure — the same site can legitimately appear in both lists, once as
 * `Blue Hole` and once as *Did you mean “Blue Hole”?*.
 *
 * Asserted with a list that WOULD have drawn, so this is a claim about suppression rather
 * than about an empty array.
 */
it('puts the diver’s own history away while a question is standing', async () => {
  const t = await render(
    <FormField label="Site" value="Blue" onChange={() => {}} scheme="light" suggestions={OFFERS} onPickSuggestion={() => {}} addition={asked(() => {})} />,
  );
  await focusInput(t);
  expect(textIn(t)).toEqual(['Site', DID_YOU_MEAN_SHARK, 'Did you mean “Shark Bay”?', ADD_ANYWAY]);

  // ...and it is back the moment the question is not being asked, which is what makes the
  // line above about the question rather than about this component having stopped drawing
  // lists at all.
  const answeredAlready = await render(
    <FormField label="Site" value="Blue" onChange={() => {}} scheme="light" suggestions={OFFERS} onPickSuggestion={() => {}} addition={asked(() => {}, [])} />,
  );
  await focusInput(answeredAlready);
  expect(textIn(answeredAlready)).toEqual(['Site', 'Blue Hole', 'Silfra', ADD_ANYWAY]);
});

/**
 * §2.3: *"One tap picks the existing site instead."* That is precisely what picking a
 * suggestion already does, so it goes down the same path — `onPickSuggestion`, with the whole
 * pair — and not through `onChange`, which clears §6's id one layer up, nor through the
 * addition's own press, which would create the duplicate the question exists to prevent.
 */
it('answers the question through the picking path, and neither of the other two', async () => {
  const onPick = jest.fn();
  const onChange = jest.fn();
  const onPress = jest.fn();
  const t = await render(
    <FormField label="Site" value="Sharks Point" onChange={onChange} scheme="light" onPickSuggestion={onPick} addition={asked(onPress)} />,
  );
  await focusInput(t);
  const row = findSuggestion(t, DID_YOU_MEAN_SHARK);
  if (!row) throw new Error('no question found');
  await fireEvent.press(row);
  expect(onPick).toHaveBeenCalledWith({ value: 'Shark Point', id: 'site-shark' });
  expect(onChange).not.toHaveBeenCalled();
  expect(onPress).not.toHaveBeenCalled();
});

// The whole question is what a screen reader hears, never a suggestion's `Fill … with …`: the
// diver pressed a control, and a row announced as an ordinary fill would never tell them that
// anything had answered.
it('announces the question, never a fill', async () => {
  const t = await render(
    <FormField label="Site" value="Sharks Point" onChange={() => {}} scheme="light" suggestions={[]} onPickSuggestion={() => {}} addition={asked(() => {})} />,
  );
  await focusInput(t);
  const announced = offersOf(t).map((n) => String(n.props?.accessibilityLabel ?? ''));
  expect(announced).toEqual([DID_YOU_MEAN_SHARK, 'Did you mean “Shark Bay”?', ADD_ANYWAY]);
});

// A question IS a name to pick, so it wears the name's own treatment and never the act's — the
// two share an ink since 2026-11-14, so what this guards is the act's style key, which is what
// goes muted in flight and must never take a question with it.
it('draws a question as a name to pick, not as a second act', async () => {
  const styles = makeStyles('light');
  const t = await render(
    <FormField label="Site" value="Sharks Point" onChange={() => {}} scheme="light" onPickSuggestion={() => {}} addition={asked(() => {})} />,
  );
  await focusInput(t);
  expect(stylesOn(findSuggestion(t, DID_YOU_MEAN_SHARK))).toContain(styles.formSuggestion);
  const drawn = textNodesOf(t).find((n) => n.children.includes(DID_YOU_MEAN_SHARK));
  expect(stylesOn(drawn)).toContain(styles.formSuggestionText);
  expect(stylesOn(drawn)).not.toContain(styles.formSuggestionAdd);
});

// In flight the act still shuts, exactly as it does without a question — a second press while
// the write is out would publish the same site twice under two ids.
it('still shuts the act while it is in flight, with a question standing', async () => {
  const onPress = jest.fn();
  const t = await render(
    <FormField label="Site" value="Sharks Point" onChange={() => {}} scheme="light" onPickSuggestion={() => {}} addition={{ ...asked(onPress), busy: true }} />,
  );
  await focusInput(t);
  const row = findSuggestion(t, ADD_ANYWAY);
  expect(row?.props.accessibilityState).toEqual({ disabled: true, busy: true });
  await fireEvent.press(row!);
  expect(onPress).not.toHaveBeenCalled();
});

it('draws nothing outside its own treatment with a question showing (§0.4/§0.1)', async () => {
  const t = await render(
    <FormField label="Site" value="Sharks Point" onChange={() => {}} scheme="light" onPickSuggestion={() => {}} addition={asked(() => {})} />,
  );
  await focusInput(t);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
});

// ---------------------------------------------------------------------------------------
// The three credential props (M2e — the account screen's two rows)
// ---------------------------------------------------------------------------------------

// **A password rendering in the clear is the failure §0.6 collects**: "shipped once and only
// found by using the app". Nothing errors, no test fails, and the one secret this app handles
// is on screen in a café. Asserted on the input's own prop, because that is what React Native
// masks on.
it('masks the value when a caller asks it to, and never otherwise', async () => {
  const masked = await render(
    <FormField label="Password" value="hunter2" onChange={() => {}} scheme="light" secureTextEntry />,
  );
  expect(inputsOf(masked)[0]?.props.secureTextEntry).toBe(true);

  const plain = await render(<FormField label="Site" value="Blue Hole" onChange={() => {}} scheme="light" />);
  expect(inputsOf(plain)[0]?.props.secureTextEntry).toBeUndefined();
});

// The pair that stops a device rewriting a value that is not prose. Set EXPLICITLY at the two
// call sites that need `'none'` rather than inferred from `keyboardType` or `secureTextEntry`
// — the same rule `mono` follows, for the same reason: a site name, a buddy and a dive centre
// are names and must keep the device's help, and they reach this component through these very
// props.
it('passes the capitalise and correct answers through, and leaves the platform’s own where a caller gave none', async () => {
  const credential = await render(
    <FormField label="Email" value="" onChange={() => {}} scheme="light" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />,
  );
  const input = inputsOf(credential)[0];
  expect(input?.props.autoCapitalize).toBe('none');
  expect(input?.props.autoCorrect).toBe(false);
  expect(input?.props.keyboardType).toBe('email-address');

  const name = await render(<FormField label="Site" value="" onChange={() => {}} scheme="light" />);
  expect(inputsOf(name)[0]?.props.autoCapitalize).toBeUndefined();
  expect(inputsOf(name)[0]?.props.autoCorrect).toBeUndefined();
  expect(inputsOf(name)[0]?.props.keyboardType).toBe('default');
});

// The three are opt-in in exactly the sense the two suggestion props are: a field that passes
// none of them must render the tree it rendered before they existed. Whole-tree equality
// rather than a query, because "unchanged" is a claim about everything.
it('leaves every field written before these props existed rendering identically', async () => {
  const before = await render(<FormField label="Buddy" value="Jana" onChange={() => {}} scheme="light" />);
  const after = await render(
    <FormField
      label="Buddy"
      value="Jana"
      onChange={() => {}}
      scheme="light"
      secureTextEntry={undefined}
      autoCapitalize={undefined}
      autoCorrect={undefined}
    />,
  );
  expect(JSON.stringify(after.toJSON())).toBe(JSON.stringify(before.toJSON()));
});

/**
 * **While the act is in flight the whole slot is inert, not just the act.** The diver has
 * answered the question by pressing *…anyway*; the write can take seconds (§2.3's country
 * lookup waits on the network), and a question left live through that window is a tap that
 * pairs the dive with the existing site and is then overwritten by the row the write is about
 * to create — the answer taken and thrown away, with nothing on screen to say so.
 *
 * Both `disabled` and `accessibilityState`, for the act's own reason one test up: the first
 * stops the press, the second stops a screen reader announcing an available control that
 * ignores taps.
 */
it('shuts the questions too while the act is writing', async () => {
  const onPick = jest.fn();
  const t = await render(
    <FormField label="Site" value="Sharks Point" onChange={() => {}} scheme="light" onPickSuggestion={onPick} addition={{ ...asked(() => {}), busy: true }} />,
  );
  await focusInput(t);
  const row = findSuggestion(t, DID_YOU_MEAN_SHARK);
  expect(row?.props.accessibilityState).toEqual({ disabled: true, busy: true });
  await fireEvent.press(row!);
  expect(onPick).not.toHaveBeenCalled();
});

// ...and they are live again the moment it is not, which is what makes the line above about
// the write rather than about the questions never being pressable.
it('leaves the questions live whenever the act is not writing', async () => {
  const onPick = jest.fn();
  const t = await render(
    <FormField label="Site" value="Sharks Point" onChange={() => {}} scheme="light" onPickSuggestion={onPick} addition={asked(() => {})} />,
  );
  await focusInput(t);
  await fireEvent.press(findSuggestion(t, DID_YOU_MEAN_SHARK)!);
  expect(onPick).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------------------
// The 2026-11-14 design pass: a field behaves the way the design canvas draws it
// ---------------------------------------------------------------------------------------

/** A press on a node, delivered the way a finger delivers it: to the nearest ancestor that
 * handles it. Throws when nothing handles it, so a label nobody wired fails loudly. */
function labelOf(t: RenderResult, label: string) {
  const node = textNodesOf(t).find((n) => n.children.includes(label));
  if (!node) throw new Error(`no "${label}" label drawn`);
  return node;
}

// Found on a phone: the label was plain text, so the leading third of every row — wider in
// Czech, whose labels run 20–30 % longer — was dead to a tap, and only the value side focused
// the field. The canvas treats the whole row as the field.
it('focuses its input when the diver taps the label, not only the value', async () => {
  const ref = createRef<TextInput>();
  const t = await render(<FormField ref={ref} label="Site" value="" onChange={() => {}} scheme="light" />);
  // The test double's `focus` is one spy shared by every instance, so count from here.
  const focus = ref.current?.focus as unknown as jest.Mock | undefined;
  if (!focus) throw new Error('the ref never reached the input');
  const before = focus.mock.calls.length;

  await fireEvent.press(labelOf(t, 'Site'));
  expect(focus.mock.calls.length).toBe(before + 1);
});

// ...and the row that takes that press is not a second control to a screen reader: the input
// already announces itself by the label, and a row announced as a button would be two stops
// for one field.
it('adds no control for a screen reader to land on twice', async () => {
  const t = await render(<FormField label="Site" value="" onChange={() => {}} scheme="light" />);
  expect(buttonsOf(t)).toHaveLength(0);
});

// The return key moved nowhere: it closed the keyboard, so a diver walking down the form
// re-opened it on every row. A caller that knows what comes next says so; this component hands
// the key's press back and keeps the keyboard up while the caller moves focus.
it('hands the return key to its caller as a step to the next field, keeping the keyboard up', async () => {
  const onSubmit = jest.fn();
  const t = await render(
    <FormField label="Site" value="Blue Hole" onChange={() => {}} scheme="light" returnKeyType="next" onSubmitEditing={onSubmit} />,
  );
  const input = inputsOf(t)[0];
  if (!input) throw new Error('no TextInput found');
  expect(input.props.returnKeyType).toBe('next');
  expect(input.props.submitBehavior).toBe('submit');
  await fireEvent(input, 'submitEditing');
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it('leaves the return key to the platform when its caller says nothing about it', async () => {
  const t = await render(<FormField label="Site" value="" onChange={() => {}} scheme="light" />);
  const input = inputsOf(t)[0];
  expect(input?.props.returnKeyType).toBeUndefined();
  expect(input?.props.submitBehavior).toBeUndefined();
});

// **No clear control while the diver edits a value of their own** (issue #29, owner's call). One
// was drawn inside the focused field from 2026-11-14, as the canvas draws it, and it pushed the
// right-aligned value 60 pt left on every focus — and back on every blur, so Next moved two
// rows at once. The form's values are short and holding backspace empties them; a password,
// which the diver cannot see, empties on one press (below).
it('draws no clear control while the diver edits a value of their own, so the value never moves', async () => {
  const t = await render(<FormField label="Site" value="Blue Hole" onChange={() => {}} scheme="light" />);
  await focusInput(t);
  expect(findSuggestion(t, 'Clear Site')).toBeUndefined();
  expect(buttonsOf(t)).toHaveLength(0);
});

it('keeps a carried row\'s own ring while focused, and adds no second one', async () => {
  const empty = await render(<FormField label="Site" value="" onChange={() => {}} scheme="light" />);
  await focusInput(empty);
  expect(findSuggestion(empty, 'Clear Site')).toBeUndefined();

  const carried = await render(
    <FormField label="Site" value="Blue Hole" carried onClear={() => {}} onChange={() => {}} scheme="light" />,
  );
  await focusInput(carried);
  expect(findSuggestion(carried, 'Clear Site')).toBeUndefined();
  expect(findSuggestion(carried, 'Clear carried Site')).toBeDefined();
});

// The caret is the one mark the system draws inside a field, and iOS draws it in its own blue —
// the only hue anywhere in this app's chrome. §0.1 spends hue on depth; the canvas draws an
// ink caret.
it('draws its caret and selection in ink, not in the platform blue', async () => {
  const t = await render(<FormField label="Site" value="" onChange={() => {}} scheme="dark" />);
  expect(inputsOf(t)[0]?.props.selectionColor).toBe(themeFor('dark').fg);
});

// Found on a phone: the fourth suggestion for "K" sat behind the save button, which rides on
// the keyboard, and nothing scrolled the list into view. The field cannot scroll its form, so
// it tells the form which node to keep in view for as long as it holds focus.
it('asks its form to keep it in view while focused, and lets go when it blurs', async () => {
  const keep = jest.fn();
  const t = await render(
    <FormRevealContext.Provider value={keep}>
      <FormField label="Site" value="" onChange={() => {}} scheme="light" suggestions={OFFERS} onPickSuggestion={() => {}} />
    </FormRevealContext.Provider>,
  );
  const input = await focusInput(t);
  expect(keep).toHaveBeenCalled();
  const [held, holding] = keep.mock.lastCall ?? [];
  expect(held).toBeDefined();
  expect(held).not.toBeNull();
  expect(holding).toBe(true);

  // Letting go names the node it is letting go OF. Moving from one field to the next can
  // deliver the old field's blur after the new field's focus, and a bare "let go" would then
  // drop the field the diver just moved into.
  await fireEvent(input, 'blur');
  expect(keep).toHaveBeenLastCalledWith(held, false);
});

const DESCRIBED: OfferedSuggestion[] = [
  { value: 'Blue Hole', id: 'site-blue', meta: '4 dives · last 18 May 2026', figure: '34.6 m' },
  { value: 'Silfra', id: null, meta: null, figure: null },
];

// The canvas's suggestion row: the name, what the diver has done there beneath it, and a figure
// trailing — a list of places with history in them rather than a column of bare words.
it('draws what the diver has done with a suggestion beneath its name, and its figure trailing', async () => {
  const styles = makeStyles('light');
  const t = await render(
    <FormField label="Site" value="" onChange={() => {}} scheme="light" suggestions={DESCRIBED} suggestionsTitle="Your sites · 2" onPickSuggestion={() => {}} />,
  );
  expect(textIn(t)).not.toContain('Your sites · 2');
  await focusInput(t);

  expect(textIn(t)).toEqual(['Site', 'Your sites · 2', 'Blue Hole', '4 dives · last 18 May 2026', '34.6 m', 'Silfra']);
  const drawn = (text: string) => textNodesOf(t).find((n) => n.children.includes(text));
  expect(stylesOn(drawn('Your sites · 2'))).toContain(styles.formSuggestionsTitle);
  expect(stylesOn(drawn('Blue Hole'))).toContain(styles.formSuggestionText);
  expect(stylesOn(drawn('4 dives · last 18 May 2026'))).toContain(styles.formSuggestionMeta);
  expect(stylesOn(drawn('34.6 m'))).toContain(styles.formSuggestionFigure);
  // Both muted: what was done there and how deep are facts ABOUT the name, never its rival.
  expect(styles.formSuggestionMeta.color).toBe(themeFor('light').fgMuted);
  expect(styles.formSuggestionFigure.color).toBe(themeFor('light').fgMuted);
});

// The pick still hands back the suggestion the caller gave — its details ride along untouched,
// so nothing a caller pairs with a pick (§6's id) can be lost on the way through.
it('hands the caller the whole described suggestion it pressed', async () => {
  const onPick = jest.fn();
  const t = await render(
    <FormField label="Site" value="" onChange={() => {}} scheme="light" suggestions={DESCRIBED} onPickSuggestion={onPick} />,
  );
  await focusInput(t);
  await fireEvent.press(findSuggestion(t, 'Fill Site with Blue Hole')!);
  expect(onPick).toHaveBeenLastCalledWith(DESCRIBED[0]);
});

// The list sits UNDER the card on the screen's own ground, as the canvas draws it, so the card
// is the field and the rows below are the field's offers — not one white slab holding both.
it('draws the list under the card rather than inside it', async () => {
  const styles = makeStyles('light');
  const t = await render(
    <FormField label="Site" value="" onChange={() => {}} scheme="light" suggestions={DESCRIBED} onPickSuggestion={() => {}} />,
  );
  await focusInput(t);
  const card = t.root?.queryAll((n) => stylesOn(n).includes(styles.formFieldCard))[0];
  if (!card) throw new Error('no card drawn');
  expect(card.queryAll((n) => stylesOn(n).includes(styles.formSuggestions))).toHaveLength(0);
  expect(t.root?.queryAll((n) => stylesOn(n).includes(styles.formSuggestions))).toHaveLength(1);
});

it('draws nothing outside its own treatment with described rows showing (§0.4/§0.1)', async () => {
  const t = await render(
    <FormField label="Site" value="Blue" onChange={() => {}} scheme="dark" suggestions={DESCRIBED} suggestionsTitle="Your sites · 2" onPickSuggestion={() => {}} />,
  );
  await focusInput(t);
  expect(unexpectedGraphics(t, 'dark')).toHaveLength(0);
});

// The account screen's two rows (2026-11-14): the platform's AutoFill only offers a saved
// address, a saved password or a strong new one when the field says which it is. Passed
// through, and left to the platform wherever a caller says nothing.
it('tells the platform what a field holds, for AutoFill, only when its caller says', async () => {
  const told = await render(
    <FormField label="Password" value="" onChange={() => {}} scheme="light" secureTextEntry textContentType="newPassword" autoComplete="new-password" returnKeyType="go" onSubmitEditing={() => {}} />,
  );
  const input = inputsOf(told)[0];
  expect(input?.props.textContentType).toBe('newPassword');
  expect(input?.props.autoComplete).toBe('new-password');
  expect(input?.props.returnKeyType).toBe('go');

  const silent = await render(<FormField label="Site" value="" onChange={() => {}} scheme="light" />);
  expect(inputsOf(silent)[0]?.props.textContentType).toBeUndefined();
  expect(inputsOf(silent)[0]?.props.autoComplete).toBeUndefined();
});

// **Backspace empties a password** (issue #29, owner's call). The diver cannot see what one press
// would take off a masked value, so a press starts the password over. It is read from the text
// alone — a change that only took characters away — because a key event is not something every
// keyboard sends (an Android hardware keyboard sends none) or sends first. A fill or a paste puts
// characters in, so it arrives as it came, whatever the field held and whatever key came before.
describe('a password field', () => {
  async function password(value: string) {
    const onChange = jest.fn();
    const t = await render(<FormField label="Password" value={value} onChange={onChange} scheme="light" secureTextEntry />);
    const input = inputsOf(t)[0];
    if (!input) throw new Error('no TextInput found');
    return { input, onChange };
  }

  it('empties on backspace', async () => {
    const { input, onChange } = await password('hunter22');
    await fireEvent.changeText(input, 'hunter2');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('empties when the character taken out is in the middle', async () => {
    const { input, onChange } = await password('hunter22');
    await fireEvent.changeText(input, 'huner22');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('takes typing as typed', async () => {
    const { input, onChange } = await password('hunter2');
    await fireEvent.changeText(input, 'hunter22');
    expect(onChange).toHaveBeenLastCalledWith('hunter22');
  });

  it('takes a fill into an empty field as it arrives', async () => {
    const { input, onChange } = await password('');
    await fireEvent.changeText(input, 'S3cret-from-the-keychain');
    expect(onChange).toHaveBeenLastCalledWith('S3cret-from-the-keychain');
  });

  it('takes a fill shorter than what it replaces as it arrives, even after a backspace that changed nothing', async () => {
    const { input, onChange } = await password('hunter22');
    await fireEvent(input, 'keyPress', { nativeEvent: { key: 'Backspace' } });
    await fireEvent.changeText(input, 'S3cret');
    expect(onChange).toHaveBeenLastCalledWith('S3cret');
  });
});

it.each([
  ['the last character', 'hunter22', 'hunter2', true],
  ['the first character', 'hunter22', 'unter22', true],
  ['one of a repeated pair', 'aab', 'ab', true],
  ['a selected run', 'hunter22', 'hun22', true],
  ['everything', 'hunter22', '', true],
  ['nothing, the text unchanged', 'hunter22', 'hunter22', false],
  ['nothing, a character added', 'hunter2', 'hunter22', false],
  ['nothing, a shorter value put in its place', 'hunter22', 'S3cret', false],
  ['nothing, a same-length value put in its place', 'hunter22', 'hunter23', false],
])('isDeletion reads a change that took out %s', (_, prev, next, expected) => {
  expect(isDeletion(prev, next)).toBe(expected);
});

it('backspaces one character at a time in a field that is not a password', async () => {
  const onChange = jest.fn();
  const t = await render(<FormField label="Site" value="Blue Hole" onChange={onChange} scheme="light" />);
  const input = inputsOf(t)[0];
  if (!input) throw new Error('no TextInput found');
  await fireEvent(input, 'keyPress', { nativeEvent: { key: 'Backspace' } });
  await fireEvent.changeText(input, 'Blue Hol');
  expect(onChange).toHaveBeenLastCalledWith('Blue Hol');
});

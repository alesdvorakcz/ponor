import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { View } from 'react-native';

import { type Suggestion } from '../domain/suggest';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { FormField } from './FormField';

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

  const empty = await render(<FormField label="Weights" value="" onChange={() => {}} scheme="light" mono unit="kg" />);
  expect(inputsOf(empty)[0]?.props.placeholder).toBe('kg');
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
it('shows the unit as a suffix once there is a figure, and as the placeholder before', async () => {
  const filled = await render(<FormField label="Max depth" value="18.4" onChange={() => {}} scheme="light" mono unit="m" />);
  // A real `Text` node reading exactly the unit, beside the value — never concatenated into
  // the value itself, which has to stay exactly what the diver typed.
  expect(textIn(filled)).toContain('m');
  expect(inputsOf(filled)[0]?.props.value).toBe('18.4');

  const empty = await render(<FormField label="Max depth" value="" onChange={() => {}} scheme="light" mono unit="m" />);
  expect(inputsOf(empty)[0]?.props.placeholder).toBe('m');
  // ...and NOT also as a suffix. The two are the same word in the same slot, so drawing both
  // would read as "m m" the moment the field is empty — which is most of the time.
  expect(textIn(empty)).not.toContain('m');
});

// A field whose hint is not a unit — a conditions scale's `0-3`, a rating's `1-5` — keeps it
// as a placeholder and never grows a suffix. "3 0-3" is the reading this separation exists to
// prevent, and a single prop could not tell the two cases apart.
it('never turns a plain hint into a suffix beside the value', async () => {
  const t = await render(<FormField label="Waves" value="2" onChange={() => {}} scheme="light" mono placeholder="0-3" />);
  expect(textIn(t)).not.toContain('0-3');
  expect(inputsOf(t)[0]?.props.placeholder).toBe('0-3');
});

// §0.6: "**Focus is what draws the affordance.** The focused row fills with `surface`;
// nothing else does." Driven through the input's real `onFocus`/`onBlur` rather than a prop,
// so a field wired to a fill it could never turn on would fail here rather than pass.
it('fills its row with surface while focused, and nothing at rest', async () => {
  const t = await render(<FormField label="Site" value="" onChange={() => {}} scheme="light" />);
  const styles = makeStyles('light');
  // `t.root` and not `queryAll`: this component's own root IS the row, and `queryAll` walks
  // descendants only — it never returns the instance it is called on, so a query for the row
  // finds nothing and every `not.toContain` below would pass on an empty array.
  const row = () => stylesOn(t.root ?? undefined);
  const input = inputsOf(t)[0];
  if (!input) throw new Error('no TextInput found');

  expect(row()).toContain(styles.formField);
  expect(row()).not.toContain(styles.formFieldFocused);
  await fireEvent(input, 'focus');
  expect(row()).toContain(styles.formFieldFocused);
  await fireEvent(input, 'blur');
  expect(row()).not.toContain(styles.formFieldFocused);
  // The fill is `surface` and nothing else — §0.6 gives the affordance to one token, and a
  // border or a radius here would be the box coming back by another name.
  expect(styles.formFieldFocused).toEqual({ backgroundColor: themeFor('light').surface });
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
  expect(buttonsOf(t)).toHaveLength(0);
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

  // Focusing draws the fill and nothing else: no list, no control, no extra text.
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

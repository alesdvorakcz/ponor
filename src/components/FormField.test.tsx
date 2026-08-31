import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { View } from 'react-native';

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

// --- Task 5 brief, Step 1, adapted rather than pasted verbatim — see the two notes below. ---
//
// (1) `scheme` is a required prop on every OTHER test in this file; the brief's own sample
// omits it. Added here for consistency with the rest of this file rather than making
// `scheme` optional on the component — the brief's two given assertions don't touch
// styling, so this is a mechanical completion, not a behaviour change.
//
// (2) The brief's sample wraps the two fields in a bare `<>...</>` Fragment. Checked
// against this file's own established gotcha first (the keyboardType test above:
// "`render().root` is literally `container.children[0]`, so two top-level siblings
// behind a Fragment would leave `root.queryAll` searching only inside the first one") by
// actually rendering that exact Fragment shape and logging `textIn`/`inputsOf` — it
// confirmed only the FIRST field was reachable at all (one label, one input, of the two
// rendered). Under a Fragment this test would still report "1 chip found" and pass, but
// for the wrong reason: the second, uncarried field would be invisible to the query
// rather than correctly checked and found chip-less — exactly the "assertion that
// couldn't prove what it claims" shape this task's brief warns about. A `<View>` root
// (same fix the keyboardType test already uses) makes both fields actually reachable.
it('marks a carried field and leaves a typed one unmarked', async () => {
  const t = await render(
    <View>
      <FormField label="Site" value="Blue Hole" carried onChange={() => {}} onClear={() => {}} scheme="light" />
      <FormField label="Max depth" value="32.4" onChange={() => {}} scheme="light" />
    </View>,
  );
  const chips = textIn(t).filter((s) => s.includes('carried'));
  expect(chips).toHaveLength(1);
});

// DESIGN.md §0.5: "Tap targets never below 48 dp." The `×` is a 27 x 24 chip segment that
// gets there through `hitSlop`, and hitSlop is only delivered where every ANCESTOR of the
// control also contains the point — so the numbers alone prove nothing. What this checks is
// the pair: the slop reaches 48 in both directions AND it reaches it in a direction the
// layout can actually deliver.
//
// There is no Yoga in this environment (react-test-renderer never lays anything out), so
// the geometry is read off the styles the component composes, exactly as
// ReorderControls.test.tsx reads its arrows'. The two facts that made this target 27 x 24
// while its comment said 48: the label row was as tall as its 14 px text, and the chip sits
// flush against that row's trailing edge, so the right-hand slop had nothing to extend into.
it('reaches a 48 dp target for the clear control, in directions the layout can deliver', async () => {
  const t = await render(
    <FormField label="Weights" value="6" carried onChange={() => {}} onClear={() => {}} scheme="light" />,
  );
  const clear = t.root
    ? t.root
        .queryAll((n) => n.props?.accessibilityRole === 'button')
        .find((n) => String(n.props?.accessibilityLabel ?? '').includes('Clear carried'))
    : undefined;
  if (!clear) throw new Error('no clear control found');
  const slop = clear.props.hitSlop as { top?: number; bottom?: number; left?: number; right?: number };
  const styles = makeStyles('light');

  // Vertical: the row is the ancestor, and it is 48 dp, so slop of at least half the
  // difference on each side claims all of it whatever the glyph metrics turn out to be.
  expect(styles.formFieldHeader.minHeight).toBe(48);
  expect(slop.top ?? 0).toBeGreaterThanOrEqual(12);
  expect(slop.bottom ?? 0).toBeGreaterThanOrEqual(12);

  // Horizontal: the `×` zone is its own `paddingHorizontal` plus one mono glyph — call it
  // 27 dp at fontSize 11 — and every dp of the shortfall has to come from the LEFT, inward
  // over the chip's own label, because the chip's right edge is the header's right edge and
  // nothing outside it is an ancestor of anything.
  const clearZoneWidth = styles.formFieldCarriedClear.paddingHorizontal * 2 + 7;
  expect(clearZoneWidth + (slop.left ?? 0)).toBeGreaterThanOrEqual(48);
  // Stated, not implied: slop to the right is spent outside every ancestor, so a fix that
  // "reached 48" by splitting the shortfall across both sides would be back where it began.
  expect(slop.right ?? 0).toBe(0);
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

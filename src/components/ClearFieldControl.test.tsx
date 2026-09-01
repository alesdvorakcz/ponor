import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { ClearFieldControl } from './ClearFieldControl';

// See `CarriedMark.test.tsx` for why the sweep includes `t.root` and why the `SymbolModule`
// host name is what tells a real platform symbol from a drawn approximation of one.
function symbolsIn(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter(
    (n) => typeof n.type === 'string' && n.type.includes('SymbolModule'),
  );
}

/** The control itself — which is this component's own ROOT, so the sweep has to include
 * `t.root` for the same reason `symbolsIn` above does. `queryAll` never returns the instance
 * it is called on, so a descendants-only query finds nothing here and every `?.` assertion
 * below would quietly check `undefined` against itself. */
function buttonOf(t: RenderResult) {
  if (!t.root) return undefined;
  return [t.root, ...t.root.queryAll(() => true)].find((n) => n.props?.accessibilityRole === 'button');
}

const noop = () => {};

// §0.6's "drawn, not typed", and the owner's sheet by name: a ring, not the `×` this replaces.
// The symbol is asserted by name because a ring is the shape the sheet asks for and because
// every other assertion here would pass for `xmark` — the bare cross, which is exactly what
// the two chips drew before this control existed.
it('draws a real ring symbol, resolved through to the native layer', async () => {
  const t = await render(<ClearFieldControl accessibilityLabel="Clear carried Buddy" onPress={noop} scheme="dark" />);
  const [symbol] = symbolsIn(t);
  expect(symbol).toBeDefined();
  expect(symbol?.props.name).toBe('xmark.circle');
});

// **20 pt of visible glyph in a 48 dp box** — the sheet's own two numbers, and the pair is the
// design rather than either alone: 20 is what a diver can see, 48 is what a wet thumb can hit
// (§0.5). Written out here rather than read back from an exported constant, so this states the
// design instead of agreeing with the code about it.
it('is a 20 pt glyph inside §0.5’s 48 dp box', async () => {
  const t = await render(<ClearFieldControl accessibilityLabel="Clear carried Buddy" onPress={noop} scheme="dark" />);
  expect(symbolsIn(t)[0]?.props.size).toBe(20);
  const styles = makeStyles('dark');
  expect([buttonOf(t)?.props.style].flat(5).filter(Boolean)).toContain(styles.clearFieldControl);
  expect(styles.clearFieldControl.minWidth).toBe(48);
  expect(styles.clearFieldControl.minHeight).toBe(48);
});

// The assertion the redesign is. `hitSlop` reaches §0.5's floor invisibly, which means it is
// free to point anywhere — and in both of this control's ancestors it did, 21 dp INWARD: over
// the word "carried" in a `FormField`, where tapping the label cleared the field, and over the
// picker's own trigger in a `DateTimeField`, where "clear this" was delivered on top of "open
// this". A box has no direction to get wrong, and this is what keeps it a box.
it('extends its target nowhere beyond the box a diver can see', async () => {
  const t = await render(<ClearFieldControl accessibilityLabel="Clear carried Buddy" onPress={noop} scheme="dark" />);
  expect(buttonOf(t)?.props.hitSlop).toBeUndefined();
});

// The announcement is the caller's, because the two callers are saying two different true
// things: `FormField` names a carried value being thrown away, `DateTimeField` names an
// optional field being unset. A control that composed one sentence itself would make one of
// them wrong.
it('announces exactly what its caller said, as a button', async () => {
  const t = await render(<ClearFieldControl accessibilityLabel="Clear Time in" onPress={noop} scheme="dark" />);
  expect(buttonOf(t)?.props.accessibilityLabel).toBe('Clear Time in');
  expect(buttonOf(t)?.props.accessibilityRole).toBe('button');
});

it('reports the press', async () => {
  const onPress = jest.fn();
  const t = await render(<ClearFieldControl accessibilityLabel="Clear carried Buddy" onPress={onPress} scheme="dark" />);
  const button = buttonOf(t);
  if (!button) throw new Error('no clear control found');
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});

// §0.1 and §4.1 together: monochrome, and the token meets the property in the sheet rather
// than in this file. Both themes, because ink hard-coded to one is invisible on the other's
// ground and this component takes `scheme` for exactly that.
it.each(['dark', 'light'] as const)('takes its ink from the %s sheet, never a literal', async (scheme) => {
  const t = await render(<ClearFieldControl accessibilityLabel="Clear carried Buddy" onPress={noop} scheme={scheme} />);
  expect(symbolsIn(t)[0]?.props.tintColor).toBe(makeStyles(scheme).clearFieldInk.color);
  expect(makeStyles(scheme).clearFieldInk.color).toBe(themeFor(scheme).fgMuted);
});

it('draws nothing outside its own treatment (§0.4/§0.1)', async () => {
  const t = await render(<ClearFieldControl accessibilityLabel="Clear carried Buddy" onPress={noop} scheme="light" />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
});

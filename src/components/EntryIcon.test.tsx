import { render, type RenderResult } from '@testing-library/react-native';

import { ENTRY_VALUES } from '../domain/types';
import { themeFor } from '../theme/resolve';
import { EntryIcon } from './EntryIcon';

// Same RTL adaptation every component test in this repo notes (SearchCapsule.test.tsx,
// FormGroup.test.tsx): `render` is async and its `root` is a test-renderer `TestInstance`
// exposing `queryAll(predicate)`, whose tree holds HOST elements only — a composite
// component (`SymbolView` itself) never appears as its own node, only whatever host element
// it renders down to.

// Lifted verbatim from SearchCapsule.test.tsx, which established it: expo-symbols'
// `SymbolView` resolves to a native view manager named `SymbolModule` on the one platform
// Jest runs this suite under (jest-expo's stock preset; `@react-native/jest-preset`
// hard-codes `haste.defaultPlatform: 'ios'`). `.includes` rather than an exact
// `'ViewManagerAdapter_SymbolModule'` match, so a future adapter-naming change doesn't
// decouple this from the fact that actually matters — the real native module name a real
// SymbolView resolves to, taken from SymbolModule.ios's own
// `requireNativeViewManager('SymbolModule')` call.
//
// This is what separates "an SF Symbol" from "some drawn approximation of one": a hand-rolled
// glyph, an imported PNG or a `Text` character would never produce a `SymbolModule`-named
// host node at all, and §0.6 asks for the real thing by name ("SF Symbols through
// `expo-symbols` with a Material Symbol on Android, exactly as `SearchCapsule`'s magnifier
// already works").
//
// `t.root` is INCLUDED in the sweep, unlike SearchCapsule's own copy: `queryAll` walks
// descendants and never returns the instance it is called on, and this component renders the
// symbol as its own outermost element rather than inside a capsule — so the one node that
// matters would be the one node the query could never see. The same half-blindness
// `unexpectedGraphics.ts` records finding in five copies of its own guard.
function symbolsIn(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter(
    (n) => typeof n.type === 'string' && n.type.includes('SymbolModule'),
  );
}

const INK = themeFor('dark').fg;

// DESIGN.md §0.6: "*Shore* and *boat* do [have a symbol]." Both, by exact name, because a
// component that rendered one symbol for every value would pass a test that only checked
// that *an* icon appeared — and the two chips sit side by side, where one glyph doing duty
// for both is the most likely way this breaks.
it.each([
  ['shore', 'figure.walk'],
  ['boat', 'ferry.fill'],
] as const)('draws %s as a real SF Symbol, resolved through to the native layer', async (entry, name) => {
  const t = await render(<EntryIcon entry={entry} tintColor={INK} />);
  const [symbol] = symbolsIn(t);
  expect(symbol).toBeDefined();
  expect(symbol?.props.name).toBe(name);
});

// The half of §0.6 that is easiest to lose and hardest to notice: "*other* does not [have a
// symbol]... drawn as icons those collapse into near-identical shapes, which is a legend, and
// §10 already records that failure once."
//
// Asserted as "nothing is rendered at all", not as "no symbol is rendered": a component that
// drew a blank box, a spacer, or a fallback glyph for `other` would leave the chip's label
// pushed off-centre against its two neighbours, and would satisfy the weaker assertion.
it('draws nothing whatsoever for an entry with no conventional symbol', async () => {
  const t = await render(<EntryIcon entry="other" tintColor={INK} />);
  expect(symbolsIn(t)).toHaveLength(0);
  // Nothing in the tree at all — `toJSON()` is null only when the component rendered no
  // element whatsoever, where a blank wrapper would serialise to a real node.
  expect(t.toJSON()).toBeNull();
});

// Swept over the domain's own vocabulary rather than over a list written here, the same way
// DiveFormScreen.test.tsx checks its chips: this is what says "an icon appears only where the
// value has one" about the whole union rather than about three values that happen to be its
// members today. A member added to `Entry` later draws no icon — the safe default — and
// gaining one has to be a deliberate edit to the map, which this test then reports.
it('gives exactly two of the domain’s entry values an icon, and the rest none', async () => {
  const withIcon: string[] = [];
  for (const entry of ENTRY_VALUES) {
    const t = await render(<EntryIcon entry={entry} tintColor={INK} />);
    if (symbolsIn(t).length > 0) withIcon.push(entry);
  }
  expect(withIcon).toEqual(['shore', 'boat']);
});

// §0.6 makes the icon a companion to the label beside it, and DiveFormScreen's chip inverts
// that label when the chip is selected. An icon that resolved its own colour would stay `fg`
// on the selected chip's `action` ground and disappear — so the tint has to be whatever it is
// handed, proven with two different values rather than one (a hard-coded colour that happened
// to match the first would pass a single-value assertion).
it('draws in whatever ink it is handed, rather than a colour of its own', async () => {
  const dark = await render(<EntryIcon entry="boat" tintColor={themeFor('dark').fg} />);
  expect(symbolsIn(dark)[0]?.props.tintColor).toBe(themeFor('dark').fg);

  const inverted = await render(<EntryIcon entry="boat" tintColor={themeFor('dark').actionFg} />);
  expect(symbolsIn(inverted)[0]?.props.tintColor).toBe(themeFor('dark').actionFg);
});

// expo-symbols' own default is 24, which beside a 13.5 px chip label is an icon with a label
// attached rather than a label with an icon beside it. Pinned as the default the one call
// site relies on, and as overridable, so neither half can be lost silently.
it('sits at the label’s own scale by default, and takes a caller’s size when given one', async () => {
  const standard = await render(<EntryIcon entry="shore" tintColor={INK} />);
  expect(symbolsIn(standard)[0]?.props.size).toBe(15);

  const larger = await render(<EntryIcon entry="shore" tintColor={INK} size={22} />);
  expect(symbolsIn(larger)[0]?.props.size).toBe(22);
});

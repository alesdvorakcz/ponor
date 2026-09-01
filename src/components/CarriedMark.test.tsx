import { render, type RenderResult } from '@testing-library/react-native';

import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { CarriedMark, CLEARED_ANNOUNCEMENT, CLEARED_TAG } from './CarriedMark';

// Same RTL adaptation every component test in this repo notes: `render` is async and its
// `root` is a test-renderer `TestInstance` exposing `queryAll(predicate)` over HOST elements
// only — a composite component (`SymbolView` itself) never appears as its own node.
//
// `t.root` is INCLUDED in the sweep, as `EntryIcon.test.tsx`'s own copy is and for the reason
// it records: `queryAll` walks descendants and never returns the instance it is called on, and
// this component renders the symbol as its own outermost element — so the one node that
// matters would be the one node the query could never see.
//
// The `SymbolModule` match is what separates "a real platform symbol" from "some drawn
// approximation of one": a hand-rolled glyph, a PNG or a `Text` character would never produce
// a `SymbolModule`-named host node at all, and §0.6 asks for the real thing ("drawn, not
// typed", for the reason a typed `↵` renders as tofu in a face that has no such code point).
function symbolsIn(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter(
    (n) => typeof n.type === 'string' && n.type.includes('SymbolModule'),
  );
}

// §0.6: the mark is DRAWN. The name is asserted rather than merely "a symbol appeared",
// because a return arrow is the one thing this mark can be — an arrow pointing anywhere else
// says something different about where the value came from, and every other assertion in this
// file would pass just as well for `arrow.right`.
it('draws a real return symbol, resolved through to the native layer', async () => {
  const t = await render(<CarriedMark scheme="dark" />);
  const [symbol] = symbolsIn(t);
  expect(symbol).toBeDefined();
  expect(symbol?.props.name).toBe('return');
});

// The sheet's own 16 pt slot, and the size a caller may override for a line that is not a
// field row (the form's carried caption asks for 12 against its 11 px text). Both, side by
// side, because a component that ignored the prop would pass either one alone.
it('draws at the sheet’s 16, and at whatever a caller asks for instead', async () => {
  const standard = await render(<CarriedMark scheme="dark" />);
  expect(symbolsIn(standard)[0]?.props.size).toBe(16);

  const smaller = await render(<CarriedMark scheme="dark" size={12} />);
  expect(symbolsIn(smaller)[0]?.props.size).toBe(12);
});

// §0.1: colour encodes depth and nothing else, so this is muted ink — and §4.1 puts the
// token-to-property binding in the sheet rather than in the component, which is what
// `carriedMarkInk` is. Both themes, because a mark hard-coded to one scheme's muted ink would
// be invisible against the other's ground and this component takes `scheme` for exactly that.
it.each(['dark', 'light'] as const)('takes its ink from the %s sheet, never a literal', async (scheme) => {
  const t = await render(<CarriedMark scheme={scheme} />);
  expect(symbolsIn(t)[0]?.props.tintColor).toBe(makeStyles(scheme).carriedMarkInk.color);
  // ...and that style really is the muted token rather than something that merely differs per
  // scheme: a mark in full `fg` would out-shout the value it qualifies.
  expect(makeStyles(scheme).carriedMarkInk.color).toBe(themeFor(scheme).fgMuted);
});

it('draws nothing outside its own treatment (§0.4/§0.1)', async () => {
  const t = await render(<CarriedMark scheme="light" />);
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
});

// The tag this module owns beside the mark. Written out here rather than imported into the
// assertion, which would compare the constant with itself: what is pinned is the em dash, the
// word, and the space between them — the reading §0.6 asks the row for.
it('spells the cleared tag as an em dash and the word, and says only the word out loud', () => {
  expect(CLEARED_TAG).toBe('— cleared');
  expect(CLEARED_ANNOUNCEMENT).toBe('cleared');
  // The announcement is the tag minus its typography, not a second wording that could drift
  // from it — a screen reader and a diver must be told the same thing.
  expect(CLEARED_TAG.endsWith(CLEARED_ANNOUNCEMENT)).toBe(true);
});

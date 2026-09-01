import { render, type RenderResult } from '@testing-library/react-native';

import { CONDITION_SCALE_VALUES, type ConditionLevel } from '../domain/types';
import { themeFor } from '../theme/resolve';
import { CurrentIcon, SurgeIcon } from './ConditionMarks';

// `EntryIcon.test.tsx`'s harness — see it for why a `SymbolModule`-named host node is what
// tells a real SF Symbol from a drawn approximation.
function symbolsIn(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter(
    (n) => typeof n.type === 'string' && n.type.includes('SymbolModule'),
  );
}

const INK = themeFor('dark').fg;
const SCHEME = 'dark';

// --- The claim §0.6 actually makes about these marks ---
//
// "The marks *encode the scale in themselves* — waves grow in amplitude, current arrows
// accumulate one way, surge two ways, visibility bars count up. Nothing has to be memorised,
// so nothing is a legend."
//
// For these two that claim is arithmetic and can therefore be tested rather than admired: the
// number of symbols IS the level. A mark that drew one arrow for every level would satisfy
// "current has an icon" and would be exactly the flat set of glyphs §0.6 rules out — the diver
// would have to memorise which arrow meant strong, which is a legend.
describe.each([
  ['CurrentIcon', CurrentIcon],
  ['SurgeIcon', SurgeIcon],
] as const)('%s', (_name, Mark) => {
  it.each(CONDITION_SCALE_VALUES)('draws exactly one symbol per level, at level %s', async (level) => {
    const t = await render(<Mark level={level} tintColor={INK} scheme={SCHEME} />);
    expect(symbolsIn(t)).toHaveLength(level);
  });

  // Level 0 is *None* on both scales, and §0.6 gives no mark to a value whose meaning is the
  // absence of the thing. Asserted as "nothing rendered at all" rather than "no symbols":
  // an empty wrapper `View` would leave the chip's label pushed off-centre against its three
  // neighbours by a gap nobody can see, which the weaker assertion would pass.
  it('draws nothing whatsoever at level 0, where the reading is that there was none', async () => {
    const t = await render(<Mark level={0} tintColor={INK} scheme={SCHEME} />);
    expect(t.toJSON()).toBeNull();
  });

  // The count is the mark, so every copy has to be the SAME mark: three different arrows
  // would be a picture rather than a quantity.
  it('repeats one symbol rather than drawing three different ones', async () => {
    const t = await render(<Mark level={3} tintColor={INK} scheme={SCHEME} />);
    const names = symbolsIn(t).map((n) => JSON.stringify(n.props.name));
    expect(new Set(names).size).toBe(1);
  });

  // §0.6's chip rule, on every copy: a mark inverts with the label beside it. Checked on all
  // three symbols rather than the first, since a loop that tinted only the head of the list
  // would leave two arrows invisible on the selected chip.
  it('draws every copy in the ink it is handed', async () => {
    const inverted = themeFor('dark').actionFg;
    const t = await render(<Mark level={3} tintColor={inverted} scheme={SCHEME} />);
    expect(symbolsIn(t)).toHaveLength(3);
    for (const symbol of symbolsIn(t)) expect(symbol.props.tintColor).toBe(inverted);
  });
});

// **The two marks are different symbols, and that is not cosmetic.** A current carries you one
// way; a surge moves you back and forth. If both rows drew the same arrow, "Current: strong"
// and "Surge: strong" would be three-of-the-same-thing on two adjacent rows and the mark would
// stop distinguishing the field it is attached to — which is exactly the argument that rules a
// repeated wave out for Waves (see `ConditionMarks.tsx`'s header). So the glyph carries the
// distinction, and this is what says so.
it('gives the surge a different symbol from the current, so the two rows are told apart by their marks', async () => {
  const current = await render(<CurrentIcon level={2} tintColor={INK} scheme={SCHEME} />);
  const surge = await render(<SurgeIcon level={2} tintColor={INK} scheme={SCHEME} />);
  expect(symbolsIn(current)[0]?.props.name).not.toEqual(symbolsIn(surge)[0]?.props.name);
});

it.each([
  [CurrentIcon, 'arrow.right'],
  [SurgeIcon, 'arrow.left.arrow.right'],
] as const)('resolves to a real SF Symbol rather than a drawn approximation', async (Mark, name) => {
  const t = await render(<Mark level={1} tintColor={INK} scheme={SCHEME} />);
  expect(symbolsIn(t)[0]?.props.name).toBe(name);
});

// A level this build has never heard of — an M2 sync row from a client with a wider scale,
// which §10 keeps rather than refuses — must not turn into a hundred arrows or a negative
// loop. It draws nothing, and the form says the number in words beside it (`outOfScaleNote`).
it('never draws more marks than the scale has levels, however high the stored value', async () => {
  const top = CONDITION_SCALE_VALUES[CONDITION_SCALE_VALUES.length - 1] as number;
  const high = await render(<CurrentIcon level={9 as ConditionLevel} tintColor={INK} scheme={SCHEME} />);
  expect(symbolsIn(high)).toHaveLength(top);

  // And the other end, which a bare `Array.from({ length })` would throw on rather than
  // render: a negative level draws nothing at all.
  const negative = await render(<CurrentIcon level={-2 as ConditionLevel} tintColor={INK} scheme={SCHEME} />);
  expect(negative.toJSON()).toBeNull();
});

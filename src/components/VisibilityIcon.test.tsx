import { render, type RenderResult } from '@testing-library/react-native';
import { type ColorValue } from 'react-native';

import { VISIBILITY_VALUES } from '../domain/types';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { VisibilityIcon } from './VisibilityIcon';

const SCHEME = 'dark';
const styles = makeStyles(SCHEME);

/** Every bar this mark drew, matched on the one style all of them carry — the same
 * `styles.ratingDot` match `DiveRow.test.tsx` uses for the rating, and for the same reason: a
 * match on the shared base style cannot be satisfied by something that merely looks like a
 * bar. `t.root` is included because `queryAll` never returns the instance it is called on. */
function barsIn(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter(
    (n) => n.type === 'View' && [n.props?.style].flat(3).includes(styles.visibilityBar),
  );
}

// --- §0.6: "visibility bars count up" ---
//
// The claim is arithmetic, so it is tested rather than admired: the number of bars IS the
// level. A mark drawing three bars for every value would satisfy "visibility has an icon" and
// would be exactly the flat set of glyphs §0.6 rules out, since the diver would have to
// memorise which picture meant *low*.
it.each([
  ['high', 3],
  ['average', 2],
  ['low', 1],
] as const)('draws %s as its own number of bars', async (visibility, bars) => {
  const t = await render(<VisibilityIcon visibility={visibility} tintColor={themeFor(SCHEME).fg} scheme={SCHEME} />);
  expect(barsIn(t)).toHaveLength(bars);
});

// Swept over the domain's own vocabulary rather than the three rows above, so a fourth level
// added to `VISIBILITY_VALUES` fails here instead of silently drawing nothing. Every level has
// a mark: unlike Waves, there is no level of visibility that resists one.
it('gives every visibility the domain declares a mark, and no two of them the same count', async () => {
  const counts: number[] = [];
  for (const visibility of VISIBILITY_VALUES) {
    const t = await render(<VisibilityIcon visibility={visibility} tintColor={themeFor(SCHEME).fg} scheme={SCHEME} />);
    const bars = barsIn(t).length;
    expect(bars).toBeGreaterThan(0);
    counts.push(bars);
  }
  expect(new Set(counts).size).toBe(VISIBILITY_VALUES.length);
});

// The second half of "counts up", and the half a bar *count* alone does not give: each added
// bar is taller than the last, which is what makes the mark read as signal strength rather
// than as a fence. Read off the sheet's own three height steps in the order they are drawn —
// a mark whose bars were all one height, or descending, would still pass the count assertions
// above while saying the opposite of what the scale means.
it('draws its bars ascending in height, which is what makes it read as more rather than as many', async () => {
  const t = await render(<VisibilityIcon visibility="high" tintColor={themeFor(SCHEME).fg} scheme={SCHEME} />);
  const heights = barsIn(t).map((n) => {
    const worn = [n.props?.style].flat(3);
    if (worn.includes(styles.visibilityBarTall)) return styles.visibilityBarTall.height;
    if (worn.includes(styles.visibilityBarMid)) return styles.visibilityBarMid.height;
    return styles.visibilityBarShort.height;
  });
  expect(heights).toHaveLength(3);
  expect(heights).toEqual([...heights].sort((a, b) => a - b));
  // ...and they are genuinely three different heights, not three equal ones that sort happily.
  expect(new Set(heights).size).toBe(3);
});

// §0.6's chip rule: the mark takes the ink of the label beside it, so it inverts on the chip
// the diver picked. This mark cannot take the ink directly — it is a `View`, and painting a
// handed-in colour would trip the graphics guard (`VisibilityIcon.tsx`'s `tintColor` docblock
// explains at length) — so it resolves the ink back to the sheet's own prepared style. That
// indirection is exactly the thing that could silently stop working: a wrong comparison would
// simply always pick the unselected ink, and every bar would vanish on the selected chip.
it('paints its bars in the ink it is handed, on the selected chip as well as off it', async () => {
  // Read off the sheet exactly as `OptionChips` reads it — the same cast that component makes
  // on the same two styles, for the same reason: `TextStyle['color']` is optional in the type
  // and never absent in these two.
  const plain = await render(
    <VisibilityIcon visibility="high" tintColor={styles.formChipText.color as ColorValue} scheme={SCHEME} />,
  );
  for (const bar of barsIn(plain)) {
    expect([bar.props?.style].flat(3)).toContain(styles.visibilityBarInk);
  }

  const inverted = await render(
    <VisibilityIcon visibility="high" tintColor={styles.formChipTextSelected.color as ColorValue} scheme={SCHEME} />,
  );
  for (const bar of barsIn(inverted)) {
    expect([bar.props?.style].flat(3)).toContain(styles.visibilityBarInkSelected);
  }
  // The two inks are actually different, so the assertions above are not both satisfiable by
  // one style — the failure that would make this whole test vacuous.
  expect(styles.visibilityBarInk).not.toEqual(styles.visibilityBarInkSelected);
});

// Every style on every bar comes from `makeStyles`, which is what keeps this mark legal under
// the §0.4/§0.1 graphics guard that sweeps the dive form (`src/testing/unexpectedGraphics.ts`).
// The tempting implementation — a computed `{ height: 4 + i * 4 }` — would render identically
// and trip that guard, so this pins the property rather than the appearance.
it('wears only styles the sheet handed out, never a literal composed here', async () => {
  const t = await render(<VisibilityIcon visibility="high" tintColor={themeFor(SCHEME).fg} scheme={SCHEME} />);
  const known = Object.values(styles) as unknown[];
  for (const bar of barsIn(t)) {
    for (const entry of [bar.props?.style].flat(3).filter(Boolean)) {
      expect(known).toContain(entry);
    }
  }
});

import { render, type RenderResult } from '@testing-library/react-native';

import { RATING_MAX, RATING_VALUES } from '../domain/types';
import { makeStyles } from '../theme/styles';
import { RatingDot, RatingDots, filledDotCount } from './RatingDots';

const SCHEME = 'dark';
const styles = makeStyles(SCHEME);

/** Every dot, matched on the base style each one carries whatever its size or fill. Two bases
 * exist (`ratingDot`, `ratingDotField`) and both are swept, because the point of this file is
 * that they are the same mark at two scales. */
function dotsIn(t: RenderResult) {
  if (!t.root) return [];
  return [t.root, ...t.root.queryAll(() => true)].filter((n) => {
    if (n.type !== 'View') return false;
    const worn = [n.props?.style].flat(3);
    return worn.includes(styles.ratingDot) || worn.includes(styles.ratingDotField);
  });
}

function isFilled(node: ReturnType<typeof dotsIn>[number]) {
  return [node.props?.style].flat(3).includes(styles.ratingDotFilled);
}

// --- §0.6's actual rule, which is about SIZE and nothing else ---
//
// "`●` and `○` are different sizes in almost every typeface, so a rating rendered from glyphs
// looks broken; draw both as circles of one diameter, filled or outlined."
//
// So the guarantee is not "there are dots": it is that a filled dot and an empty one are the
// same circle. That survives only if `ratingDotFilled` adds a fill and *nothing else* — the
// moment it carries a width, a radius or a border of its own, "3 of 5" goes back to looking
// broken, which is the exact failure the design bothered to write down.
it('makes a filled mark differ from an empty one by fill alone, at either size', () => {
  expect(Object.keys(styles.ratingDotFilled)).toEqual(['backgroundColor']);
  // Which means it composes on either base without changing the geometry of either.
  for (const base of [styles.ratingDot, styles.ratingDotField] as const) {
    expect(base.width).toBe(base.height);
    expect(base.borderRadius).toBe(base.width / 2);
  }
});

// The two sizes are genuinely two sizes — a variant that silently resolved to the same style
// would make the form's dots 7 px specks inside 48 dp targets and pass every other assertion
// here.
it('draws the field variant larger than the row variant, and the row variant by default', async () => {
  const row = await render(<RatingDot filled scheme={SCHEME} />);
  expect([dotsIn(row)[0]?.props?.style].flat(3)).toContain(styles.ratingDot);

  const field = await render(<RatingDot filled scheme={SCHEME} variant="field" />);
  expect([dotsIn(field)[0]?.props?.style].flat(3)).toContain(styles.ratingDotField);

  expect(styles.ratingDotField.width).toBeGreaterThan(styles.ratingDot.width);
});

// The read-only row: exactly `RATING_MAX` marks, filled up to the rating. This is also what
// `DiveRow.test.tsx` asserts through a real dive row — kept here as well because the component
// moved out of that file in M1h and the row is no longer its only caller.
it.each(RATING_VALUES)('draws RATING_MAX marks with %s of them filled', async (rating) => {
  const t = await render(<RatingDots rating={rating} scheme={SCHEME} />);
  expect(dotsIn(t)).toHaveLength(RATING_MAX);
  expect(dotsIn(t).filter(isFilled)).toHaveLength(rating);
});

// DESIGN.md §10 keeps `rating` unclamped in the column, so a value from a client with a wider
// scale is a runtime reality rather than a hypothetical. What must never happen is the drawing
// following it: nine dots in a five-dot row, or a negative count throwing mid-render.
it('clamps what is DRAWN for a rating outside the scale, without touching the value', () => {
  expect(filledDotCount(9)).toBe(RATING_MAX);
  expect(filledDotCount(-3)).toBe(0);
  // Rounded rather than truncated, so a 3.5 from an importer lands on a real mark count.
  expect(filledDotCount(3.5)).toBe(4);
});

it('never draws more or fewer than RATING_MAX marks, whatever it is handed', async () => {
  for (const rating of [0, 9, -3, 3.5]) {
    const t = await render(<RatingDots rating={rating} scheme={SCHEME} />);
    expect(dotsIn(t)).toHaveLength(RATING_MAX);
  }
});

import { render, type RenderResult } from '@testing-library/react-native';

import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { makeStyles, RMV_SPARK_STEPS } from '../theme/styles';
import { depthScale } from '../theme/tokens';
import { RmvSparkline } from './RmvSparkline';

// The same RTL adaptation `DepthLegend.test.tsx` beside this one notes: `root.queryAll` walks
// descendants only and never returns the instance it is called on, so the subject's own root
// is included explicitly.
function nodesIn(t: RenderResult) {
  return t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
}

function hasStyle(node: { props?: { style?: unknown } }, style: unknown): boolean {
  return [node.props?.style].flat(5).includes(style);
}

/**
 * **The drawing, read as numbers: how many cells tall each bar is, in the order they are
 * drawn.** Every assertion about the shape goes through this rather than through a snapshot,
 * because what has to be true of this component is a relationship between the values it was
 * handed and the heights it drew — and a snapshot records heights without ever claiming they
 * came from anywhere.
 *
 * Read off the sheet's own `rmvSparkBar`/`rmvSparkCell` (`makeStyles(scheme)`) rather than off
 * a test id, exactly as `StatsScreen.test.tsx` reads its counters off `formFieldRow`: a
 * component that stopped drawing from the sheet — an inline `{ height }` composed at render,
 * which is the shape §4.1 and `unexpectedGraphics` both refuse — would find no bars here at
 * all rather than quietly passing.
 */
function barsIn(t: RenderResult, scheme: 'dark' | 'light'): number[] {
  const styles = makeStyles(scheme);
  return nodesIn(t)
    .filter((n) => n.type === 'View' && hasStyle(n, styles.rmvSparkBar))
    .map((bar) => bar.queryAll((n) => n.type === 'View' && hasStyle(n, styles.rmvSparkCell)).length);
}

function labelIn(t: RenderResult, scheme: 'dark' | 'light'): string | undefined {
  const styles = makeStyles(scheme);
  const row = nodesIn(t).find((n) => n.type === 'View' && hasStyle(n, styles.rmvSparkline));
  return row?.props?.accessibilityLabel as string | undefined;
}

// **§3's RMV drawn, and the failure it can have is not "it looks wrong".** It is a shape that
// keeps being drawn after the series behind it stops meaning what it did: a dive with no gas
// appearing as a bar, a window drawn backwards, a difference the app calls "steady" drawn as a
// cliff. Everything below asks whether the drawing is still the dives it claims to be.

it('draws one bar per dive, oldest at the leading edge, measured from zero', async () => {
  // Handed oldest-first, which is the order `rmvTrend` returns its window in. The values are
  // chosen so their proportions of the tallest land exactly on the ladder — 18 fills the track,
  // 9 is half of it, 3 a sixth — and the expectation is written as those proportions rather
  // than as four numbers, because what is being asserted is that a bar is its share of the
  // biggest one. Of the biggest one, not of the spread: two nearly equal dives draw as two
  // nearly equal bars and so cannot contradict a Trend row reading "steady".
  const t = await render(<RmvSparkline values={[18, 9, 3, 18]} scheme="dark" />);
  expect(barsIn(t, 'dark')).toEqual([RMV_SPARK_STEPS, RMV_SPARK_STEPS / 2, RMV_SPARK_STEPS / 6, RMV_SPARK_STEPS]);
});

// The same series drawn backwards is a different claim about a diver's diving — improving
// rather than getting worse — so the order the caller hands over is the order drawn, and
// nothing here sorts.
it('draws the series in the order it was given, not sorted', async () => {
  const t = await render(<RmvSparkline values={[3, 9, 18]} scheme="dark" />);
  expect(barsIn(t, 'dark')).toEqual([RMV_SPARK_STEPS / 6, RMV_SPARK_STEPS / 2, RMV_SPARK_STEPS]);
});

/**
 * **A bar that rounds to nothing would be a dive that is not there**, and those two must never
 * look alike: this component's whole population rule is that a dive with no RMV contributes no
 * bar, so an invisible bar for a dive that *is* in the window says the opposite of what
 * happened. One cell is the floor — present, and visibly the shortest.
 */
it('never draws a dive as a bar of no height, however small beside the rest', async () => {
  const t = await render(<RmvSparkline values={[0.1, 40]} scheme="dark" />);
  expect(barsIn(t, 'dark')).toEqual([1, RMV_SPARK_STEPS]);
});

/**
 * **The case a fixture of complete dives never reaches**, and the ordinary state of every
 * logbook until somebody records a cylinder size: no dive has an RMV at all. There is no
 * series, so there is no drawing — not an empty track, not a baseline, not six bars of one
 * cell. The row it lives in says the same thing in words, with an em dash.
 */
it('draws nothing at all when no dive has an RMV', async () => {
  const t = await render(<RmvSparkline values={[]} scheme="dark" />);
  expect(barsIn(t, 'dark')).toEqual([]);
  expect(nodesIn(t).some((n) => hasStyle(n, makeStyles('dark').rmvSparkline))).toBe(false);
});

// One dive is not a shape. Normalised against itself it is always a full bar, so it would say
// "as high as it gets" about a logbook with one gas dive in it — §0.4's rule that the app never
// draws a shape it does not have, one step further in. The figure beside it still shows.
it('draws nothing from a single dive, which has no shape to show', async () => {
  const t = await render(<RmvSparkline values={[14.6]} scheme="dark" />);
  expect(barsIn(t, 'dark')).toEqual([]);
});

/**
 * **A value that is not a real RMV is dropped, rather than blanking or flattening the row.**
 * `rmv` (domain/derived.ts) already refuses each of these, so this is the second line of
 * defence every guard in that file has — and it earns its place: a `NaN` makes the series
 * maximum `NaN`, which rounds every bar to nothing while the figure beside it still reads a
 * number, and an `Infinity` makes every real dive the shortest possible bar, which is a flat
 * line a diver would read as five identical dives.
 */
it('drops a value that is not a real RMV instead of drawing the whole row wrong', async () => {
  const nan = await render(<RmvSparkline values={[9, Number.NaN, 18]} scheme="dark" />);
  expect(barsIn(nan, 'dark')).toEqual([RMV_SPARK_STEPS / 2, RMV_SPARK_STEPS]);

  const infinite = await render(<RmvSparkline values={[9, Number.POSITIVE_INFINITY, 18]} scheme="dark" />);
  expect(barsIn(infinite, 'dark')).toEqual([RMV_SPARK_STEPS / 2, RMV_SPARK_STEPS]);

  // A breathing diver cannot have an RMV of zero or less — `rmv`'s own words — and a zero
  // would be the one value that draws as nothing at all.
  const zero = await render(<RmvSparkline values={[0, -3, 9, 18]} scheme="dark" />);
  expect(barsIn(zero, 'dark')).toEqual([RMV_SPARK_STEPS / 2, RMV_SPARK_STEPS]);
});

/**
 * **A row of unlabelled bars is a screen-reader dead end**, and unlike the depth legend's
 * swatches — whose six ranges are written out beside them — these bars are the only place the
 * per-dive figures appear at all. So the shape speaks its own series, in the order it drew it,
 * in the unit `formatRmv` spells.
 */
it('says its series aloud, oldest to newest, for a diver who cannot see it', async () => {
  const t = await render(<RmvSparkline values={[18.24, 14.6]} scheme="dark" />);
  expect(labelIn(t, 'dark')).toBe('Each dive, oldest to newest: 18.2 l/min, 14.6 l/min');
});

/**
 * **It is not tappable, and nothing about it may suggest otherwise** — a chart that looks
 * interactive and is not is worse than one that plainly is not. No `Pressable` (which is what
 * `onPress`/`onStartShouldSetResponder` would show as here), and no button role: §0.5's 48 dp
 * floor is about things a wet thumb has to hit, and this is a figure being read.
 */
it('is a figure to read rather than a control to press', async () => {
  const t = await render(<RmvSparkline values={[20, 10]} scheme="dark" />);
  for (const node of nodesIn(t)) {
    expect(node.props?.onPress).toBeUndefined();
    expect(node.props?.accessibilityRole).toBeUndefined();
  }
});

/**
 * **§0.1's sweep.** Colour encodes depth and an RMV is not a depth, so unlike the deepest-dive
 * figure one group up — which at least *is* a depth and still takes no band (§10, twice) —
 * there is not even a band this could borrow. `unexpectedGraphics` carries the other half: a
 * bar whose height was composed inline rather than counted out of the sheet is exactly the
 * "dropped-in chart" that guard exists to report, and it would be reported here.
 */
it('paints nothing from the depth scale and nothing the sheet did not hand out', async () => {
  for (const scheme of ['dark', 'light'] as const) {
    const t = await render(<RmvSparkline values={[20, 14, 12, 18, 11]} scheme={scheme} />);
    expect(unexpectedGraphics(t, scheme)).toEqual([]);
    const painted = nodesIn(t)
      .flatMap((n) => [n.props?.style].flat(5))
      .filter((entry): entry is { backgroundColor?: unknown } => typeof entry === 'object' && entry !== null)
      .map((entry) => entry.backgroundColor)
      .filter((value): value is string => typeof value === 'string');
    for (const colour of [...depthScale.light, ...depthScale.dark]) {
      expect(painted).not.toContain(colour);
    }
    // ...and it did paint something, so the sweep above is looking at a drawn row rather than
    // at an empty one.
    expect(painted.length).toBeGreaterThan(0);
  }
});

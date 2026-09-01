// `EmptyState` reads `useSafeAreaInsets()` — the clearance under its action is the device's,
// never a constant (§10, M1h) — and the real hook throws without a Provider ancestor. The
// package's own Jest mock reports zero insets, which is what every test here wants: what the
// screen composes out of a real device inset is DivesScreen.test.tsx's assertion, since that is
// where the two live together. Imported first and named `mock…` for the babel-plugin-jest-hoist
// reason the screen tests record.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { UNIT_SYSTEMS } from '../format/units';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { depthScale } from '../theme/tokens';
import { EmptyState } from './EmptyState';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

function nodesIn(t: RenderResult) {
  return t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
}

/** Everything the screen says, joined without separators — the reason lines interleave text
 * and interpolated figures, and a join on spaces would put a space inside "6 m". */
function textIn(t: RenderResult): string {
  return nodesIn(t)
    .filter((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string')
    .join('');
}

function markIn(t: RenderResult) {
  const [node] = nodesIn(t).filter((n) => n.type === 'Image');
  if (!node) throw new Error('EmptyState drew no mark');
  return node;
}

function actionIn(t: RenderResult) {
  const [node] = nodesIn(t).filter((n) => n.props?.accessibilityRole === 'button');
  if (!node) throw new Error('EmptyState drew no primary action');
  return node;
}

// ---------------------------------------------------------------------------------------
// **The first-run screen** (DESIGN.md §0.6, M1h, the owner's design). It held one sentence
// over a button until this milestone; what it says now is the one thing no other screen in
// Ponor can say — §0.1, the rule the whole palette rests on, which was explained nowhere.
// ---------------------------------------------------------------------------------------

it('says what the app promises and why the scale is the sequence it is', async () => {
  const t = await render(<EmptyState scheme="dark" system="metric" onPress={() => {}} />);
  const text = textIn(t);
  // §0.6's cluster-label treatment, and the state of the logbook in the diver's own words.
  expect(text).toContain('NOTHING LOGGED YET');
  // §1's "Works at sea", said to a diver rather than to a planner.
  expect(text).toContain('Ponor keeps every dive on this phone.');
  expect(text).toContain('No account, no upload, works with the boat out of signal.');
  // The rule, and then the physics that makes it a rule rather than a palette.
  expect(text).toContain('colour is depth');
  expect(text).toContain('nothing else in Ponor is coloured');
  expect(text).toContain('the scale follows the light');
  expect(text).toContain('Log your first dive');
});

// **The mark, and the reason it is not the icon.** §0.3 strokes this shape in the depth
// gradient ON THE APP ICON. Inside the interface that same gradient is colour used as *brand*,
// and §0.1 says colour encodes depth and nothing else — so the screen whose entire job is
// teaching that rule would be breaking it in its own largest element. Matched on the asset,
// because a `require` of `icon.png` is the exact edit this is written against and it would look
// completely right on a dark ground.
it('draws the monochrome mark, not the gradient the icon is built from', async () => {
  const t = await render(<EmptyState scheme="dark" system="metric" onPress={() => {}} />);
  expect(JSON.stringify(markIn(t).props.source)).toContain('mark-mono.png');
});

// ...and the paint is the sheet's, entirely. `emptyStateMark` is the one place the mark's ink
// and its half strength are decided, which is what makes the rule above enforceable in a single
// edit rather than at every call site; an inline tint here would be §0.1 relocated to a
// component where no guard is looking. Asserted as "wears this style and nothing else", in both
// schemes, because the ink has to change with the ground and the rule must not.
it('takes its ink and its strength from the sheet, in both themes', async () => {
  for (const scheme of ['dark', 'light'] as const) {
    const t = await render(<EmptyState scheme={scheme} system="metric" onPress={() => {}} />);
    const style = [markIn(t).props.style].flat(5).filter(Boolean) as unknown[];
    expect(style).toEqual([makeStyles(scheme).emptyStateMark]);
    // The ink is the theme's, and it is monochrome: not one of the six colours §0.1 reserves
    // for depth. This is the assertion a "restored" gradient — or a mark tinted in band 1's
    // orange because it looked warmer — fails.
    const mark = makeStyles(scheme).emptyStateMark as Record<string, unknown>;
    expect(mark.tintColor).toBe(themeFor(scheme).fg);
    expect((depthScale[scheme] as readonly string[]).includes(String(mark.tintColor))).toBe(false);
  }
});

// The §0.4/§0.1 guard over the whole composition, in the scheme that actually rendered. It
// passes only because every hue on this screen is either a token from `makeStyles` or a band
// colour from `theme/depth.ts` — which, on this screen, is the claim being taught.
it('paints nothing outside the sheet and the depth scale, in either theme', async () => {
  for (const scheme of ['dark', 'light'] as const) {
    const t = await render(<EmptyState scheme={scheme} system="metric" onPress={() => {}} />);
    expect(unexpectedGraphics(t, scheme)).toEqual([]);
  }
});

// **The caption cannot contradict the bars above it**, and in imperial that is not a detail:
// the boundaries a first-run diver reads off the legend are 0–20, 20–39, … 131+ ft, so a
// sentence explaining them in metres would be one screen teaching in two unit systems at once.
// The two depths come from `theme/depth.ts` and are formatted by the same module the labels
// are, which is the only reason this can be asked at all.
it('explains the scale in the units the legend is labelled in', async () => {
  const metric = await render(<EmptyState scheme="dark" system="metric" onPress={() => {}} />);
  expect(textIn(metric)).toContain('red fades out by 6 m, blue carries past 40 m');

  const imperial = await render(<EmptyState scheme="dark" system="imperial" onPress={() => {}} />);
  const text = textIn(imperial);
  expect(text).toContain('red fades out by 20 ft, blue carries past 131 ft');
  // And the metric figures are gone rather than merely joined by imperial ones — a caption
  // holding both would read as two different scales.
  expect(text).not.toContain('6 m');
  expect(text).not.toContain('40 m');
});

// The legend itself is `DepthLegend.test.tsx`'s subject; what this pins is that the empty state
// actually shows it, in the diver's system. Without it the screen states a rule and then does
// not demonstrate it, which is the one thing it exists for.
it('shows the scale it is explaining, in the diver own system', async () => {
  for (const system of UNIT_SYSTEMS) {
    const t = await render(<EmptyState scheme="dark" system={system} onPress={() => {}} />);
    const bar = makeStyles('dark').depthLegendBar as unknown;
    const bars = nodesIn(t).filter((n) => n.type === 'View' && [n.props?.style].flat(5).includes(bar));
    expect(bars).toHaveLength(depthScale.dark.length);
  }
});

// **The action is a sibling of the scroll, not a child of it** (§0.5, and M1h's own fix). Five
// elements now sit above a button whose distance from the bottom edge is the device's to
// decide; on a short screen the overflow has to go somewhere, and the one place it may not go
// is the button. Inside the scroll, "Log your first dive" would scroll — off a screen where
// §0.6 deliberately leaves no capsule, so it is a first-run diver's only way into the form.
// Asserted by walking the tree upward, because the two arrangements render identically on a
// tall phone and differ only where nobody would think to look.
it('keeps the primary action out of the scroll, so it cannot scroll away', async () => {
  const t = await render(<EmptyState scheme="dark" system="metric" onPress={() => {}} />);
  const scrolls = nodesIn(t).filter((n) => typeof n.type === 'string' && n.type.includes('ScrollView'));
  expect(scrolls.length).toBeGreaterThan(0);

  let node = actionIn(t).parent;
  const ancestors = [];
  while (node) {
    ancestors.push(node);
    node = node.parent;
  }
  expect(ancestors.some((a) => scrolls.includes(a))).toBe(false);
  // ...and the mark IS inside it, so this is not passing because nothing scrolls at all.
  let markNode = markIn(t).parent;
  const markAncestors = [];
  while (markNode) {
    markAncestors.push(markNode);
    markNode = markNode.parent;
  }
  expect(markAncestors.some((a) => scrolls.includes(a))).toBe(true);
});

it('opens the form when that action is pressed', async () => {
  const onPress = jest.fn();
  const t = await render(<EmptyState scheme="dark" system="metric" onPress={onPress} />);
  await fireEvent.press(actionIn(t));
  expect(onPress).toHaveBeenCalledTimes(1);
});

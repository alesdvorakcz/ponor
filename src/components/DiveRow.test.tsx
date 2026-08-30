import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { dive } from '../domain/diveFixture';
import { depthColor } from '../theme/depth';
import { DiveRow } from './DiveRow';

// Adapted from the brief's react-test-renderer-shaped example to the API the installed
// @testing-library/react-native@14 actually exposes:
//   - `render` is async (it wraps its own `act()`) and returns `{ root, ... }` where
//     `root` is a `test-renderer` `TestInstance`, not a classic react-test-renderer one.
//   - That `TestInstance` has `queryAll(predicate)`, not `findAllByType`/`findByType`.
//   - Its tree holds host elements only. `Pressable` is a composite component and never
//     appears as a node — `root` for a `<Pressable>...</Pressable>` render is the `View`
//     Pressable renders internally, with responder props merged in but no literal
//     `onPress` prop to call directly. `fireEvent.press(root)` is the supported way to
//     trigger it; it walks the fiber tree to find the handler.
// The assertions below are unchanged from the brief.

function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

it('shows the dive number, site and depth', async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: 'Blue Hole', maxDepthM: 32.4 })} number={248} scheme="dark" onPress={() => {}} />,
  );
  const text = textIn(t).join(' ');
  expect(text).toContain('248');
  expect(text).toContain('Blue Hole');
  expect(text).toContain('32.4 m');
});

it('colours the depth by its band, not by the theme', async () => {
  const t = await render(
    <DiveRow dive={dive({ maxDepthM: 32.4 })} number={1} scheme="dark" onPress={() => {}} />,
  );
  const depthNode = textNodesOf(t).find((n) => String(n.children[0]).includes('32.4'));
  expect(depthNode).toBeDefined();
  expect(depthNode?.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ color: depthColor(32.4, 'dark') })]),
  );
});

it('renders a dive with nothing but a date, without placeholders or a crash', async () => {
  const t = await render(
    <DiveRow dive={dive({ date: '2026-08-16' })} number={1} scheme="dark" onPress={() => {}} />,
  );
  const text = textIn(t).join(' ');
  expect(text).not.toContain('null');
  expect(text).not.toContain('NaN');
  expect(text).not.toContain('undefined');
});

it('shows no dive number for a planned dive', async () => {
  const t = await render(
    <DiveRow dive={dive({ status: 'planned' })} number={undefined} scheme="dark" onPress={() => {}} />,
  );
  expect(textIn(t).join(' ')).not.toMatch(/#\d/);
});

it('draws no graphic for a dive, because no dive has a sample series', async () => {
  const t = await render(
    <DiveRow dive={dive({ maxDepthM: 32.4 })} number={1} scheme="dark" onPress={() => {}} />,
  );
  const svgs = t.root ? t.root.queryAll((n) => n.type === 'Svg') : [];
  expect(svgs).toHaveLength(0);
});

it('passes the dive id to onPress', async () => {
  const onPress = jest.fn();
  const d = dive({ id: 'abc' });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={onPress} />);
  if (!t.root) throw new Error('DiveRow did not render a root element');
  await fireEvent.press(t.root);
  expect(onPress).toHaveBeenCalledWith('abc');
});

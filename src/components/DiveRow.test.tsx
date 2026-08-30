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
  // `.join('')`, not `.join(' ')`: DepthValue (this task) now splits "32.4 m" across two
  // sibling Text nodes — the value and a nested, quieter unit — so the two arrive here as
  // separate array entries, "32.4" then " m" (the unit carries its own leading space, the
  // way RN renders adjacent Text with no separator of its own). `join(' ')` would insert a
  // second space that nothing on screen actually shows ("32.4  m") and break the
  // `toContain` below; `join('')` reconstructs exactly what's rendered, since sibling Text
  // nodes never gain a space RN didn't put there.
  const text = textIn(t).join('');
  expect(text).toContain('248');
  expect(text).toContain('Blue Hole');
  expect(text).toContain('32.4 m');
});

// Review task 7, Important #4: this row is the only route into a dive, and a Pressable
// carries no accessibilityRole on its own — a screen reader user heard the number, site
// and depth as three disconnected text fragments and was never told the row was
// actionable at all.
it('announces itself as a button, with a label composed from number, site and depth', async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: 'Blue Hole', maxDepthM: 32.4 })} number={248} scheme="dark" onPress={() => {}} />,
  );
  // DiveRow's own top-level element IS the Pressable's rendered host view here (this file's
  // own top comment) — read its props directly, the same way the "passes the dive id to
  // onPress" test below fires directly on `t.root` rather than searching for it.
  if (!t.root) throw new Error('DiveRow did not render a root element');
  expect(t.root.props.accessibilityRole).toBe('button');
  expect(t.root.props.accessibilityLabel).toBe('Dive 248, Blue Hole, 32.4 m');
});

// The number is omitted for a planned dive (§2.4: no number until completed) and depth is
// omitted for a dive that never recorded one (§1 — no form-shaming) — the label degrades
// the same way the row's own visible text does, rather than reading "Dive undefined" or
// leaving a trailing ", " where the missing piece would have been.
it("omits whichever label piece the row itself omits, for a planned dive with no depth", async () => {
  const t = await render(
    <DiveRow dive={dive({ siteName: 'Shore entry', status: 'planned' })} number={undefined} scheme="dark" onPress={() => {}} />,
  );
  if (!t.root) throw new Error('DiveRow did not render a root element');
  expect(t.root.props.accessibilityLabel).toBe('Shore entry');
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

// DESIGN.md §0.6: depth is the anchor of a dive row — the value that actually differs
// dive to dive, set larger than everything else so a column of dives reads as a column
// of aligned, colour-coded numbers rather than every element competing at one size.
it('sets the depth larger than the site name, so the row has an anchor', async () => {
  const d = dive({ siteName: 'Blue Hole', maxDepthM: 32.4 });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const sizeOf = (s: string) => {
    const node = textNodesOf(t).find((n) => String(n.children[0] ?? '').includes(s));
    return [node?.props.style].flat(3).filter(Boolean)
      .reduce((acc: number, st) => st?.fontSize ?? acc, 0);
  };
  expect(sizeOf('32.4')).toBe(20);
  expect(sizeOf('Blue Hole')).toBe(16);
  expect(sizeOf('32.4')).toBeGreaterThan(sizeOf('Blue Hole'));
});

it('gives the depth tabular figures so a column of dives aligns', async () => {
  const d = dive({ maxDepthM: 9.2 });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const node = textNodesOf(t).find((n) => String(n.children[0] ?? '').includes('9.2'));
  const style = [node?.props.style].flat(3).filter(Boolean);
  expect(style.some((s) => s?.fontVariant?.includes('tabular-nums'))).toBe(true);
});

// M1c task 1 review, Minor: this used to also assert `ellipsizeMode` is not `'head'`.
// diveSite's Text never sets ellipsizeMode at all, so that read undefined and the
// assertion passed unconditionally — it would only have failed had someone later written
// literally `ellipsizeMode="head"`, which says nothing about whether the name actually
// wraps. `numberOfLines` below is the real mechanism (RN wraps up to that many lines and
// only then truncates) and is the one assertion this test needs to isolate the guarantee.
it('lets a long site name wrap rather than truncate', async () => {
  const d = dive({ siteName: 'Šenkýřův lom u Zbraslavi nad Vltavou' });
  const t = await render(<DiveRow dive={d} number={1} scheme="dark" onPress={() => {}} />);
  const node = textNodesOf(t).find((n) => String(n.children[0] ?? '').includes('Šenkýřův'));
  expect(node?.props.numberOfLines).toBe(2);
});

// M1c task 3: DESIGN.md §3 now pins planned dives under "Up next" "with their date" — on
// screen today that section showed a site name and nothing else, the one omission that
// mattered for a section whose entire purpose is *when*.
it('shows a planned dive its date, since "Up next" is about when', async () => {
  const d = dive({ status: 'planned', date: '2026-09-05', siteName: 'Silfra' });
  const t = await render(<DiveRow dive={d} number={undefined} scheme="dark" onPress={() => {}} />);
  const text = textIn(t).join(' ');
  expect(text).toContain('5 Sep 2026');
  expect(text).not.toMatch(/#\d/);
});

// The more important half of this task: a logged dive's trip header already states the day
// ("BLUE HOLE · 16–18 Aug 2026", TripHeader.tsx) — repeating it on every row beneath would
// be redundant noise in the common case, the one this screen shows most often.
it('does not put the date on a logged dive row, where the trip header carries it', async () => {
  const d = dive({ status: 'logged', date: '2026-09-05', siteName: 'Silfra', timeIn: '09:00' });
  const t = await render(<DiveRow dive={d} number={7} scheme="dark" onPress={() => {}} />);
  const text = textIn(t).join(' ');
  expect(text).not.toContain('5 Sep 2026');
});

import { render, type RenderResult } from '@testing-library/react-native';

import { themeFor } from '../theme/resolve';
import { fonts } from '../theme/fonts';
import { DayStrip } from './DayStrip';

// Same adaptation DiveRow.test.tsx and ReorderControls.test.tsx already note: `render`
// wraps its own `act()` and is async; its `root` is a `test-renderer` `TestInstance`
// exposing `queryAll(predicate)`, not `findAllByType`.

function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function flatStyle(node: { props: { style?: unknown } } | undefined) {
  return [node?.props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
}

// The brief's own two tests, unchanged: DayStrip's whole job is to state the rule (§2.5,
// via DESIGN.md §0.6) rather than just gesture at "you can reorder" — a diver who later
// adds a time and watches the control vanish needs to already know why.
it('says why the day can be hand-ordered', async () => {
  const t = await render(<DayStrip date="2026-08-18" count={2} active={false} scheme="dark" onToggle={() => {}} />);
  const text = textIn(t).join(' ');
  expect(text).toContain('18 Aug 2026');
  expect(text).toContain('no times');
  expect(text).toContain('Reorder');
});

it('offers to leave the mode once it is on', async () => {
  const t = await render(<DayStrip date="2026-08-18" count={2} active scheme="dark" onToggle={() => {}} />);
  const text = textIn(t).join(' ');
  expect(text).toContain('Done');
  expect(text).not.toContain('Reorder');
});

// §0.6: "When active the strip takes theme.surface as its background so the mode is
// visible." A resting strip must NOT already carry that background — otherwise this
// couldn't fail against an implementation that always shows the surface fill, active or
// not, which would defeat the whole point of the mode being visually distinct.
it('takes the surface background only once active, not at rest', async () => {
  const resting = await render(
    <DayStrip date="2026-08-18" count={2} active={false} scheme="dark" onToggle={() => {}} />,
  );
  const active = await render(<DayStrip date="2026-08-18" count={2} active scheme="dark" onToggle={() => {}} />);
  if (!resting.root || !active.root) throw new Error('DayStrip did not render a root element');

  const restingStyle = flatStyle(resting.root);
  const activeStyle = flatStyle(active.root);
  expect(restingStyle.some((s) => s.backgroundColor === themeFor('dark').surface)).toBe(false);
  expect(activeStyle.some((s) => s.backgroundColor === themeFor('dark').surface)).toBe(true);
});

// §0.5's 48 dp tap-target floor, on the one pressable this component owns.
it("gives its action a 48 dp touch target, regardless of the strip's own height", async () => {
  const t = await render(<DayStrip date="2026-08-18" count={2} active={false} scheme="dark" onToggle={() => {}} />);
  const [action] = t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : [];
  if (!action) throw new Error('DayStrip did not render its action as a button');
  const style = flatStyle(action);
  const minHeight = style.reduce((acc: number, s) => (typeof s.minHeight === 'number' ? s.minHeight : acc), 0);
  expect(minHeight).toBeGreaterThanOrEqual(48);
});

// The sentence is data-ish metadata (task brief's Constraints: "Plex Mono"), same face as
// every other measurement in the app (§0.2) — not Archivo, the UI/display face.
it('sets its sentence in the mono data face, not the sans UI face', async () => {
  const t = await render(<DayStrip date="2026-08-18" count={2} active={false} scheme="dark" onToggle={() => {}} />);
  const node = textNodesOf(t).find((n) => String(n.children[0] ?? '').includes('18 Aug 2026'));
  const style = flatStyle(node);
  expect(style.some((s) => s.fontFamily === fonts.mono)).toBe(true);
  expect(style.some((s) => s.fontFamily === fonts.sans)).toBe(false);
});

// Every colour DayStrip uses must trace back to makeStyles(scheme) — monochrome, per the
// task brief's Constraints ("colour encodes depth and nothing else"). Proven the same way
// DiveRow.test.tsx proves DepthValue is the only coloured thing in a row: by scheme, not
// by depth — passing 'light' must change every colour this component shows.
it('recolours for the light scheme rather than carrying a fixed colour', async () => {
  const t = await render(<DayStrip date="2026-08-18" count={2} active scheme="light" onToggle={() => {}} />);
  if (!t.root) throw new Error('DayStrip did not render a root element');
  const style = flatStyle(t.root);
  expect(style.some((s) => s.backgroundColor === themeFor('light').surface)).toBe(true);
  expect(style.some((s) => s.backgroundColor === themeFor('dark').surface)).toBe(false);
});

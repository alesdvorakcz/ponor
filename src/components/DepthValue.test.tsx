import { render } from '@testing-library/react-native';

import * as display from '../format/display';
import { depthScale } from '../theme/tokens';
import { DepthValue } from './DepthValue';

// DESIGN.md §10: no CHECK constraint on any numeric dive field, so a negative
// max_depth_m is a runtime reality this component cannot rule out — a bad import or a
// future sync client can hand it one. depthBand/depthColor's throw-on-invalid contract
// is correct for a pure function (see theme/depth.test.ts), but a render path may not
// throw, so DepthValue must go through the null-safe depthColorOrNull instead and
// render nothing, the same way it already does for an unrecorded depth.
it('renders nothing for a negative depth, without a crash or a placeholder', async () => {
  const t = await render(<DepthValue metres={-5} scheme="dark" units="metric" />);
  expect(t.toJSON()).toBeNull();
});

// DESIGN.md §0.6: depth is set at 20 px in a row but 34 px on dive detail — `variant`
// is what lets the two call sites share one component instead of forking it.
it('sets the hero variant larger than the default row variant', async () => {
  const rowResult = await render(<DepthValue metres={32.4} scheme="dark" units="metric" />);
  const heroResult = await render(<DepthValue metres={32.4} scheme="dark" units="metric" variant="hero" />);
  // DepthValue renders a bare Text with no wrapper, so `t.root` for these renders IS
  // that outer Text node — `includeSelf: true` is required or queryAll (descendants
  // only by default) would see just the nested unit Text and miss the value node.
  const sizeOf = (t: typeof rowResult) => {
    const node = t.root?.queryAll((n) => n.type === 'Text', { includeSelf: true })
      .find((n) => String(n.children[0] ?? '').includes('32.4'));
    return [node?.props.style].flat(3).filter(Boolean)
      .reduce((acc: number, st) => st?.fontSize ?? acc, 0);
  };
  expect(sizeOf(rowResult)).toBe(20);
  expect(sizeOf(heroResult)).toBe(34);
  expect(sizeOf(heroResult)).toBeGreaterThan(sizeOf(rowResult));
});

// M1c task 1 review, Important: the old implementation read formatDepth's string and
// split it on its one space to style the unit more quietly than the number. Nothing
// validated that a space was actually there — a spaceless formatDepth output made `unit`
// `undefined`, which the nested Text rendered as the literal text " undefined" next to
// the number. That was inert only because formatDepth always emitted exactly one space;
// display.ts's own module docblock says the m/ft unit-conversion setting "arrives in M1c
// and will live here", i.e. in this exact function, this same milestone.
//
// Only `formatDepth` is spied on here, not the module's other exports — DepthValue is
// meant to get the value and unit from `formatDepthParts` instead, a structured sibling
// that never needs parsing, so a real (unmocked) `formatDepthParts` is what should make
// this pass. That's what proves the fix isn't a fallback tolerating today's one-space
// shape, but the removal of the parse entirely.
it('never lets a malformed formatDepth output leak the literal "undefined" onto the screen', async () => {
  const spy = jest.spyOn(display, 'formatDepth').mockReturnValue('32.4');
  try {
    const t = await render(<DepthValue metres={32.4} scheme="dark" units="metric" />);
    const rendered = t.root
      ? t.root
          .queryAll((n) => n.type === 'Text', { includeSelf: true })
          .flatMap((n) => n.children)
          .filter((c): c is string => typeof c === 'string')
          .join('')
      : '';
    expect(rendered).not.toContain('undefined');
  } finally {
    spy.mockRestore();
  }
});

// The most important property in the unit-conversion task, and the one an ordinary
// "shows feet" test would not catch.
//
// DESIGN.md §0.1's six bands are defined in METRES because they follow the order in which
// water removes colour — red gone by about 5 m, then orange, then yellow. That is a fact
// about water, not about the diver's settings, so the band a dive draws in must come from
// the stored metre value and never from the number on screen. `depthBandLimits` is
// `[6, 12, 20, 30, 40]`, so a component that coloured from its own converted figure would
// read `66` (feet) as band 6 and put most of an imperial logbook in one colour.
//
// 20.0 m and 20.1 m are the pair that makes the mistake visible rather than merely wrong:
// they sit either side of the 20 m limit, so they are band 3 and band 4 — and both of them
// round to the SAME `66 ft`. Identical text, different colours. Colour from the display
// number and the two become indistinguishable; colour from metres and they cannot.
function colourOf(t: Awaited<ReturnType<typeof render>>): unknown {
  const node = t.root?.queryAll((n) => n.type === 'Text', { includeSelf: true })[0];
  return [node?.props.style].flat(3).filter(Boolean)
    .reduce((acc: unknown, st) => (st as { color?: unknown } | undefined)?.color ?? acc, undefined);
}

function textOf(t: Awaited<ReturnType<typeof render>>): string {
  return t.root
    ? t.root
        .queryAll((n) => n.type === 'Text', { includeSelf: true })
        .flatMap((n) => n.children)
        .filter((c): c is string => typeof c === 'string')
        .join('')
    : '';
}

it('takes the band from the stored metres, so two depths reading the same feet keep their own colours', async () => {
  const shallow = await render(<DepthValue metres={20.0} scheme="dark" units="imperial" />);
  const deep = await render(<DepthValue metres={20.1} scheme="dark" units="imperial" />);

  // Same figure on screen, either side of a band limit that only the stored value knows about.
  expect(textOf(shallow)).toBe('66 ft');
  expect(textOf(deep)).toBe('66 ft');
  expect(colourOf(shallow)).not.toBe(colourOf(deep));
  // Named explicitly rather than only compared, so a change that made BOTH wrong in the
  // same direction still fails: §0.1's band 3 and band 4 in the dark scheme.
  expect(colourOf(shallow)).toBe(depthScale.dark[2]);
  expect(colourOf(deep)).toBe(depthScale.dark[3]);
});

it('draws one dive in exactly one colour whichever system it is read in', async () => {
  const metric = await render(<DepthValue metres={24.6} scheme="dark" units="metric" />);
  const imperial = await render(<DepthValue metres={24.6} scheme="dark" units="imperial" />);

  expect(textOf(metric)).toBe('24.6 m');
  expect(textOf(imperial)).toBe('81 ft');
  expect(colourOf(metric)).toBe(colourOf(imperial));
});

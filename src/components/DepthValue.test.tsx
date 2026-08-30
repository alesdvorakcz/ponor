import { render } from '@testing-library/react-native';

import * as display from '../format/display';
import { DepthValue } from './DepthValue';

// DESIGN.md §10: no CHECK constraint on any numeric dive field, so a negative
// max_depth_m is a runtime reality this component cannot rule out — a bad import or a
// future sync client can hand it one. depthBand/depthColor's throw-on-invalid contract
// is correct for a pure function (see theme/depth.test.ts), but a render path may not
// throw, so DepthValue must go through the null-safe depthColorOrNull instead and
// render nothing, the same way it already does for an unrecorded depth.
it('renders nothing for a negative depth, without a crash or a placeholder', async () => {
  const t = await render(<DepthValue metres={-5} scheme="dark" />);
  expect(t.toJSON()).toBeNull();
});

// DESIGN.md §0.6: depth is set at 20 px in a row but 34 px on dive detail — `variant`
// is what lets the two call sites share one component instead of forking it.
it('sets the hero variant larger than the default row variant', async () => {
  const rowResult = await render(<DepthValue metres={32.4} scheme="dark" />);
  const heroResult = await render(<DepthValue metres={32.4} scheme="dark" variant="hero" />);
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
    const t = await render(<DepthValue metres={32.4} scheme="dark" />);
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

import { render } from '@testing-library/react-native';

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

import { render, type RenderResult } from '@testing-library/react-native';

import { sparklinePoints, SPARK_BUCKETS } from '../domain/profile';
import { themeFor } from '../theme/resolve';
import { fixtureSeries } from '../testing/suuntoFixture';
import { paint, paintOf } from '../testing/svgPaint';
import { ProfileSparkline } from './ProfileSparkline';

// Same adaptation as DiveRow.test.tsx/DepthProfile.test.tsx (see either file's own top
// comment): `render` is async, `root` is a `test-renderer` `TestInstance` holding host
// elements only, and react-native-svg's own elements appear under their native names —
// `RNSVGPath`, never `Path`. `t.root` reads `null` when the component itself returned `null`
// (the "no series" case below), which is why every query here goes through this helper rather
// than `t.root.queryAll` directly.

function pathsIn(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'RNSVGPath') : [];
}

// `paintOf`/`paint` are imported, not written here (whole-branch review, Minor #5): this file
// used to declare its own pair under a docblock calling them "reused by the same approach
// rather than a second copy", which `src/testing/suuntoFixture.ts` names, in this branch's own
// words, as what a second copy is. `src/testing/svgPaint.ts` holds the pair and the reasoning.

// Task 6 review, Finding 0: this component now takes already-downsampled points rather than
// raw samples and never calls `sparklinePoints` itself (`toDiveSampleShapes`, db/diveSamples.ts,
// does that at the map-building step) — so the fixture this file renders against has to go
// through the same call a real row's points would have gone through.
const FIXTURE = sparklinePoints(fixtureSeries(), SPARK_BUCKETS);

it('draws one monochrome path, because the number beside it carries the colour', async () => {
  const t = await render(<ProfileSparkline points={FIXTURE} scheme="light" />);
  const paths = pathsIn(t);
  expect(paths).toHaveLength(1);
  expect(new Set(paths.map((p) => String(p.props.stroke))).size).toBe(1);
});

it('draws nothing, and no placeholder, for a dive with no samples', async () => {
  const t = await render(<ProfileSparkline points={null} scheme="light" />);
  expect(pathsIn(t)).toHaveLength(0);
});

// §0.1: colour encodes depth, and the row's own depth figure is what carries it — this shape
// is the one piece of depth-derived drawing in the app that must NOT read the depth scale.
it('strokes the muted ink token, never a depth colour', async () => {
  const t = await render(<ProfileSparkline points={FIXTURE} scheme="light" />);
  const [path] = pathsIn(t);
  if (!path) throw new Error('ProfileSparkline did not draw a path');
  expect(paintOf(path, 'stroke')).toBe(paint(themeFor('light').fgMuted));
});

// Recoloured for the scheme it is handed, the same way every other themed ink in the app is —
// proven the same relative way `DiveRow.test.tsx`'s own scheme tests are: two renders, two
// different tokens, never the same one twice.
it('recolours for the scheme it is given, rather than carrying a fixed ink', async () => {
  const light = await render(<ProfileSparkline points={FIXTURE} scheme="light" />);
  const dark = await render(<ProfileSparkline points={FIXTURE} scheme="dark" />);
  const [lightPath] = pathsIn(light);
  const [darkPath] = pathsIn(dark);
  if (!lightPath || !darkPath) throw new Error('ProfileSparkline did not draw a path');
  expect(paintOf(lightPath, 'stroke')).toBe(paint(themeFor('light').fgMuted));
  expect(paintOf(darkPath, 'stroke')).toBe(paint(themeFor('dark').fgMuted));
});

// §0.4: below two points there is nothing to stroke (`sparklinePoints`' own floor, now applied
// upstream in `toDiveSampleShapes` rather than in this component) — this is the same "no
// placeholder" refusal as the null case above, reached with a too-short points array instead
// of a null one.
it('draws nothing for fewer than two points, since there is nothing to stroke', async () => {
  const t = await render(<ProfileSparkline points={[{ t: 0, v: 12 }]} scheme="light" />);
  expect(pathsIn(t)).toHaveLength(0);
});

// Task 6's own ruling: a 40-point downsampled curve cannot be spoken usefully, and DiveRow's
// own accessibility label is already composed from `formatDepth`'s output — a second spoken
// description of the same dive would work against that rather than add to it.
it('is hidden from a screen reader, since a downsampled curve cannot be spoken usefully', async () => {
  const t = await render(<ProfileSparkline points={FIXTURE} scheme="light" />);
  if (!t.root) throw new Error('ProfileSparkline did not render a root element');
  expect(t.root.props.accessible).toBe(false);
});

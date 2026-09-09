import { render, type RenderResult } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processColor } from 'react-native';

import type { DiveSample } from '../db/schema';
import { dive } from '../domain/diveFixture';
import { suuntoJsonImporter } from '../domain/import/suunto';
import type { Dive } from '../domain/types';
import { depthColor } from '../theme/depth';
import { themeFor } from '../theme/resolve';
import { DepthProfile } from './DepthProfile';

// Adapted from the brief's react-test-renderer-shaped examples to the API the installed
// @testing-library/react-native@14 actually exposes, exactly as `DiveRow.test.tsx` records:
//   - `render` is async (it wraps its own `act()`) and returns `{ root, ... }` where `root`
//     is a `test-renderer` `TestInstance`, not a classic react-test-renderer one.
//   - That `TestInstance` has `queryAll(predicate)`, not `findAllByType`/`findByType`.
//   - Its tree holds host elements only, so react-native-svg's elements appear under their
//     native names — `RNSVGPath`, `RNSVGCircle`, `RNSVGLine` — and never as `Path`.
// `textIn` is local rather than shared, per this codebase's convention for a three-line
// query helper (`src/testing/unexpectedGraphics.ts`'s own docblock draws the line: a rule two
// DESIGN.md sections depend on gets an owner, a query helper does not).

function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function pathsIn(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'RNSVGPath') : [];
}

/**
 * **The colour an SVG element was actually painted with.**
 *
 * react-native-svg does not keep the string it was handed: `extractBrush` runs every
 * `stroke`/`fill` through React Native's own `processColor` and passes the native element
 * `{ type: 0, payload: <ARGB int> }`. So an assertion has to compare payloads, and `paint`
 * below puts the expected colour through the same conversion — which makes these tests
 * compare one colour with another rather than pin the encoding react-native-svg happens to
 * use today.
 */
function paintOf(node: { props: Record<string, unknown> }, prop: 'stroke' | 'fill'): unknown {
  return (node.props[prop] as { payload?: unknown } | undefined)?.payload;
}

function paint(colour: string): unknown {
  return processColor(colour);
}

/**
 * **The committed reference dive, run through the real importer** — the plan's `FIXTURE`.
 *
 * Built from `src/domain/import/__fixtures__/suunto-d5.json` rather than hand-written,
 * because a hand-built series would miss the exact shapes this card's geometry has to
 * survive: an **event-only first sample** (no `Depth`, dropped by the importer, so the series
 * starts at the second row), a **non-zero first offset** (0.57 s, not 0), and a **header
 * maximum deeper than any sample** (24.33 m against a deepest sample of 24.29 m).
 *
 * The committed fixture is the *trimmed* five-sample dive, not the 222-sample original — the
 * same fact `domain/consumption.test.ts` had to absorb — so every number asserted below is
 * this file's own, measured from it, and is deliberately not the reference dive's headline
 * figures (222 samples, a 10 s median).
 */
function fixture(): { dive: Dive; series: DiveSample[] } {
  const bytes = new Uint8Array(
    readFileSync(join(__dirname, '..', 'domain', 'import', '__fixtures__', 'suunto-d5.json')),
  );
  const [imported] = suuntoJsonImporter.parse(bytes);
  if (!imported) throw new Error('suunto-d5 fixture yielded no dive');
  // An importer yields a `NewDiveInput`, not a stored row (`ImportedDive`, domain/import/
  // types.ts) — this card is handed the dive a screen read back out of the database. So the
  // imported fields go through the same `dive()` fixture every other component test uses,
  // which fills in the id and the timestamps the repository would have written. Nothing this
  // component reads is invented by that: `maxDepthM` and `tanks` are the file's own.
  return { dive: dive({ ...imported.dive }), series: imported.series ?? [] };
}

const FIXTURE = fixture().series;

it('draws nothing at all for a dive with no samples', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={null} scheme="light" units="metric" />,
  );
  expect(pathsIn(t)).toHaveLength(0);
  expect(textIn(t)).toEqual([]);
});

// §0.4 again, one step in: a single point draws no stroke, and a card with a title, an axis
// and an empty plot is exactly the placeholder the rule forbids.
it('draws nothing for a series too short to make a stroke', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={[[0, 12, null, null]]} scheme="light" units="metric" />,
  );
  expect(pathsIn(t)).toHaveLength(0);
  expect(textIn(t)).toEqual([]);
});

it('strokes one path per depth band, so no stroke spans two colours', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  const paths = pathsIn(t);
  expect(paths.length).toBeGreaterThan(1);
  const colours = new Set(paths.map((p) => paintOf(p, 'stroke')));
  expect(colours.size).toBeGreaterThan(1);
});

// §0.1, stated where it can actually fail: every stroke on the depth curve is a colour the
// depth scale produced for the depth that stroke draws. A run painted from the theme, from a
// literal, or from the wrong band's colour passes the test above and fails this one.
it('takes every stroke of the depth curve from the depth of the samples in it', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  // The fixture's five depths are 1.27, 2.96, 24.29, 24.02 and 0.06 m — bands 1, 1, 4, 4, 1 —
  // so the curve is three runs in two colours, and the boundary sample is repeated into the
  // run it opens (`colourRuns`, domain/profile.ts).
  expect(pathsIn(t).map((p) => paintOf(p, 'stroke'))).toEqual([
    paint(depthColor(1.27, 'light')),
    paint(depthColor(24.29, 'light')),
    paint(depthColor(0.06, 'light')),
  ]);
});

it('states the sample count and the interval the device actually used', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  const text = textIn(t).join(' ');
  // Five samples survive the importer (the first row of the file carries events and no depth).
  expect(FIXTURE).toHaveLength(5);
  expect(text).toContain('5 samples');
  // The deltas are 9.74, 230.13, 10.01 and 1961.05 s, so the median is 120 s — the trimmed
  // fixture's own interval, not the 10 s the untrimmed reference dive declares and records.
  // Stating the median is the whole point: a number the device actually produced.
  expect(text).toContain('120 s');
});

// The header maximum, not the deepest sample (spec §3, import spec §4.2). The fixture's
// samples reach 24.29 m, so a chart scaled from the series would stop at 30 m and never draw
// this dive's 40 m gridline at all.
it('scales the depth axis from the dive’s stored maximum rather than from the samples', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 34 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  expect(textIn(t).join(' ')).toContain('40 m');
});

it('draws a consumption trace for a dive whose samples carry pressure', async () => {
  const { dive: imported, series } = fixture();
  const t = await render(<DepthProfile dive={imported} samples={series} scheme="light" units="metric" />);
  const gas = pathsIn(t).filter((p) => paintOf(p, 'stroke') === paint(themeFor('light').fgMuted));
  expect(gas).toHaveLength(1);
  expect(textIn(t).join(' ')).toContain('l/min');
});

// Spec §4.3's third rule, carried into the drawing because `consumptionSeries` returns a flat
// array with nowhere to encode it: the fixture's gas points sit at 120.5 s, 125.4 s, 1226.0 s
// and 1231.0 s — the diver was above the 1.5 m floor for the 1100 s in between — so the trace
// must break rather than bridge eighteen minutes it never measured with a straight line.
it('breaks the gas trace across a gap wider than two windows instead of bridging it', async () => {
  const { dive: imported, series } = fixture();
  const t = await render(<DepthProfile dive={imported} samples={series} scheme="light" units="metric" />);
  const gas = pathsIn(t).find((p) => paintOf(p, 'stroke') === paint(themeFor('light').fgMuted));
  expect(String(gas?.props.d).match(/M/g)).toHaveLength(2);
});

it('draws no consumption trace for a dive with no per-sample pressure', async () => {
  const { dive: imported, series } = fixture();
  const noGas = series.map(([at, depthM]): DiveSample => [at, depthM, null, null]);
  const t = await render(<DepthProfile dive={imported} samples={noGas} scheme="light" units="metric" />);
  expect(pathsIn(t).filter((p) => paintOf(p, 'stroke') === paint(themeFor('light').fgMuted))).toHaveLength(0);
  expect(textIn(t).join(' ')).not.toContain('l/min');
});

// §0.4's dot, and §0.1 on it: the marker is the deepest sample the series actually holds,
// painted in that depth's own band colour — not the header maximum, which is a figure with no
// point on the curve to sit on.
it('marks the deepest sample in its own band colour', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  const marks = t.root ? t.root.queryAll((n) => n.type === 'RNSVGCircle') : [];
  expect(marks).toHaveLength(1);
  expect(paintOf(marks[0]!, 'fill')).toBe(paint(depthColor(24.29, 'light')));
});

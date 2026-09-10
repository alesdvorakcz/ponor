import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import type { PanGesture } from 'react-native-gesture-handler';

import type { DiveSample } from '../db/schema';
import { dive } from '../domain/diveFixture';
import type { Dive, Tank } from '../domain/types';
import { formatDepth, formatRmv, NO_FIGURE } from '../format/display';
import { depthColor } from '../theme/depth';
import { themeFor } from '../theme/resolve';
import { makeStyles, PROFILE_DEEPEST_MARK_RADIUS, PROFILE_PLOT_HEIGHT } from '../theme/styles';
import { fixtureImportedDive } from '../testing/suuntoFixture';
import { paint, paintOf } from '../testing/svgPaint';
import { DepthProfile, PLOT_WIDTH, PROFILE_PLOT_TEST_ID } from './DepthProfile';

// Adapted from the brief's react-test-renderer-shaped examples to the API the installed
// @testing-library/react-native@14 actually exposes, exactly as `DiveRow.test.tsx` records:
//   - `render` is async (it wraps its own `act()`) and returns `{ root, ... }` where `root`
//     is a `test-renderer` `TestInstance`, not a classic react-test-renderer one.
//   - That `TestInstance` has `queryAll(predicate)`, not `findAllByType`/`findByType`.
//   - Its tree holds host elements only, so react-native-svg's elements appear under their
//     native names — `RNSVGPath`, `RNSVGEllipse`, `RNSVGLine` — and never as `Path`.
// `textIn` is local rather than shared, per this codebase's convention for a three-line
// query helper (`src/testing/unexpectedGraphics.ts`'s own docblock draws the line: a rule two
// DESIGN.md sections depend on gets an owner, a query helper does not). `paintOf`/`paint` are
// shared for the other half of that line — see `src/testing/svgPaint.ts`, which is where they
// live now (whole-branch review, Minor #5).

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

function linesIn(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'RNSVGLine') : [];
}

/**
 * **The deepest-sample mark**, asked for by what it is rather than by which primitive draws it:
 * a circle states one radius for both axes and an ellipse states each, and what these tests are
 * about is the shape a diver sees, not the element react-native-svg was handed. Keeping the
 * query that wide is also what lets the wide-layout test below fail on the geometry — a mark
 * drawn as a lozenge — instead of on a missing element name.
 */
function marksIn(t: RenderResult) {
  return t.root
    ? t.root.queryAll((n) => n.type === 'RNSVGEllipse' || n.type === 'RNSVGCircle')
    : [];
}

function markIn(t: RenderResult) {
  const [mark] = marksIn(t);
  if (!mark) throw new Error('DepthProfile drew no deepest-sample mark');
  const r = mark.props.r as number | undefined;
  return {
    cy: mark.props.cy as number,
    rx: (mark.props.rx as number | undefined) ?? r ?? 0,
    ry: (mark.props.ry as number | undefined) ?? r ?? 0,
  };
}

/**
 * **Tell the plot how wide it is.** `onLayout` never fires under Jest — the reason Task 4
 * deferred measuring at all — so a test that wants the scrub to map anywhere has to hand the
 * component the measurement the device would have given it. Without this the pan is inert by
 * design (`scrubbedIndexAt`), which the "before the plot has been measured" test below pins.
 */
async function measure(t: RenderResult, width: number) {
  await act(async () => {
    fireEvent(t.getByTestId(PROFILE_PLOT_TEST_ID), 'layout', {
      nativeEvent: { layout: { width, height: PROFILE_PLOT_HEIGHT, x: 0, y: 0 } },
    });
  });
}

/**
 * **A finger dragged to `x` on the plot**, through RNGH's own test harness.
 *
 * `fireGestureHandler` is the supported way in — hand-firing touch events at a
 * `GestureDetector` does nothing, because the handler is driven by native state-machine events
 * rather than by the responder system. One partial event is enough: RNGH fills in the `BEGAN`
 * and `END` around it, so this is one whole gesture stream ending at `x`, which is what a
 * diver's drag is. `act` because the stream lands in React state.
 */
async function scrubTo(x: number) {
  await act(async () => {
    fireGestureHandler<PanGesture>(getByGestureTestId(PROFILE_PLOT_TEST_ID), [{ x }]);
  });
}

/** A minimal, complete `Tank` for tests that need a cylinder but not the whole shape a
 * diver would actually fill in — the fields `consumptionSeries` reads, and nothing else. */
function tank(over: Partial<Tank> = {}): Tank {
  return {
    material: 'steel', configuration: 'single', sizeL: 10, workingBar: 232,
    o2Pct: 21, hePct: null, startBar: null, endBar: null, ...over,
  };
}

/**
 * **The committed reference dive, run through the real importer** — the plan's `FIXTURE`,
 * built on `../testing/suuntoFixture`'s `fixtureImportedDive()` (Task 6 review, Finding 4:
 * that module is the one place this read-and-parse happens now, rather than a copy per file).
 *
 * The trimmed five-sample dive it returns has the exact shapes this card's geometry has to
 * survive that a hand-built series would miss: an **event-only first sample** (no `Depth`,
 * dropped by the importer, so the series starts at the second row), a **non-zero first
 * offset** (0.57 s, not 0), and a **header maximum deeper than any sample** (24.33 m against a
 * deepest sample of 24.29 m) — not the 222-sample original's headline figures (a 10 s median),
 * the same fact `domain/consumption.test.ts` had to absorb.
 */
function fixture(): { dive: Dive; series: DiveSample[] } {
  const imported = fixtureImportedDive();
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
  // The path is a trace and not a stub: at least one line segment, so it joins two measured
  // points rather than parking a lone `M` somewhere. This used to assert that `l/min` appeared
  // in the card's text, which read the gas axis ceiling beside the plot — a label removed on
  // 2026-09-10 because its column set the chart's width. The unit still reaches a diver, from
  // the readout, which states it wherever the finger is; what this test is for is the drawing.
  expect(String(gas[0]?.props.d)).toContain('L');
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
  const marks = marksIn(t);
  expect(marks).toHaveLength(1);
  expect(paintOf(marks[0]!, 'fill')).toBe(paint(depthColor(24.29, 'light')));
});

// Whole-branch review, Minor #3. `preserveAspectRatio="none"` stretches this viewBox to
// whatever the column gives it, and the argument that this costs nothing — "the horizontal
// scale sits at about 1" — is a phone's argument. `DivesScreen`'s wide layout puts the whole
// dive detail in `wideDetailColumn` (theme/styles.ts), a `flex: 1` column beside a fixed 360 pt
// list, so on a 1366 pt iPad the plot is about 930 pt: a scale of ~2.9, which drew the one
// non-stroke shape on this card about 17 pt across against 6 pt tall — a dash. Every stroke is
// `non-scaling-stroke` and cannot be distorted at all; the mark is the exception, and it is the
// one thing §0.4 says has to sit where the device actually was.
it('keeps the deepest-sample mark round on a plot the wide layout has stretched', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  // Before `onLayout`, no scale is known — nothing to counteract, so the mark is drawn round in
  // the viewBox's own units, exactly as it was when this card only ever appeared on a phone.
  const unmeasured = markIn(t);
  expect(unmeasured.rx).toBe(unmeasured.ry);
  expect(unmeasured.ry).toBe(PROFILE_DEEPEST_MARK_RADIUS);

  await measure(t, 930);
  const measured = markIn(t);
  // The height is untouched: the stretch is horizontal, so nothing about the vertical radius
  // (or the inset that keeps it inside the viewport) is this fix's business.
  expect(measured.ry).toBe(PROFILE_DEEPEST_MARK_RADIUS);
  // What a diver actually sees is `rx` multiplied by the column's own scale factor, and that
  // product is what has to come back to the radius.
  expect(measured.rx * (930 / PLOT_WIDTH)).toBeCloseTo(measured.ry, 1);

  // A width of zero is not a scale — it is a layout that has not settled — and dividing by it
  // would hand the element an infinite radius. Same guard, same spelling, as `scrubbedIndexAt`.
  await measure(t, 0);
  expect(markIn(t).rx).toBe(PROFILE_DEEPEST_MARK_RADIUS);
});

// Review round 1, Finding A: the viewBox spans exactly 0…PROFILE_PLOT_HEIGHT, so anything
// drawn at y = 0 or y = PROFILE_PLOT_HEIGHT is cut in half by the viewport. A dive whose
// deepest sample sits exactly on a round `axis.max` puts the marker's centre on the bottom
// edge, which is the case named in the finding: `maxDepthM` null so the axis is scaled from
// the samples alone, and axisMax(30) is exactly 30.
it('keeps the deepest-sample marker fully inside the viewBox when the deepest sample sits on axis.max', async () => {
  const series: DiveSample[] = [
    [0, 5, null, null],
    [10, 30, null, null],
  ];
  const t = await render(<DepthProfile dive={dive()} samples={series} scheme="light" units="metric" />);
  expect(marksIn(t)).toHaveLength(1);
  // `ry` rather than `r`: the mark is an ellipse now (Minor #3, the test above), and the
  // vertical radius is the half of it this viewport can clip.
  const { cy, ry } = markIn(t);
  expect(cy - ry).toBeGreaterThanOrEqual(0);
  expect(cy + ry).toBeLessThanOrEqual(PROFILE_PLOT_HEIGHT);
});

// Same finding, the gridlines' half: a 1 pt line stroked exactly at y = 0 or y =
// PROFILE_PLOT_HEIGHT renders at half its apparent weight, because half of it falls outside
// the viewport. None of the fixture's gridlines — including the first (0 m) and the last
// (axis.max) — may sit exactly on either edge.
it('keeps every gridline off the viewport edge', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  const lines = linesIn(t);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line.props.y1).not.toBe(0);
    expect(line.props.y1).not.toBe(PROFILE_PLOT_HEIGHT);
  }
});

// Review round 1, Finding B: the two series must be scaled off ONE x domain — the full
// recorded series' time extent — not off `colourRuns`' drawn subset. Three samples 60 s
// apart so each window is exactly two samples wide (the same hand-computable shape
// `consumption.test.ts` uses); the last sample's depth is negative, which `isDisplayableDepth`
// rejects, so `colourRuns` draws only the first two and the depth curve's own extent ends at
// t = 60 — sixty seconds short of the series' real end at t = 120. `consumptionSeries` reads
// every sample regardless of depth, so its second window (t = 60 to t = 120, midpoint 90)
// still produces a point past that shorter extent.
it('scales the gas trace against the full sample series, not the drawn depth curve', async () => {
  const series: DiveSample[] = [
    [0, 10, null, 200],
    [60, 10, null, 194],
    [120, -0.1, null, 188],
  ];
  const t = await render(
    <DepthProfile dive={dive({ tanks: [tank()] })} samples={series} scheme="light" units="metric" />,
  );
  const gas = pathsIn(t).find((p) => paintOf(p, 'stroke') === paint(themeFor('light').fgMuted));
  expect(gas).toBeDefined();
  const xs = [...String(gas!.props.d).matchAll(/[ML](-?[\d.]+) -?[\d.]+/g)].map((m) => Number(m[1]));
  expect(xs).toHaveLength(2);
  // Against the full series' domain (0 to 120) the second window's midpoint (t = 90) lands at
  // three quarters of the width; against the depth curve's own domain (0 to 60) it would
  // compute to 480 viewBox units — past the 320-wide plot entirely.
  expect(xs[1]).toBeLessThanOrEqual(PLOT_WIDTH);
});

// Review round 1, Finding C: `gasSegments` (DepthProfile.tsx) drops a segment left holding a
// single point rather than emit a bare `M` nothing draws a line from. Five samples at a
// constant, bandable 10 m: two isolated one-sample windows (t = 30, t = 530 — each more than
// GAS_GAP_S from its neighbour) ahead of one real two-point segment (t = 1030, t = 1090).
it('drops a one-point gas segment rather than leaving a stray subpath for it', async () => {
  const series: DiveSample[] = [
    [0, 10, null, 200],
    [60, 10, null, 196],
    [1000, 10, null, 150],
    [1060, 10, null, 146],
    [1120, 10, null, 142],
  ];
  const t = await render(
    <DepthProfile dive={dive({ tanks: [tank()] })} samples={series} scheme="light" units="metric" />,
  );
  const gas = pathsIn(t).find((p) => paintOf(p, 'stroke') === paint(themeFor('light').fgMuted));
  expect(gas).toBeDefined();
  // One `M` only: the two stray one-point segments must not each contribute their own.
  expect(String(gas!.props.d).match(/M/g)).toHaveLength(1);
});

// ── §5's scrub readout ─────────────────────────────────────────────────────────────────────

// Review round 2, Finding 1: the readout row has no overflow guard against its own worst
// content — Czech's longer words beside an imperial reading. `flexShrink` on the row's styles
// is what lets either figure give way, and `numberOfLines={1}` on each `Text` is what turns
// that shrink into a truncation instead of a second line, which would otherwise grow the row
// exactly when a diver drags from the em dash to a figure (`profileReadout`'s own docblock,
// theme/styles.ts). Asserted on the sheet and on the rendered props directly, the same way
// `DiveRow.test.tsx`'s own `numberOfLines` case pins its guarantee.
it('lets each readout figure give way rather than overflow or wrap the row', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 34 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  const styles = makeStyles('light');
  const labels = textNodesOf(t).filter((n) => [n.props.style].flat(3).includes(styles.profileReadoutLabel));
  const values = textNodesOf(t).filter((n) => [n.props.style].flat(3).includes(styles.profileReadoutValue));
  expect(labels).toHaveLength(2);
  expect(values).toHaveLength(2);
  for (const node of [...labels, ...values]) {
    expect(node.props.numberOfLines).toBe(1);
  }
  expect(styles.profileReadoutFigure.flexShrink).toBe(1);
  expect(styles.profileReadoutLabel.flexShrink).toBe(1);
  expect(styles.profileReadoutValue.flexShrink).toBe(1);
});

// Whole-branch review, Minor #4: the same shrink-without-a-cap defect as the test above, two
// blocks up in the same card. `profileMeta` shrinks and `profileTitle` does not, so in Czech on
// a narrow phone the caption gives way — and, uncapped, gave way by wrapping, growing a header
// whose `alignItems: 'baseline'` had been laid out for one line and pushing the plot down.
it('caps the caption at one line, so a long one cannot push the plot down the screen', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  const styles = makeStyles('light');
  const caption = textNodesOf(t).find((n) => [n.props.style].flat(3).includes(styles.profileMeta));
  expect(caption).toBeDefined();
  expect(caption?.props.numberOfLines).toBe(1);
  expect(styles.profileMeta.flexShrink).toBe(1);
});

/**
 * The deepest sample the fixture actually holds — 24.29 m — computed rather than typed, so it
 * cannot drift from the file every other test here reads. Deliberately NOT the 24.33 m the
 * same dive's header claims: those two are what make "the readout explains the dot" a testable
 * statement rather than a coincidence (see `fixture` above).
 */
const DEEPEST_SAMPLE_M = Math.max(...FIXTURE.map(([, depthM]) => depthM));

// Spec §5's first rule: "before any touch the readout shows the deepest sample — the point
// already marked with a dot". `maxDepthM: 34` rather than the fixture's own 24.33, which
// formats to the same "24.3 m" the deepest sample does and so could not tell the two apart.
it('reads out the deepest sample, not the dive’s stored maximum, before anyone touches it', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 34 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  const text = textIn(t).join(' ');
  expect(text).toContain(formatDepth(DEEPEST_SAMPLE_M, 'metric'));
  expect(text).not.toContain(formatDepth(34, 'metric'));
});

// §0.4 in the readout: a dive with no transmitter has no consumption to state, so the slot
// holds the dash rather than closing up or inventing a figure.
it('shows an em dash for gas on a dive with no per-sample pressure', async () => {
  const noGas = FIXTURE.map(([at, depthM]): DiveSample => [at, depthM, null, null]);
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 34 })} samples={noGas} scheme="light" units="metric" />,
  );
  const text = textIn(t).join(' ');
  // The depth half is still real — a readout that had dropped BOTH figures would satisfy a
  // bare search for the dash.
  expect(text).toContain(formatDepth(DEEPEST_SAMPLE_M, 'metric'));
  expect(text).toContain(NO_FIGURE);
});

it('scrubs to the sample under the finger', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 34 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  await measure(t, 300);
  await scrubTo(300); // the plot's far right edge
  const text = textIn(t).join(' ');
  expect(text).toContain(formatDepth(FIXTURE.at(-1)![1], 'metric'));
  expect(text).not.toContain(formatDepth(DEEPEST_SAMPLE_M, 'metric'));
});

// The plot's width arrives from `onLayout`, which does not fire under Jest and has not fired
// on a device either until the first layout pass. An unmeasured plot has no scale, and a touch
// mapped through no scale would jump the readout to the first sample of the dive — so the pan
// does nothing at all instead.
it('does not move the readout before the plot has been measured', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 34 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  await scrubTo(300);
  const text = textIn(t).join(' ');
  expect(text).toContain(formatDepth(DEEPEST_SAMPLE_M, 'metric'));
  expect(text).not.toContain(formatDepth(FIXTURE.at(-1)![1], 'metric'));
});

// Spec §5's gas half, on a series small enough to compute by hand — the shape
// `consumption.test.ts` uses for the same reason. Three samples at a constant, bandable 10 m,
// at 0, 60 and 130 s, so `consumptionSeries` emits exactly two complete windows.
it('reads the consumption at the scrubbed sample, and an em dash where the trace has none', async () => {
  const series: DiveSample[] = [
    [0, 10, null, 200],
    [60, 10, null, 196],
    [130, 10, null, 190],
  ];
  const t = await render(
    <DepthProfile dive={dive({ tanks: [tank()] })} samples={series} scheme="light" units="metric" />,
  );
  await measure(t, 300);

  // First window, 0→60 s: 4 bar out of a 10 l cylinder is 40 l of free gas, at a mean 10 m
  // (2 ata) over one minute — 20 l/min, anchored at the window's midpoint, t = 30 s. The
  // second window (60→130 s) reads 25.7, so a readout showing the other window's point fails
  // this. (It used to discriminate against a third figure too, the gas axis ceiling of 30 that
  // this card drew beside the plot; that label is gone — see the test below.)
  await scrubTo(150); // t = 65 s: nearer the 30 s window than the 95 s one
  expect(textIn(t).join(' ')).toContain(formatRmv(20, 'metric'));

  // The plot's left edge is t = 0, thirty seconds before the trace's first point. §0.4 forbids
  // inventing a reading there, so the gas slot holds the dash — while the depth beside it,
  // which the series really does record, stays a figure.
  await scrubTo(0);
  const text = textIn(t).join(' ');
  expect(text).toContain(NO_FIGURE);
  expect(text).not.toContain(formatRmv(20, 'metric'));
  expect(text).toContain(formatDepth(10, 'metric'));
});

// Owner's call, 2026-09-10, after seeing the card on a phone: the consumption ceiling used to
// be drawn in a column to the right of the plot, and a column that sizes to its own text is a
// column that decides the chart's width — the same dive drew a narrower chart in Czech imperial
// (`1,41 cu ft/min`) than in English metric (`40.0 l/min`), and a dive with no gas, having no
// such column at all, drew wider than the dive above it in the same list.
//
// The series below is the one used above, whose two windows read 20.0 and 25.7, so `axisMax`
// puts the ceiling at exactly 30 — a figure that appeared nowhere else on this card and is
// therefore the one that proves the label is gone rather than merely moved.
it('draws no consumption ceiling beside the plot, because a caption must not set the chart width', async () => {
  const series: DiveSample[] = [
    [0, 10, null, 200],
    [60, 10, null, 196],
    [130, 10, null, 190],
  ];
  const t = await render(
    <DepthProfile dive={dive({ tanks: [tank()] })} samples={series} scheme="light" units="metric" />,
  );
  await measure(t, 300);

  const text = textIn(t).join(' ');
  expect(text).not.toContain(formatRmv(30, 'metric'));
  // Not vacuous: the trace itself is drawn, so this is a card that HAS a ceiling to state and
  // does not state it — rather than a card with no gas in it, which would pass for free.
  expect(pathsIn(t).length).toBeGreaterThan(1);
});

// Review round 2, Finding 3: the test above only covers a scrub BEFORE the first gas segment.
// The requirement's headline case — a scrub landing BETWEEN two segments — had no test at all.
// `gasAt` takes the same `continue` path for both (it refuses any instant outside every
// segment's own [opens, closes] span), so the behaviour is right by construction; this is the
// coverage that was missing.
it('shows an em dash for a scrub landing between two gas segments, not just before the first one', async () => {
  // Two clusters shaped exactly like the one above (60 s then 70 s apart, so each yields two
  // complete RMV windows), 870 s apart in the middle — comfortably more than GAS_GAP_S (120 s)
  // — so `gasSegments` breaks the trace into two: roughly [30, 95] and [1030, 1095].
  const series: DiveSample[] = [
    [0, 10, null, 200],
    [60, 10, null, 196],
    [130, 10, null, 190],
    [1000, 10, null, 180],
    [1060, 10, null, 176],
    [1130, 10, null, 170],
  ];
  const t = await render(
    <DepthProfile dive={dive({ tanks: [tank()] })} samples={series} scheme="light" units="metric" />,
  );
  await measure(t, 1130);

  // t = 130 s: the sample the finger actually lands nearest to at this touch (300 of 1130) —
  // well after the first segment closes (95 s) and well before the second opens (1030 s), the
  // gap in the middle of the dive rather than before its first reading.
  await scrubTo(300);
  const text = textIn(t).join(' ');
  expect(text).toContain(NO_FIGURE);
  expect(text).not.toContain(formatRmv(20, 'metric'));
  expect(text).toContain(formatDepth(10, 'metric'));
});

// The hairline marks where the finger is, so before there has been a finger there is nothing
// to mark — and the dot §0.4 already draws is what the untouched readout is describing.
it('draws no hairline until the diver has actually scrubbed', async () => {
  const t = await render(
    <DepthProfile dive={dive({ maxDepthM: 34 })} samples={FIXTURE} scheme="light" units="metric" />,
  );
  const before = linesIn(t);
  expect(before.length).toBeGreaterThan(0);
  // Every line on an untouched plot is a gridline, and a gridline is horizontal.
  expect(before.every((line) => line.props.y1 === line.props.y2)).toBe(true);

  await measure(t, 300);
  await scrubTo(300);
  const after = linesIn(t);
  expect(after).toHaveLength(before.length + 1);
  expect(after.filter((line) => line.props.x1 === line.props.x2)).toHaveLength(1);
});

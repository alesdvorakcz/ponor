# Dive Profile Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw §0.4's depth profile — a scrubbable chart on the dive detail and a sparkline on the dive row — from the real sample series the importer stores, with a gas-consumption companion.

**Architecture:** Pure geometry and consumption modules turn a stored series into scaled points, colour runs and axis ticks with no React and no rendering. `react-native-svg` (newly adopted, amending §10) strokes them as one `Path` per depth band. A horizontal-only pan scrubs the chart and updates a fixed readout above it.

**Tech Stack:** TypeScript · `react-native-svg` (new) · `react-native-gesture-handler` (existing) · Drizzle + `expo-sqlite` · Jest + `@testing-library/react-native` · i18next

**Spec:** [`docs/superpowers/specs/2026-09-09-dive-profile-design.md`](../specs/2026-09-09-dive-profile-design.md)

## Global Constraints

- **Read the spec first.** Every constant below has a measured argument behind it; the arguments are the point.
- **Colour encodes depth and nothing else** (§0.1). The depth curve takes its colour from `depthColor()`; the gas trace is muted ink; no other colour appears.
- **Nothing is drawn that was not measured** (§0.4). No card without samples, no gas trace without per-sample pressure, no interpolation across a gap.
- **`PROFILE_RMV_WINDOW_S = 60`** — a named constant, because the owner asked to be able to tweak it.
- **`PROFILE_RMV_MIN_DEPTH_M = 1.5`** — no consumption point is computed above this depth.
- A consumption point is emitted **only where a complete window exists**.
- **SI stored, converted at display.** Depths in metres, pressures in bar, consumption in l/min.
- **Both languages**, `src/i18n/en.ts` and `src/i18n/cs.ts`. In Czech, never write `Ponor` in a sentence that also means "a dive" — use `Aplikace` (see M3n).
- **No colour literals**; `StyleSheet` from `src/theme/tokens`. `unexpectedGraphics` tests enforce it.
- **TDD.** Failing test first, watch it fail for the right reason, then implement. Tests colocated.
- **Green before commit:** `npm test`, `npm run typecheck`, `npm run lint`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

**`FIXTURE` in the component tests below** means the sample series of the committed
`src/domain/import/__fixtures__/suunto-d5.json`, obtained by running it through
`suuntoJsonImporter.parse(...)` and taking `.series`. Build it once per test file with a small
local helper rather than hand-writing points — a hand-built series would not exercise the real
shapes (an event-only first sample, a non-zero first offset, a header maximum deeper than any
sample) that the geometry depends on.

---

### Task 1: Pure profile geometry

**Files:**
- Create: `src/domain/profile.ts`
- Test: `src/domain/profile.test.ts`

**Interfaces:**
- Consumes: `DiveSample` (`src/db/schema.ts`) — `readonly [seconds, depthM, tempC|null, bar|null]`
- Produces: `depthAxis(maxDepthM)`, `colourRuns(samples, scheme)`, `medianIntervalS(samples)`, `sparklinePoints(samples, buckets)`, `type ProfilePoint = { t: number; v: number }`, `type ColourRun = { colour: string; points: ProfilePoint[] }`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/profile.test.ts
import { colourRuns, depthAxis, medianIntervalS, sparklinePoints } from './profile';

const s = (t: number, d: number): DiveSample => [t, d, null, null];

it('rounds the depth axis up to the next ten metres, so the scale is readable', () => {
  expect(depthAxis(24.33)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
  expect(depthAxis(30)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
  expect(depthAxis(4.2)).toEqual({ max: 10, ticks: [0, 10] });
});

it('breaks the curve into one run per depth band, so each stroke is the colour of its own depth', () => {
  // 3 m and 5 m are both band 1; 8 m is band 2. Two runs, and the second starts at the
  // last point of the first so the strokes meet rather than leaving a gap at the boundary.
  const runs = colourRuns([s(0, 3), s(10, 5), s(20, 8)], 'light');
  expect(runs).toHaveLength(2);
  expect(runs[0]?.points.map((p) => p.v)).toEqual([3, 5]);
  expect(runs[1]?.points.map((p) => p.v)).toEqual([5, 8]);
  expect(runs[0]?.colour).not.toBe(runs[1]?.colour);
});

it('states the interval the device actually recorded, not the one it declared', () => {
  // The reference dive declares 10 s and its real deltas run 9.74-10.10. The median is
  // what a diver is told, so a device whose clock drifts is described honestly.
  expect(medianIntervalS([s(0, 1), s(9.74, 2), s(19.75, 3), s(30.1, 4)])).toBe(10);
});

it('keeps the deepest sample when downsampling, so the shape agrees with the number', () => {
  // Every-nth sampling would drop a maximum that lands on a single sample — and the row
  // draws this beside the depth figure, so the two would visibly disagree.
  const many = Array.from({ length: 100 }, (_u, i) => s(i * 10, i === 37 ? 42 : 5));
  const points = sparklinePoints(many, 10);
  expect(points.length).toBeLessThanOrEqual(10);
  expect(Math.max(...points.map((p) => p.v))).toBe(42);
});

it('returns nothing for a series too short to draw', () => {
  expect(colourRuns([s(0, 3)], 'light')).toEqual([]);
  expect(sparklinePoints([s(0, 3)], 10)).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/domain/profile.test.ts`
Expected: FAIL — `Cannot find module './profile'`

- [ ] **Step 3: Implement `src/domain/profile.ts`**

Pure functions only — no React, no rendering, no styles. `depthColor` comes from `src/theme/depth.ts`, which already owns depth→colour and must not be duplicated here.

```ts
const AXIS_STEP_M = 10;

/** The vertical scale, rounded up to the next 10 m so the gridlines are round numbers a
 * diver reads without arithmetic. Driven by the dive's stored `maxDepthM` rather than the
 * deepest sample: the import spec (§4.2) records that the device's own maximum is finer
 * than the series and the samples can be shallower. */
export function depthAxis(maxDepthM: number): { max: number; ticks: number[] } {
  const max = Math.max(AXIS_STEP_M, Math.ceil(maxDepthM / AXIS_STEP_M) * AXIS_STEP_M);
  const ticks: number[] = [];
  for (let m = 0; m <= max; m += AXIS_STEP_M) ticks.push(m);
  return { max, ticks };
}
```

`colourRuns` walks the samples, starting a new run when `depthBand()` changes, and **repeats the
boundary sample as the first point of the next run** so consecutive strokes meet. Each run's
colour is `depthColor(firstPointDepth, scheme)`.

`medianIntervalS` takes the median of consecutive deltas, rounded to the nearest whole second.

`sparklinePoints` buckets the series into at most `buckets` groups by time and emits each
bucket's **deepest** sample, preserving chronological order.

All four return `[]` for a series of fewer than two samples.

- [ ] **Step 4: Run the tests**

Run: `npx jest src/domain/profile.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/profile.ts src/domain/profile.test.ts
git commit -m "Turn a sample series into something drawable"
```

---

### Task 2: Windowed consumption, sharing the RMV core

**Files:**
- Modify: `src/domain/derived.ts` (extract the arithmetic from `rmv`, ~line 190)
- Create: `src/domain/consumption.ts`
- Test: `src/domain/consumption.test.ts`, `src/domain/derived.test.ts`

**Interfaces:**
- Consumes: `DiveSample` (`src/db/schema.ts`), `Tank` (`src/domain/types.ts`), `ProfilePoint` (Task 1)
- Produces: `rmvFrom(litres, avgDepthM, minutes): number | null` (exported from `derived.ts`), `consumptionSeries(samples, tank): ProfilePoint[]`, `PROFILE_RMV_WINDOW_S`, `PROFILE_RMV_MIN_DEPTH_M`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/consumption.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { consumptionSeries } from './consumption';

/**
 * The same trimmed Suunto fixtures the importer's own tests use, run through the real importer
 * so this suite reads exactly what the app stores rather than a hand-built series. Committed at
 * `src/domain/import/__fixtures__/suunto-d5.json` and `…-no-transmitter.json` by the import work.
 */
function fixtureSeries(name: string): { series: DiveSample[]; tank: Tank } {
  const bytes = new Uint8Array(readFileSync(join(__dirname, 'import', '__fixtures__', `${name}.json`)));
  const [imported] = suuntoJsonImporter.parse(bytes);
  if (!imported) throw new Error(`fixture ${name} yielded no dive`);
  const tank = imported.dive.tanks?.[0];
  if (!tank) throw new Error(`fixture ${name} yielded no tank`);
  return { series: imported.series ?? [], tank };
}

it('emits no point where the window is incomplete', () => {
  // The bug this rule exists for: a window that shrinks as it runs out of samples falls back
  // to noisy 10-second readings and produced a phantom 36 l/min spike at the dive's end.
  const { series, tank } = fixtureSeries('suunto-d5');
  const out = consumptionSeries(series, tank);
  const last = series[series.length - 1]?.[0] ?? 0;
  expect(out[out.length - 1]!.t).toBeLessThan(last);
});

it('emits no point above 1.5 m, where the formula inflates', () => {
  const { series, tank } = fixtureSeries('suunto-d5');
  for (const point of consumptionSeries(series, tank)) {
    expect(point.v).toBeGreaterThan(0);
  }
});

it('agrees with the whole-dive figure derived.ts already computes', () => {
  // Not a coincidence to be re-checked: both call rmvFrom. If this drifts, the chart and the
  // Stats sparkline are telling a diver two different numbers about one dive.
  const { series, tank } = fixtureSeries('suunto-d5');
  const points = consumptionSeries(series, tank);
  const mean = points.reduce((a, p) => a + p.v, 0) / points.length;
  expect(mean).toBeGreaterThan(13.5);
  expect(mean).toBeLessThan(16);
});

it('yields nothing for a dive logged without a tank transmitter', () => {
  const { series, tank } = fixtureSeries('suunto-d5-no-transmitter');
  expect(consumptionSeries(series, tank)).toEqual([]);
});

it('yields nothing without a cylinder size, since litres cannot be known', () => {
  const { series } = fixtureSeries('suunto-d5');
  expect(consumptionSeries(series, { sizeL: null } as never)).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/domain/consumption.test.ts`
Expected: FAIL — `Cannot find module './consumption'`

- [ ] **Step 3: Extract the RMV core in `src/domain/derived.ts`**

`rmv` currently computes `litres / ata / durationMin` inline. Extract exactly that, keep `rmv`
calling it, and export it:

```ts
/**
 * **The one place surface-equivalent consumption is computed** (§4.1 of the profile spec).
 *
 * `rmv` below answers it for a whole dive; `domain/consumption.ts` answers it for a 60-second
 * window, and both call this. A second copy would let the dive detail's chart and the Stats
 * screen's figure tell a diver two different numbers about the same dive, which is §4.1's
 * defining defect — and they currently agree, which should be structural rather than lucky.
 */
export function rmvFrom(litres: number, avgDepthM: number, minutes: number): number | null {
  if (!isNumber(litres) || litres <= 0) return null;
  if (!isNumber(avgDepthM) || avgDepthM < 0) return null;
  if (!isNumber(minutes) || minutes <= 0) return null;
  const value = litres / (avgDepthM / METRES_PER_BAR + 1) / minutes;
  return Number.isFinite(value) && value > 0 ? value : null;
}
```

Add a test in `derived.test.ts` proving `rmv` still returns what it did for a known dive — the
extraction must be behaviour-preserving, and the existing suite is the guard.

- [ ] **Step 4: Implement `src/domain/consumption.ts`**

```ts
export const PROFILE_RMV_WINDOW_S = 60;
export const PROFILE_RMV_MIN_DEPTH_M = 1.5;
```

For each index `i`: advance `j` until `t[j] - t[i] >= PROFILE_RMV_WINDOW_S`. **If `j` runs past
the end, stop entirely** — an incomplete window emits nothing. Take the mean depth over
`[i..j]`; skip if it is below `PROFILE_RMV_MIN_DEPTH_M`. Litres = `(bar[i] - bar[j]) × sizeL ×
cylinderCount`. Call `rmvFrom(litres, meanDepth, spanSeconds / 60)`; skip a `null`. Anchor the
point at the window's **midpoint**. Return `[]` when the tank has no `sizeL`, or when no sample
carries a pressure.

- [ ] **Step 5: Run the tests**

Run: `npx jest src/domain/consumption.test.ts src/domain/derived.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/consumption.ts src/domain/consumption.test.ts src/domain/derived.ts src/domain/derived.test.ts
git commit -m "Compute consumption over a window, from the one formula that already existed"
```

---

### Task 3: The `import_device` column

**Files:**
- Modify: `src/db/schema.ts` (`dives`, beside `importSource`/`importId`)
- Create: `src/db/migrations/0004_*.sql` (generated)
- Modify: `supabase/migrations/20260902090100_schema.sql` (the `dives` table)
- Modify: `supabase/migrations/20260902090300_sync_rpcs.sql` (**three sites**: the insert column list ~line 313, the values list ~line 325, and the `on conflict do update set` ~line 344)
- Modify: `src/domain/import/suunto.ts`
- Test: `src/domain/import/suunto.test.ts`

**Interfaces:**
- Produces: `dives.importDevice: text | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/import/suunto.test.ts
it('records which computer wrote the file, so the dive can say where it came from', () => {
  const { dive } = only('suunto-d5');
  expect(dive.importDevice).toBe('Suunto D5');
});

it('leaves the device null when the export does not name one', () => {
  // Not defensive tidiness: every dive imported before this column existed is permanently in
  // this state, because dedupe skips an already-imported dive and a deleted one stays deleted.
  const bytes = new TextEncoder().encode(
    JSON.stringify({ DeviceLog: { Header: { DateTime: '2026-02-19T11:22:08.290+08:00' } } }),
  );
  expect(suuntoJsonImporter.parse(bytes)[0]?.dive.importDevice ?? null).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/domain/import/suunto.test.ts -t "which computer"`
Expected: FAIL — `importDevice` is undefined.

- [ ] **Step 3: Add the column**

In `src/db/schema.ts`, beside `importSource`/`importId`:

```ts
  /** Which computer wrote the file this dive came from — `Suunto D5`. Its siblings above say
   * WHAT read it and WHICH dive it was; this says what recorded it, and it is what the dive
   * detail's `Imported from` row names. Null for every dive imported before it existed, and
   * permanently so: dedupe skips an already-imported dive, so re-running the files cannot
   * backfill it. The row falls back to the importer's own label. */
  importDevice: text('import_device'),
```

Run `npm run db:generate`. Add `import_device text,` to the Postgres `dives` table beside
`import_id`, then add it to all **three** `push_changes` sites. `syncRpcParity` fails if any is
missed — read its message, it names the site.

In `suunto.ts`, read `log?.Device?.Name ?? header?.Device?.Name`, keeping it null when absent.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, including `schemaParity` and `syncRpcParity`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations supabase/migrations src/domain/import/suunto.ts src/domain/import/suunto.test.ts
git commit -m "Let a dive name the computer that recorded it"
```

---

### Task 4: `react-native-svg` and the static profile card

**Files:**
- Modify: `package.json`
- Create: `src/db/useDiveSamples.ts`
- Create: `src/components/DepthProfile.tsx`
- Test: `src/components/DepthProfile.test.tsx`, `src/db/useDiveSamples.test.ts`

**Interfaces:**
- Consumes: `depthAxis`, `colourRuns`, `medianIntervalS` (Task 1); `consumptionSeries` (Task 2); `getDiveSamples` (`src/db/diveSamples.ts`)
- Produces: `useDiveSamples(diveId)`, `<DepthProfile dive scheme units />`

**Adding a native module means the dev client must be rebuilt** before this runs on a device. Jest does not need it.

- [ ] **Step 1: Install**

```bash
npx expo install react-native-svg
```

Use `expo install`, not `npm install` — it picks the version matching the SDK.

- [ ] **Step 2: Write the failing test**

```ts
// src/components/DepthProfile.test.tsx
it('draws nothing at all for a dive with no samples', async () => {
  const t = await render(<DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={null} scheme="light" units="metric" />);
  expect(t.root.queryAll((n) => n.type === 'RNSVGPath')).toHaveLength(0);
  expect(textIn(t)).toEqual([]);
});

it('strokes one path per depth band, so no stroke spans two colours', async () => {
  const t = await render(<DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />);
  const paths = t.root.queryAll((n) => n.type === 'RNSVGPath');
  expect(paths.length).toBeGreaterThan(1);
  const colours = new Set(paths.map((p) => String(p.props.stroke)));
  expect(colours.size).toBeGreaterThan(1);
});

it('states the sample count and the interval the device actually used', async () => {
  const t = await render(<DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />);
  expect(textIn(t).join(' ')).toContain(String(FIXTURE.length));
  expect(textIn(t).join(' ')).toContain('10');
});

it('draws no consumption trace for a dive with no per-sample pressure', async () => {
  const noGas = FIXTURE.map(([t2, d]) => [t2, d, null, null] as DiveSample);
  const t = await render(<DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={noGas} scheme="light" units="metric" />);
  expect(textIn(t).join(' ')).not.toContain('l/min');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx jest src/components/DepthProfile.test.tsx`
Expected: FAIL — `Cannot find module './DepthProfile'`

- [ ] **Step 4: Write `src/db/useDiveSamples.ts`**

Copy `src/db/useGearPresets.ts`'s shape exactly — `useLiveQuery` over a rows query, `isResolved`,
`useCurrentError` from `./liveQuery`. Return `{ samples: DiveSample[] | null; resolved; error }`.

- [ ] **Step 5: Write `src/components/DepthProfile.tsx`**

Renders nothing (`return null`) when `samples` is null or shorter than two points — §0.4, and no
placeholder. Otherwise an `<Svg>` containing one `<Path>` per colour run (`stroke` = the run's
colour, `strokeLinejoin="round"`, `strokeLinecap="round"`, `fill="none"`), one `<Path>` for the
consumption series in the muted ink token, its right axis running 0 to `ceil(max / 10) * 10` so
both sides of the plot round by one convention, `<Line>` gridlines, axis labels as `<Text>` from
`makeStyles`, and a `<Circle>` at the deepest sample in its own band colour.

**The gas path breaks at gaps:** where consecutive consumption points are more than
`2 × PROFILE_RMV_WINDOW_S` apart, start a new `M` rather than an `L`, so a surface interval is
not bridged by a line nobody measured.

Colours come from `depthColor()` and the theme tokens only — never a literal.

- [ ] **Step 6: Run the tests, then the suite**

Run: `npx jest src/components/DepthProfile.test.tsx && npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/db/useDiveSamples.ts src/db/useDiveSamples.test.ts src/components/DepthProfile.tsx src/components/DepthProfile.test.tsx
git commit -m "Draw a dive's profile as a real stroked curve"
```

---

### Task 5: Scrubbing and the readout

**Files:**
- Modify: `src/components/DepthProfile.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/cs.ts`
- Test: `src/components/DepthProfile.test.tsx`

**Interfaces:**
- Consumes: `react-native-gesture-handler`'s `Gesture.Pan()` (already a dependency)

- [ ] **Step 1: Write the failing test**

```ts
it('reads out the deepest sample before anyone touches it', async () => {
  // Never empty, never shifts the layout, always real data — and it explains the marked dot.
  const t = await render(<DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />);
  expect(textIn(t).join(' ')).toContain('24,3');
});

it('shows an em dash for gas where the dive has none', async () => {
  const noGas = FIXTURE.map(([t2, d]) => [t2, d, null, null] as DiveSample);
  const t = await render(<DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={noGas} scheme="light" units="metric" />);
  expect(textIn(t).join(' ')).toContain('—');
});

it('scrubs to the sample under the finger', async () => {
  const t = await render(<DepthProfile dive={dive({ maxDepthM: 24.33 })} samples={FIXTURE} scheme="light" units="metric" />);
  // The plot reports its own width through onLayout before any gesture can be mapped to a
  // sample, so give it one; without this the scrub has no scale and every x maps to index 0.
  await act(async () => {
    fireEvent(findPlot(t), 'layout', { nativeEvent: { layout: { width: 300, height: 150, x: 0, y: 0 } } });
  });
  await act(async () => scrubTo(t, 300));          // the far right of the plot
  expect(textIn(t).join(' ')).toContain(formatDepth(FIXTURE[FIXTURE.length - 1]![1], 'metric'));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/components/DepthProfile.test.tsx -t "readout"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Expose the scrub seam the test needs: give the plot wrapper a `testID` (`findPlot` finds it) and
drive the pan through `react-native-gesture-handler/jest-utils`' `fireGestureHandler` (`scrubTo`
wraps it). Read that package's docs before writing the helper — hand-firing raw touch events at a
GH gesture does not work.

**Do not assert on the gesture's config object.** `activeOffsetX` is real and required, but a test
reading a gesture's internals passes whether or not scrubbing works; the behavioural test above is
the one that fails when it breaks.

A readout row above the plot showing depth and gas for the scrubbed index, defaulting to the
index of the deepest sample. A `Gesture.Pan()` with `activeOffsetX([-8, 8])` maps `x` to the
nearest sample by time; a vertical hairline draws at that x. Gas shows an em dash when the
scrubbed position has no consumption point — inside a gap, or on a dive with no pressure.

New i18n keys in both languages: a label for depth, a label for gas, and the `l/min` unit. Czech
must not put `Ponor` in a sentence that also means a dive.

- [ ] **Step 4: Run the tests and the suite**

Run: `npx jest src/components/DepthProfile.test.tsx && npm test && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/components/DepthProfile.tsx src/components/DepthProfile.test.tsx src/i18n/en.ts src/i18n/cs.ts
git commit -m "Let a diver put a finger on the curve and read it"
```

---

### Task 6: The row sparkline

**Files:**
- Create: `src/components/ProfileSparkline.tsx`
- Modify: `src/components/DiveRow.tsx`
- Test: `src/components/ProfileSparkline.test.tsx`, `src/components/DiveRow.test.tsx`

**Interfaces:**
- Consumes: `sparklinePoints` (Task 1)
- Produces: `<ProfileSparkline samples scheme />`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/ProfileSparkline.test.tsx
it('draws one monochrome path, because the number beside it carries the colour', async () => {
  const t = await render(<ProfileSparkline samples={FIXTURE} scheme="light" />);
  const paths = t.root.queryAll((n) => n.type === 'RNSVGPath');
  expect(paths).toHaveLength(1);
  expect(new Set(paths.map((p) => String(p.props.stroke))).size).toBe(1);
});

it('draws nothing, and no placeholder, for a dive with no samples', async () => {
  const t = await render(<ProfileSparkline samples={null} scheme="light" />);
  expect(t.root.queryAll((n) => n.type === 'RNSVGPath')).toHaveLength(0);
});
```

```ts
// src/components/DiveRow.test.tsx
it('shows a sparkline only for a dive that has a series', async () => {
  const withSamples = await render(<DiveRow dive={dive({ id: 'a' })} samples={FIXTURE} number={1} scheme="light" units="metric" onPress={() => {}} />);
  expect(withSamples.root.queryAll((n) => n.type === 'RNSVGPath').length).toBeGreaterThan(0);
  const without = await render(<DiveRow dive={dive({ id: 'b' })} number={1} scheme="light" units="metric" onPress={() => {}} />);
  expect(without.root.queryAll((n) => n.type === 'RNSVGPath')).toHaveLength(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/components/ProfileSparkline.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`ProfileSparkline` renders one `<Path>` from `sparklinePoints(samples, 40)`, stroked in the muted
ink token, no axes, no marker, no interaction. Returns `null` for fewer than two points.

`DiveRow` takes an optional `samples` prop and renders it beside the metadata. The row's depth
number and its colour are unchanged.

- [ ] **Step 4: Run the tests and the suite**

Run: `npx jest src/components/ProfileSparkline.test.tsx src/components/DiveRow.test.tsx && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/components/ProfileSparkline.tsx src/components/ProfileSparkline.test.tsx src/components/DiveRow.tsx src/components/DiveRow.test.tsx
git commit -m "Give a row with a real series a shape to show"
```

---

### Task 7: Wire it into the dive detail

**Files:**
- Modify: `src/screens/DiveDetailScreen.tsx` (card between the hero and the first `Cluster` at ~line 880; the docblock at ~line 113 asserts *"No profile chart, sparkline, or other graphic is drawn"* and becomes false)
- Modify: `src/i18n/en.ts`, `src/i18n/cs.ts`
- Test: `src/screens/DiveDetailScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it('puts the profile between the hero and the first cluster, where §0.4 reserved the space', async () => {
  const t = await renderDetailTree(dive({ id: 'd', maxDepthM: 24.33 }), { samples: FIXTURE });
  const lines = textIn(t);
  expect(lines.indexOf('Depth profile')).toBeGreaterThan(lines.indexOf('24,3'));
  expect(lines.indexOf('Depth profile')).toBeLessThan(lines.indexOf('Date & time'));
});

it('names the computer a dive was imported from', async () => {
  const t = await renderDetailTree(dive({ id: 'd', importSource: 'suunto-app-json', importDevice: 'Suunto D5' }));
  expect(textIn(t).join(' ')).toContain('Suunto D5');
});

it('falls back to the importer’s own label when the device was never recorded', async () => {
  // The permanent state of every dive imported before the column existed.
  const t = await renderDetailTree(dive({ id: 'd', importSource: 'suunto-app-json', importDevice: null }));
  expect(textIn(t).join(' ')).toContain('Suunto');
});

it('says nothing about importing for a dive the diver logged by hand', async () => {
  const t = await renderDetailTree(dive({ id: 'd', importSource: null }));
  expect(textIn(t).join(' ')).not.toContain('Imported from');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest src/screens/DiveDetailScreen.test.tsx -t "profile"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Render `<DepthProfile>` between the hero and the first `Cluster`, reading samples via
`useDiveSamples(dive.id)`.

**Add `importerLabelFor(source: string): string | null` to `src/domain/import/registry.ts`** —
it does not exist yet; the registry exports `importerLabels()` (every label) and `IMPORTERS`. It
looks a source up in `IMPORTERS` and returns that importer's `label()`, or null for a source no
importer claims. The row then shows `importDevice ?? importerLabelFor(importSource)`, and renders
not at all when both are null.
**No chevron** — §0.6 spends it on in-place disclosure and *"the mark is never spent on
navigation"*, and there is nowhere to navigate to. Update the screen's docblock, which currently
claims no graphic is drawn.

- [ ] **Step 4: Run the suite**

Run: `npm test && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/screens/DiveDetailScreen.tsx src/screens/DiveDetailScreen.test.tsx src/i18n/en.ts src/i18n/cs.ts
git commit -m "Put the profile where §0.4 said it would go"
```

---

### Task 8: Verify on the device, and record it

**Files:**
- Modify: `DESIGN.md` (§0.4, §3, §9, §10)

- [ ] **Step 1: Rebuild and look**

```bash
npx expo run:ios --device "iPhone 17 Pro"
```

`react-native-svg` is a native module, so the dev client must be rebuilt. If `pod install` fails
complaining about encoding, prefix the command with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` — this
shell's `LANG` is empty.

Open the imported Marsa Shona dive and confirm: the curve is continuous and changes colour with
depth; the deepest sample is marked; the consumption trace starts after the descent and stops
before the surface; scrubbing updates the readout and does not trap the page's scroll; the
pod-less dive shows a depth curve and no gas trace; a hand-logged dive shows no card at all.

- [ ] **Step 2: Write the DESIGN.md entries**

Per the spec's §10: amend §10's `react-native-svg` decision with the new information and note
that `RmvSparkline` is unchanged; record in §0.4 that the promise is built, with the 60 s window,
the complete-window and 1.5 m rules, and the consumption companion; add the card to §3's dive
detail; move the profile out of §9's post-release shelf as the owner's call, dated.

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md
git commit -m "Record the profile, and why SVG earned its place"
```

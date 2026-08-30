import { render, type RenderResult } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import { dive } from '../domain/diveFixture';
import { useDives } from '../db/useDives';
import { type Dive, type Tank } from '../domain/types';
import DiveDetailScreen from './DiveDetailScreen';

// Same two mocks every test in this file needs: the one read (useDives, per db/useDives.ts's
// own docblock: "the one read every screen uses") and the route param expo-router hands the
// screen. Neither is exercised by DivesScreen.test.tsx, so this is the first test file in the
// app that needs to fake expo-router's half at all. Jest hoists both jest.mock() calls above
// the imports above at transform time regardless of where they sit textually (see
// DivesScreen.test.tsx's own note on this), so plain ES imports of the mocked names work.
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn() }));

// Adapted from the brief's react-test-renderer-shaped example to the API the installed
// @testing-library/react-native@14 actually exposes — the same adaptation DivesScreen.test.tsx,
// DiveRow.test.tsx and DepthValue.test.tsx already use: `render` wraps its own `act()` and is
// async, and its `root` is a test-renderer `TestInstance` exposing `queryAll(predicate)` rather
// than `findAllByType`. The brief's own assertions are otherwise unchanged; only the two render
// helpers below are made async so they can `await render(...)` before reading the tree.
function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

const mockUseDives = useDives as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as jest.Mock;

afterEach(() => {
  mockUseDives.mockReset();
  mockUseLocalSearchParams.mockReset();
});

/** Renders the screen for `target` with `dives` as the full list `useDives()` returns —
 * the shape the screen must search itself, per db/useDives.ts's "the one read" contract. */
async function renderDetailIn(dives: Dive[], target: Dive): Promise<string[]> {
  mockUseDives.mockReturnValue({ dives, numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: target.id });
  return textIn(await render(<DiveDetailScreen />));
}

/** The common case: `target` is the only dive in the logbook. */
async function renderDetail(target: Dive): Promise<string[]> {
  return renderDetailIn([target], target);
}

async function renderDetailTree(target: Dive): Promise<RenderResult> {
  mockUseDives.mockReturnValue({ dives: [target], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: target.id });
  return render(<DiveDetailScreen />);
}

async function renderDetailFor(id: string): Promise<string[]> {
  // A non-empty list that does NOT contain `id`, so this actually proves the screen matches
  // on the id rather than merely reacting to an empty logbook.
  mockUseDives.mockReturnValue({ dives: [dive({ id: 'some-other-id' })], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id });
  return textIn(await render(<DiveDetailScreen />));
}

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: 'steel', sizeL: 12, count: 1, workingBar: 232,
  o2Pct: 32, hePct: null, startBar: 200, endBar: 50, ...over,
});

const diveWithGas = dive({
  avgDepthM: 20,
  maxDepthM: 25,
  durationMin: 45,
  tanks: [tank()],
});

it('shows the computed values a diver cannot see in the raw fields', async () => {
  const text = (await renderDetail(diveWithGas)).join(' ');
  expect(text).toContain('RMV');
  expect(text).toContain('MOD');
});

it('omits a computed value entirely when its inputs are missing', async () => {
  const text = (await renderDetail(dive({ date: '2026-08-16' }))).join(' ');
  expect(text).not.toContain('RMV');
  expect(text).not.toContain('NaN');
});

// The test above proves RMV is absent when the WHOLE Gas & cylinders cluster is (no
// tanks at all) — it can't tell a per-value guard from a cluster-level one apart, since
// with no tanks the cluster never renders regardless of what guards the RMV row itself.
// This dive has tanks (so the cluster does render, and "Gas used" is computable from
// them alone) but no avgDepthM/durationMin, so rmv() specifically returns null while
// gasUsedLitres() does not — isolating the row-level "never render what the domain
// refused to produce" guard on RMV from the cluster-level one.
it('omits RMV specifically when depth or duration is missing, even though its cluster renders', async () => {
  const text = (await renderDetail(dive({ date: '2026-08-16', tanks: [tank()] }))).join(' ');
  expect(text).toContain('Gas used');
  expect(text).not.toContain('RMV');
});

it('shows nothing but the date for a dive with only a date', async () => {
  const text = (await renderDetail(dive({ date: '2026-08-16' }))).join(' ');
  expect(text).toContain('16 Aug 2026');
  expect(text).not.toContain('null');
});

it('draws no profile chart, because no dive carries a sample series', async () => {
  const t = await renderDetailTree(diveWithGas);
  const svgNodes = t.root ? t.root.queryAll((n) => n.type === 'Svg') : [];
  expect(svgNodes).toHaveLength(0);
});

it('says the dive is gone rather than crashing when the id is unknown', async () => {
  const text = (await renderDetailFor('no-such-id')).join(' ');
  expect(text.toLowerCase()).toContain('not found');
});

// Not in the brief's sample, but surfaceIntervalMin is one of the six computed values the
// brief names, and none of the tests above actually exercise it. useDives() hands back every
// live dive newest-date-first, so the dive that happened BEFORE `target` sits at the NEXT
// array index, not the previous one — this pins that direction with a real, checkable number
// (the same 08:12 + 44 min -> 102 min example derived.test.ts's own surfaceIntervalMin suite
// uses), not just presence-of-a-label. Getting the index direction backwards would either
// omit this row entirely or pair `target` with the wrong dive.
it('computes surface interval from the previous LOGGED dive, in list order newest-first', async () => {
  const earlier = dive({ id: 'earlier', date: '2026-08-16', timeIn: '08:12', durationMin: 44 });
  const target = dive({ id: 'target', date: '2026-08-16', timeIn: '10:38' });
  // newest-first: target (10:38) sorts before earlier (08:12) on the same date.
  const text = (await renderDetailIn([target, earlier], target)).join(' ');
  expect(text).toContain('102 min');
});

// Not in the brief's sample, but the same class of bug this milestone has hit repeatedly
// (see diveNumber.ts's history: "a logbook rendering dives numbered #2, #1, #3"): useDives()
// hands back every live dive newest-date-first, so the screen must find ITS dive inside that
// list by id, not assume it is dives[0] or the only entry. Two dives, and the target is
// deliberately NOT first, so a screen that read the wrong index would fail this loudly.
it('finds its own dive inside a multi-dive list, not just the first entry', async () => {
  const target = dive({ id: 'target', siteName: 'Shark Reef', date: '2026-08-10' });
  const other = dive({ id: 'other', siteName: 'Blue Hole', date: '2026-08-20' });
  // useDives() order is newest-date-first: `other` (20th) before `target` (10th).
  const text = (await renderDetailIn([other, target], target)).join(' ');
  expect(text).toContain('Shark Reef');
});

// §1's no-form-shaming stance applies to booleans too: `false` is a real recorded answer
// ("no hood worn"), not the same as `null` ("never asked"). A naive `dive.hood &&
// <Text>...</Text>` would hide a false the same way it hides a null, silently turning "no
// hood" into "hood unknown" on screen — the exact class of information loss this guards.
it('shows an explicitly recorded false, not just a truthy value', async () => {
  const text = (await renderDetail(dive({ date: '2026-08-16', hood: false }))).join(' ');
  expect(text.toLowerCase()).toContain('no');
});

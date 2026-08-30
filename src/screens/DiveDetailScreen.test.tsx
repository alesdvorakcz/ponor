import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

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
//
// `router` is faked alongside `useLocalSearchParams` (review task 7, Important #1): the
// screen's own back control calls `router.back`/`canGoBack`/`replace` directly (the same
// imperative singleton DivesScreen.tsx already uses for `openDive`/`logDive`), not through a
// hook, so it needs the same module mock rather than a render prop.
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  router: { back: jest.fn(), canGoBack: jest.fn(), replace: jest.fn() },
}));

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
const mockCanGoBack = router.canGoBack as jest.Mock;
const mockBack = router.back as jest.Mock;
const mockReplace = router.replace as jest.Mock;

afterEach(() => {
  mockUseDives.mockReset();
  mockUseLocalSearchParams.mockReset();
  mockCanGoBack.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
});

/** The screen's one back control, wherever it sits in the tree (both the found and the
 * not-found branch render it). Throws rather than returning undefined for the same reason
 * DivesScreen.test.tsx's findSearchInput does: a test that finds none should fail at the
 * query, not at a confusing downstream fireEvent error. */
function findBackButton(t: RenderResult) {
  const [button] = t.root
    ? t.root.queryAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Back to dives')
    : [];
  if (!button) throw new Error('DiveDetailScreen did not render a back control');
  return button;
}

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

/** Same not-found setup as renderDetailFor, but keeps the tree instead of flattening it to
 * text — for assertions that need to find and press a control, not just read strings. */
async function renderDetailTreeFor(id: string): Promise<RenderResult> {
  mockUseDives.mockReturnValue({ dives: [dive({ id: 'some-other-id' })], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id });
  return render(<DiveDetailScreen />);
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

// Review task 7, Important #2: every cluster is gated the same way (`{X.length > 0 && ...}`,
// `{showDepthDuration && ...}`, `{dive.tanks.length > 0 && ...}`, `{hasNotes && ...}`), and
// nothing previously checked that a cluster's HEADING disappears along with its rows — only
// that specific bad values (RMV, NaN, null) were absent. Confirmed live: mutating
// `{where.length > 0 && (` to `{true && (` makes "Site & centre" render as a bare heading
// over zero rows, and every other test in this file stayed green.
//
// A fixture with EVERYTHING null (like the one above) can't tell that mutation apart from
// "nothing on the screen renders at all" — with every cluster absent, "Site & centre" isn't
// there either way, mutated or not. This fixture instead populates exactly one cluster
// (Depth & duration) and leaves the other five untouched, so the assertion is load-bearing
// two ways: the populated cluster proves rendering does reach past Date & time, and each
// omitted cluster's absence is then attributable to its OWN guard, not to a broken render.
it('omits a cluster heading entirely when every field in it is absent, not just its rows', async () => {
  const text = (
    await renderDetail(dive({ date: '2026-08-16', maxDepthM: 25, avgDepthM: 20, durationMin: 40 }))
  ).join(' ');
  expect(text).toContain('Depth & duration');
  expect(text).toContain('25.0 m');
  expect(text).not.toContain('Site & centre');
  expect(text).not.toContain('Conditions');
  expect(text).not.toContain('Gas & cylinders');
  expect(text).not.toContain('Equipment & people');
  expect(text).not.toContain('Notes');
});

// Status now renders unconditionally (Minor #5 below), so a dive with only a date recorded
// shows the date AND the status — never nothing else, since status is never null.
it('shows nothing but the date and status for a dive with only a date', async () => {
  const text = (await renderDetail(dive({ date: '2026-08-16' }))).join(' ');
  expect(text).toContain('16 Aug 2026');
  expect(text).toContain('Logged');
  expect(text).not.toContain('null');
});

// Review task 7, Minor #5: a planned dive was indistinguishable from a logged one on this
// screen — nothing showed `status` at all, so an otherwise-sparse planned dive (only date,
// maybe a site) looked identical to a logged dive missing most of its fields. Quiet and
// monochrome on purpose (§0.1: colour is depth and nothing else) — this is a plain Row like
// any other, not a badge.
it("shows a planned dive's status, distinctly from a logged one", async () => {
  const text = (await renderDetail(dive({ date: '2026-09-01', status: 'planned' }))).join(' ');
  expect(text).toContain('Planned');
  expect(text).not.toContain('Logged');
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

// Review task 7, Minor #4: entry/salinity/waterBody/suit used to render as the raw stored
// value ("boat", "quarry") rather than through format/display.ts's formatters — the
// database's vocabulary, not the diver's. Checks the screen actually wires those formatters
// in (already unit-tested in isolation in display.test.ts), not just that they exist.
it('formats enum fields for the diver instead of showing the raw stored value', async () => {
  const text = (
    await renderDetail(
      dive({ date: '2026-08-16', entry: 'boat', salinity: 'salt', waterBody: 'quarry', suit: 'semidry' }),
    )
  ).join(' ');
  expect(text).toContain('Boat');
  expect(text).toContain('Salt');
  expect(text).toContain('Quarry');
  expect(text).toContain('Semidry');
  expect(text).not.toContain('boat');
  expect(text).not.toContain('salt');
  expect(text).not.toContain('quarry');
  expect(text).not.toContain('semidry');
});

// Review task 7, Important #1: _layout.tsx sets headerShown: false app-wide and this screen
// used to render no back control of its own, leaving the invisible iOS edge-swipe as the
// only exit — undiscoverable, and below the §0.5 48 dp tap-target floor by construction. The
// three tests below pin the two branches of the guard the fix relies on (router.canGoBack()),
// plus that the not-found branch — reachable directly by a deep link, where there is no
// history to pop — gets the same control rather than being a dead end.
it('pops the navigation stack when there is history to go back to', async () => {
  mockCanGoBack.mockReturnValue(true);
  const t = await renderDetailTree(diveWithGas);
  await fireEvent.press(findBackButton(t));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

it('replaces to the dives list instead, for a cold deep link with no history to pop', async () => {
  mockCanGoBack.mockReturnValue(false);
  const t = await renderDetailTree(diveWithGas);
  await fireEvent.press(findBackButton(t));
  expect(mockReplace).toHaveBeenCalledWith('/');
  expect(mockBack).not.toHaveBeenCalled();
});

it('still offers a way back when the dive id is unknown, not just a dead end', async () => {
  const t = await renderDetailTreeFor('no-such-id');
  // Only presence is asserted here — the two tests above already pin which of
  // back()/replace() the press dispatches to, for either branch.
  expect(() => findBackButton(t)).not.toThrow();
});

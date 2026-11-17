// The package's own official Jest mock — this screen now calls useSafeAreaInsets() for its
// root's top clearance (`screenTopInset`, theme/styles.ts), gets a real SafeAreaProvider for
// free from expo-router's root layout in the app, and has none when rendered bare here.
// Imported first, and named `mock...`, for the babel-plugin-jest-hoist reason
// DiveFormScreen.test.tsx records: a jest.mock() factory may only close over out-of-scope
// identifiers starting with `mock`/`require`, and every jest.mock() call is hoisted above
// every import regardless. Left on the mock's own zero insets by every test in this file:
// where the clearance actually LANDS is `styles.test.ts`'s rule to pin, not a number to
// restate here.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, cleanup, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, StyleSheet } from 'react-native';

import { dive } from '../domain/diveFixture';
import {
  formatCurrent,
  formatDepthParts,
  formatSurge,
  formatWaves,
  HE_LABEL,
  N2_LABEL,
  O2_LABEL,
} from '../format/display';
import { softDeleteDive } from '../db/dives';
import { type DiveSample } from '../db/schema';
import { useDives, type DiveListState } from '../db/useDives';
import { useDiveSamples } from '../db/useDiveSamples';
import { useDiveSite } from '../db/useDiveSite';
import { useUnitSystem } from '../db/useUnitSystem';
import { suuntoJsonImporter } from '../domain/import/suunto';
import { fixtureSeries } from '../testing/suuntoFixture';
// Namespace import, not the usual named one: the completeness test below (`marks every
// value this screen reads from derived.ts as computed`) needs the module's own export list
// at runtime, via `Object.keys`, rather than a set of names typed into this file — see that
// test's own comment for why.
import * as derived from '../domain/derived';
import { type Dive, type DiveSite, type Tank } from '../domain/types';
import { completeDiveHref, editDiveHref } from '../navigation/editDiveLink';
import { setActiveLanguage, t } from '../i18n';
import { depthColor } from '../theme/depth';
import { fonts } from '../theme/fonts';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import DiveDetailScreen, { conditionTiles } from './DiveDetailScreen';

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
jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
// The unit preference (§3), mocked per module exactly as `useDives` is above and for the
// same reason: it is a live database read, and this screen must be renderable in either
// system without one. Left on its own default, `metric`, by every test that does not care
// — which is what keeps the existing assertions below reading in metres, unchanged.
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
// This dive's recorded profile (§0.4's card), the third live read this screen makes, mocked
// per module for the reason the two above are: it opens a real SQLite subscription, and the
// screen must be renderable without one. Its default is `samples: null` — the state EVERY
// dive in the app was in before the import landed and the state most dives stay in — so
// every assertion written before this hook existed goes on rendering a screen with no card
// on it, unchanged.
//
// The factory returns a fresh object per call rather than one shared literal, which is the
// hoisting-safe half of the same lesson `stubDives` below records at length: the real hook
// builds its wrapper in its own return statement, so a screen written against a stub that
// hands back one forever-stable object can loop in the running app with every test here
// green. It closes over nothing, so babel-plugin-jest-hoist's `mock`-prefix rule (see this
// file's header) does not come into it.
jest.mock('../db/useDiveSamples', () => ({
  useDiveSamples: jest.fn(() => ({ samples: null, resolved: true, error: undefined })),
}));

// M1d task 7: this screen now writes, too — the one write it has, `softDeleteDive`. Mocked
// per module exactly as DiveFormScreen.test.tsx mocks `createDive`/`updateDive`, so a delete
// test controls what the write resolves or rejects with and no real database is involved.
// `router.push` joins the fake for the Edit control, which opens `/dive/[id]/edit`.
jest.mock('../db/dives', () => ({ softDeleteDive: jest.fn() }));
// A planned dive's *Show on map* reads its one site live (#27's two reviews); no site unless a test
// hands one over.
jest.mock('../db/useDiveSite', () => ({ useDiveSite: jest.fn(() => null) }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  router: { back: jest.fn(), canGoBack: jest.fn(), replace: jest.fn(), push: jest.fn() },
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

// M1c closing fixes, Important #1 — see DiveRow.test.tsx's own copy of this helper for the
// full account (this screen's "draws no profile chart" test below shared the exact same
// defect: `n.type === 'Svg'` can never match, since react-native-svg is not a dependency
// and 'Svg' appears nowhere else under src/). §0.4 also covers this screen explicitly — "no
// profile chart, sparkline, or other graphic is drawn... this screen does not import
// anything that could draw one" — so the guard here checks the same two realistic shapes:
// a suspiciously-named element type, or a `View` styled with anything this screen's own
// `makeStyles(scheme)` didn't hand out. `known` is every value `makeStyles` returns, not a
// hand-picked list of this screen's dozen-plus View styles, so it can't go stale as the
// screen's own clusters change.
//
// Shared now (`src/testing/unexpectedGraphics.ts`), and fixed there: all five copies read
// `!style.some(known.includes)`, so one known style excused every literal beside it and
// `[styles.detailRow, { backgroundColor: '#f00' }]` passed.

/**
 * M1c task 5 helpers, updated for task 7's `=` mark (DESIGN.md §0.6, revised): a computed
 * row used to be a pure style difference — a `paddingLeft` the label picked up, with no new
 * text — so telling a marked row from an unmarked one needed a style-probing helper. It is
 * now a real, visible sibling instead: `Row` (DiveDetailScreen.tsx) renders a `Text` reading
 * exactly `=` immediately before a computed value's own `Text`, both inside one wrapping
 * `detailValueWrap` View, so `isMarked` below finds it directly rather than through a proxy.
 * `styleArrayOf`/`colorOf`/`fontSizeOf` still pull one concrete style property off a Text
 * node's (possibly array) `style` prop, the same `[style].flat(3).filter(Boolean).
 * reduce(...)` shape the brief's own sample and DepthValue.test.tsx's `sizeOf` already use —
 * still needed below to prove the value itself is muted and shrunk, independently of
 * whether the mark is present. `textNode` finds a Text node by its own exact (non-nested)
 * child string — never a substring match, so 'Time' can't accidentally match 'Time out', and
 * so a value ever concatenated into one `"= 09:59"` string (rather than kept as its own
 * untouched `"09:59"`) would make `textNode(t, '09:59')` return undefined and every test
 * built on it fail loudly, not silently pass for the wrong reason.
 */
function textNode(t: RenderResult, s: string) {
  return textNodesOf(t).find((n) => String(n.children[0] ?? '') === s);
}

function styleArrayOf(node: ReturnType<typeof textNode>): any[] {
  return [node?.props.style].flat(3).filter(Boolean);
}

function colorOf(node: ReturnType<typeof textNode>): unknown {
  return styleArrayOf(node).reduce((a: unknown, s: any) => s?.color ?? a, undefined);
}

function fontSizeOf(node: ReturnType<typeof textNode>): number {
  return styleArrayOf(node).reduce((a: number, s: any) => s?.fontSize ?? a, 0);
}

/**
 * Whether the value node `textNode(t, value)` finds is marked as computed — true only when
 * a `Text` reading exactly `=` sits among ITS OWN siblings (`node.parent.children`), i.e.
 * inside the same `detailValueWrap` `Row` renders around one field's mark-and-value pair,
 * never merely "a `=` exists somewhere on this screen." `.parent`/`.children` are real
 * `test-renderer` `TestInstance` properties (see node_modules/test-renderer's own
 * `TestInstance` class), so this needs no positional guessing about `textNodesOf`'s flat,
 * whole-screen traversal order. Returns `false` outright when `value` itself was not found —
 * the same "missing reading, not a crash" shape the old `paddingLeftOf` gave a node-less
 * call.
 */
function isMarked(t: RenderResult, value: string): boolean {
  const parent = textNode(t, value)?.parent;
  if (!parent) return false;
  return parent.children.some((c) => typeof c !== 'string' && c.type === 'Text' && c.children[0] === '=');
}

const mockUseDives = useDives as jest.Mock;
/**
 * The one place this file stubs `useDives()`, and deliberately `mockImplementation` rather
 * than `mockReturnValue`.
 *
 * The real hook hands back a **brand-new object holding a brand-new array on every render**:
 * `composeDives`'s `toDives` is `rows.map(toDive).sort(...)` (db/dives.ts), and the wrapper
 * object is an object literal in `useDives`'s own return statement. A `mockReturnValue` stub
 * models the opposite contract — one object, referentially stable forever — and a screen
 * written against that fiction can loop infinitely in the real app while every test here
 * stays green (DiveFormScreen did exactly that). Spreading into a fresh array and a fresh
 * `Map` per call is what makes this stub model the hook's real worst case.
 */
function stubDives(state: Partial<DiveListState>) {
  mockUseDives.mockImplementation(() => ({
    // `resolved` defaults to TRUE, and every test in this file that omits it means exactly
    // that: it is about what this screen shows once the read has produced an answer. The
    // renders BEFORE that answer are their own describe block ("before the dives read has
    // answered"), which sets it explicitly — so this default cannot quietly re-hide the
    // defect that block exists for. Written before the spread so an explicit value wins.
    resolved: true,
    ...state,
    dives: [...(state.dives ?? [])],
    numbers: new Map(state.numbers ?? []),
  }));
}

const mockUseLocalSearchParams = useLocalSearchParams as jest.Mock;
const mockCanGoBack = router.canGoBack as jest.Mock;
const mockBack = router.back as jest.Mock;
const mockReplace = router.replace as jest.Mock;
const mockPush = router.push as jest.Mock;
const mockSoftDelete = softDeleteDive as jest.Mock;
const mockUseUnitSystem = useUnitSystem as jest.Mock;
const mockUseDiveSamples = useDiveSamples as jest.Mock;

/**
 * The dive's recorded profile, for the handful of tests that are about the card §0.4 puts on
 * this screen. Everything else leaves the hook on its `null` default and renders a screen with
 * no card, which is what most dives in a real logbook look like.
 *
 * `mockImplementation`, like `stubDives` above and for the same recorded reason: the real hook
 * returns a new wrapper object on every render (`useDiveSamples`, db/useDiveSamples.ts — the
 * `samples` array inside it is what is memoised, not the object around it), and a stub that
 * models the opposite contract lets a component that depends on the fiction stay green here
 * while looping on a device.
 */
function stubSamples(samples: DiveSample[] | null) {
  mockUseDiveSamples.mockImplementation(() => ({ samples, resolved: true, error: undefined }));
}

afterEach(() => {
  // Put back rather than reset: every test below that says nothing about units expects the
  // metric default, and `mockReset` would leave the hook returning `undefined`.
  mockUseUnitSystem.mockReturnValue('metric');
  // Same reasoning for the profile read, and the same shape: `mockReset` would leave the hook
  // returning `undefined`, and this screen would crash destructuring it rather than draw the
  // no-series screen every other test in this file expects.
  stubSamples(null);
  mockUseDiveSamples.mockClear();
  mockUseDives.mockReset();
  mockUseLocalSearchParams.mockReset();
  mockCanGoBack.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
  mockPush.mockReset();
  mockSoftDelete.mockReset();
});

/** The screen's one back control, wherever it sits in the tree (both the found and the
 * not-found branch render it). Throws rather than returning undefined for the same reason
 * DivesScreen.test.tsx's findSearchInput does: a test that finds none should fail at the
 * query, not at a confusing downstream fireEvent error. */
function findBackButton(t: RenderResult) {
  const [button] = t.root
    ? t.root.queryAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Go back')
    : [];
  if (!button) throw new Error('DiveDetailScreen did not render a back control');
  return button;
}

/** Renders the screen for `target` with `dives` as the full list `useDives()` returns —
 * the shape the screen must search itself, per db/useDives.ts's "the one read" contract. */
async function renderDetailIn(dives: Dive[], target: Dive): Promise<string[]> {
  stubDives({ dives, numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: target.id });
  return textIn(await render(<DiveDetailScreen />));
}

/** The common case: `target` is the only dive in the logbook. */
async function renderDetail(target: Dive): Promise<string[]> {
  return renderDetailIn([target], target);
}

async function renderDetailTree(target: Dive): Promise<RenderResult> {
  stubDives({ dives: [target], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: target.id });
  return render(<DiveDetailScreen />);
}

async function renderDetailFor(id: string): Promise<string[]> {
  // A non-empty list that does NOT contain `id`, so this actually proves the screen matches
  // on the id rather than merely reacting to an empty logbook.
  stubDives({ dives: [dive({ id: 'some-other-id' })], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id });
  return textIn(await render(<DiveDetailScreen />));
}

/** Same not-found setup as renderDetailFor, but keeps the tree instead of flattening it to
 * text — for assertions that need to find and press a control, not just read strings. */
async function renderDetailTreeFor(id: string): Promise<RenderResult> {
  stubDives({ dives: [dive({ id: 'some-other-id' })], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id });
  return render(<DiveDetailScreen />);
}

const tank = (over: Partial<Tank> = {}): Tank => ({
  material: 'steel', configuration: 'single', sizeL: 12, workingBar: 232,
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

it('names the cylinder\'s rig, and names it as the rig rather than as the material', async () => {
  // The row that replaced `Count` (§10). It is asserted label-and-value together and
  // alongside its neighbour, because the two failures worth catching are the row vanishing
  // and the row wearing the wrong label — and a bare `toContain('Twinset')` would miss the
  // second. (`Count` was equally untested before this task; that is carried forward here
  // rather than left carried forward.)
  const text = (
    await renderDetail(dive({ date: '2026-08-16', tanks: [tank({ material: 'steel', configuration: 'twinset' })] }))
  ).join(' ');
  expect(text).toContain('Configuration Twinset');
  expect(text).toContain('Material Steel');
});

it('shows nitrogen on an ordinary air cylinder, which is the whole point of reading a blank helium as none', async () => {
  // The owner's ruling, at the place a diver actually meets it. A cylinder recording O2 21
  // and nothing about helium is what every air dive in a logbook looks like, and it reads
  // N2 79 — the figure every dive planner shows. Asserted as label, mark and value together
  // rather than as a bare "79" that could belong to anything: the `=` between them is §0.6's
  // computed prefix, and it is what makes the reading honest, since a figure this app
  // inferred from a field the diver left blank must never read as one they stated.
  const air = (await renderDetail(dive({ date: '2026-08-16', tanks: [tank({ o2Pct: 21, hePct: null })] }))).join(' ');
  expect(air).toContain(`${N2_LABEL} = 79 %`);

  // ...and a mix that states both is untouched by that reading: 18/45 is 37, not 82. A rule
  // that ignored helium entirely would satisfy the line above and strip it from every trimix.
  const trimix = (await renderDetail(dive({ date: '2026-08-16', tanks: [tank({ o2Pct: 18, hePct: 45 })] }))).join(' ');
  expect(trimix).toContain(`${N2_LABEL} = 37 %`);
});

it('shows every cylinder its own MOD, because there is no single dive MOD', async () => {
  const d = dive({
    date: '2026-06-04',
    tanks: [
      { material: 'steel', configuration: 'twinset', sizeL: 12, workingBar: 232, o2Pct: 18, hePct: 45, startBar: 230, endBar: 90 },
      { material: 'alu',   configuration: 'single', sizeL: 7,  workingBar: 200, o2Pct: 50, hePct: 0,  startBar: 200, endBar: 120 },
    ],
  });
  stubDives({ dives: [d], numbers: new Map([[d.id, 212]]), error: undefined });
  // Every render unconditionally calls useLocalSearchParams (it's a hook, not
  // conditionally invoked), so this needs a return value even though the `id`
  // prop below is what the screen actually uses — same pattern as "uses the id
  // prop instead of the route param" further down this file.
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const text = textIn(await render(<DiveDetailScreen id={d.id} />)).join(' | ');
  // 18 % at 1.4 ppO2 -> 67.8 m; 50 % -> 18.0 m
  expect(text).toContain('67.8');
  expect(text).toContain('18.0');
});

it('does not present one cylinder’s MOD as though it were the dive’s', async () => {
  const d = dive({
    date: '2026-06-04',
    tanks: [
      { material: 'steel', configuration: 'single', sizeL: 12, workingBar: 232, o2Pct: 18, hePct: 45, startBar: 230, endBar: 90 },
      { material: 'alu',   configuration: 'single', sizeL: 7,  workingBar: 200, o2Pct: 50, hePct: 0,  startBar: 200, endBar: 120 },
    ],
  });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const mods = textIn(t).filter((s) => s.includes('67.8') || s.includes('18.0'));
  expect(mods.length).toBeGreaterThanOrEqual(2);
});

// The two tests above check that both cylinders' MOD VALUES appear somewhere in the tree,
// but neither counts MOD ROWS — so both would still pass if a leftover dive-level MOD sat
// above the two per-cylinder ones (three "MOD" rows instead of two, the exact regression
// the brief calls out: "Remove the dive-level MOD entirely... do not leave it alongside").
// Verified live: reintroducing `modValue = formatDepth(mod(dive.tanks[0]?.o2Pct))` as a
// third row above the tank list, alongside the two per-cylinder ones, left every other test
// in this file green. This test counts "MOD" LABEL occurrences instead of value strings —
// one per cylinder, never a dive-level extra — which is exactly what that mutation breaks.
it('renders exactly one MOD row per cylinder, and no extra dive-level one', async () => {
  const d = dive({
    date: '2026-06-04',
    tanks: [
      { material: 'steel', configuration: 'twinset', sizeL: 12, workingBar: 232, o2Pct: 18, hePct: 45, startBar: 230, endBar: 90 },
      { material: 'alu',   configuration: 'single', sizeL: 7,  workingBar: 200, o2Pct: 50, hePct: 0,  startBar: 200, endBar: 120 },
    ],
  });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const modLabels = textIn(t).filter((s) => s === 'MOD');
  expect(modLabels).toHaveLength(2);
});

// M1c closing fixes, carried from task 4's review as a Minor: every MOD test above pairs
// MOD's presence/absence with a tank that is either fully usable or (the "never renders the
// literal string NaN" fixture, further down this file) has every field non-finite at once —
// neither isolates the guard `tankFields` puts on MOD alone (`if (tankMod !== null)`,
// DiveDetailScreen.tsx) from the guards on every other field. `o2Pct: 0` is the case that
// does: a real, finite, diver-recorded percentage — `formatPercent` has no bounds check, so
// the O₂ row itself still renders "0 %" — but `mod()`'s own domain guard (`o2Pct <= 0`,
// derived.ts) refuses it as a MOD input, same as it refuses `mod(-5)` or `mod(101)`
// (derived.test.ts). Pressures and sizes are the fixture's untouched, fully usable defaults,
// and `hePct` is given a real reading too, so this proves the OMISSION IS SCOPED to MOD
// alone, not a symptom of the tank being sparse.
it('omits MOD alone on an otherwise fully-populated cylinder, when only its O₂ % is unusable', async () => {
  const d = dive({
    date: '2026-06-04',
    tanks: [tank({ o2Pct: 0, hePct: 21 })],
  });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const text = textIn(t).join(' ');
  // Every other tank field the fixture recorded is still on screen...
  // "Steel", not the stored 'steel'. This assertion used to pin the raw word, which is the
  // side that was wrong: the form's own chip has always said "Steel", so the same cylinder
  // read two ways one screen apart, and a test naming the lowercase form made the drift
  // look intended. `formatTankMaterial` (format/display.ts) owns the string for both now.
  expect(text).toContain('Steel'); // Material
  expect(text).toContain('12 l'); // Size
  expect(text).toContain('232 bar'); // Working pressure
  expect(text).toContain('0 %'); // O₂ — recorded, not absent, even though unusable for MOD
  expect(text).toContain('21 %'); // He
  // ...and both are named by the shared constants, not by a literal this screen keeps to
  // itself. The form used to label the same two fields `O2 %` and `He %` — one cylinder
  // reading two ways one screen apart, the same shape as the "Steel"/'steel' drift above —
  // and `O2_LABEL`/`HE_LABEL` (format/display.ts) is the single owner that closed it.
  expect(textIn(t)).toContain(O2_LABEL);
  expect(textIn(t)).toContain(HE_LABEL);
  expect(text).toContain('200 bar'); // Start pressure
  expect(text).toContain('50 bar'); // End pressure
  expect(text).toContain('150 bar'); // Used (computed: 200 - 50)
  // ...only MOD is gone.
  expect(textIn(t).filter((s) => s === 'MOD')).toHaveLength(0);
});

// The other half of the same Minor: a multi-tank dive where only SOME cylinders have a
// usable O₂ % — one shows its own MOD, the other omits it, in the same render. The task 4
// tests above ("shows every cylinder its own MOD") always give every tank a valid mix, so a
// version of tankFields that dropped the per-tank guard entirely (always show, or never show)
// would still pass them. Cylinder 2's `o2Pct: null` (never recorded, the ordinary case for a
// stage bottle nobody analysed) still leaves its OTHER fields — proven via `Size` below —
// fully populated, isolating this from the "whole tank is sparse" shape too.
it('shows MOD on the cylinder with a usable O₂ %, and omits it on the other, in the same dive', async () => {
  const d = dive({
    date: '2026-06-04',
    tanks: [tank({ o2Pct: 32 }), tank({ material: 'alu', o2Pct: null })],
  });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const texts = textIn(t);
  expect(texts.filter((s) => s === 'MOD')).toHaveLength(1);

  // Split the flat, tree-ordered text by each cylinder's own heading (`Cylinder 1`/
  // `Cylinder 2`, DiveDetailScreen.tsx — used once `dive.tanks.length > 1`) rather than
  // matching styles by reference, so this needs no assumption about which colour scheme
  // the screen resolved under Jest.
  const cylinder1 = texts.indexOf('Cylinder 1');
  const cylinder2 = texts.indexOf('Cylinder 2');
  expect(cylinder1).toBeGreaterThanOrEqual(0);
  expect(cylinder2).toBeGreaterThan(cylinder1);
  const firstTank = texts.slice(cylinder1, cylinder2);
  const secondTank = texts.slice(cylinder2);
  // mod(32) = (1.4 / 0.32 - 1) * 10 = 33.75 -> "33.8 m".
  expect(firstTank).toContain('MOD');
  expect(firstTank.join(' ')).toContain('33.8 m');
  expect(secondTank).not.toContain('MOD');
  // The second cylinder's own other fields still render — this is a selective MOD
  // omission, not the whole tank silently dropping out.
  expect(secondTank).toContain('Size');
  expect(secondTank.join(' ')).toContain('12 l');
});

// M1c task 5 (DESIGN.md §0.6): every value this screen reads from `src/domain/derived.ts`
// is marked as computed — no exceptions, not even for arithmetic simple enough to do in
// your head — with a muted `=` immediately before the value (task 7 replaced the original
// 6 px outlined label marker with this: the owner read the square as a broken glyph in the
// running app, and "a symbol that needs a legend has already failed" — DESIGN.md §10) and
// muted, shrunk ink on the value itself. Task 4's own report (MOD-per-cylinder) named the
// exact failure mode to avoid: a test that only checks a value is present "somewhere" would
// pass a broken implementation that marks every row, or none of the right ones. Every test
// below instead compares a marked row against an unmarked one IN THE SAME ASSERTION, so a
// mutation that removes the marker from the real row, or adds it to a row that shouldn't
// have one, changes which side of the comparison wins rather than just removing a value
// both sides could live without.
//
// This first one is the brief's own Step 1 example, adapted the same way every other
// `id`-prop test in this file already is (see task 4's report): its own render otherwise
// crashes on `reading 'id'` with no `mockUseLocalSearchParams` return value wired up.
it('marks a computed value so it reads differently from one the diver entered', async () => {
  const d = dive({ date: '2026-08-16', timeIn: '09:15', durationMin: 44, maxDepthM: 32.4 });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  // timeOut('09:15', 44) = '09:59'; formatDuration(44) = '44 min'.
  expect(isMarked(t, '09:59')).toBe(true);
  expect(isMarked(t, '44 min')).toBe(false);
});

// Time in/out are the closest possible neighbours — same cluster, same clock-reading shape,
// one typed by the diver and one worked out from it — so this is the pairing most likely to
// leak the marker onto the wrong side, or leave both bare.
it('marks time out as computed but leaves the entered time in beside it alone', async () => {
  const d = dive({ date: '2026-08-16', timeIn: '09:15', durationMin: 44 });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  expect(isMarked(t, '09:59')).toBe(true);
  expect(isMarked(t, '09:15')).toBe(false);
});

it('marks the surface interval as computed, distinctly from the entered date above it', async () => {
  const earlier = dive({ id: 'earlier', date: '2026-08-16', timeIn: '08:12', durationMin: 44 });
  const target = dive({ id: 'target', date: '2026-08-16', timeIn: '10:38' });
  stubDives({ dives: [target, earlier], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: target.id });
  const t = await render(<DiveDetailScreen id={target.id} />);
  // 08:12 + 44 min surfaces at 08:56; the gap to 10:38 is 102 min -> "1 h 42 min".
  expect(isMarked(t, '1 h 42 min')).toBe(true);
  expect(isMarked(t, '16 Aug 2026')).toBe(false);
});

it('marks Gas used and RMV as computed, distinctly from an entered field like O₂', async () => {
  const d = dive({ date: '2026-06-04', avgDepthM: 20, durationMin: 45, tanks: [tank()] });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  // gasUsedLitres: (200 - 50) bar * 12 l * 1 = 1800 l; rmv: 1800 / (20/10 + 1) / 45 = 13.3 l/min.
  expect(isMarked(t, '1800 l')).toBe(true);
  expect(isMarked(t, '13.3 l/min')).toBe(true);
  expect(isMarked(t, '32 %')).toBe(false);
});

// The one field most likely to be mismarked "by analogy" the wrong way: `usedBar` (the
// "Used" pressure row) looks like arithmetic simple enough to do in your head — start minus
// end — but DESIGN.md §0.6 draws no exception for that: the rule is derived or entered,
// full stop, and anything read from derived.ts is marked, `usedBar` included, for the same
// reason MOD beside it is. An implementation that reasoned "this one's too simple to bother
// marking" would pass every other test in this file and still be wrong; this is the test
// that catches it. (An earlier version of this test asserted the opposite — that Used
// pressure stayed unmarked — matching §0.6 as it read before it was amended to fold Used
// pressure into the marked set; a test whose name asserted the rule its own body no longer
// checks would have been the same defect as a comment that drifted from the code.)
it('marks Used pressure as computed, the same as MOD beside it', async () => {
  const d = dive({ date: '2026-06-04', tanks: [tank()] });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  // mod(32) = (1.4 / 0.32 - 1) * 10 = 33.75 -> "33.8 m"; usedBar = 200 - 50 = 150 -> "150 bar".
  expect(isMarked(t, '33.8 m')).toBe(true);
  expect(isMarked(t, '150 bar')).toBe(true);
  // Keeps this test's own marked-vs-unmarked contrast (see the block comment above) even
  // though Used flipped sides: Start pressure sits in the same per-tank block and stays
  // diver-entered, so it is the unmarked half of the same-assertion comparison now.
  expect(isMarked(t, '200 bar')).toBe(false);
});

// Structural counterpart to every test above: rather than naming which values are
// computed, this counts them. A `Text` node reading exactly `=` (task 7's mark — see
// `isMarked`'s own docblock above for why it replaced the old `paddingLeft`-on-the-label
// proxy) is the only place this screen's component tree ever renders that one-character
// string — confirmed by grep — so counting Text nodes whose own child is exactly `'='`
// counts marked rows with no list of field names to fall out of date. `Object.keys(derived)`
// is the other half: `derived.ts`'s own export list, read at runtime rather than retyped
// here, so a value added to that module is counted automatically too — narrowed to the
// exports that are actually functions (a shared-arithmetic manifest like the one below is
// data, not something a screen could ever render) and then to the ones that module itself
// does not name as shared arithmetic (see `SHARED_ARITHMETIC_EXPORTS`, derived.ts).
//
// The fixture below is built so all seven screen-facing exports return non-null and each
// renders as exactly one row — the default cylinder's blank helium is read as none
// (`nitrogenPct`), so N2 is present without the fixture having to state a fraction no diver
// writes for air: one tank (not two) keeps MOD, N2 and Used from doubling up the way task
// 4's "shows every cylinder its own MOD" test deliberately exercises elsewhere, and the
// earlier/target pair is the same shape "marks the surface interval..." above already
// proves resolves to a non-null interval. Marked-count and export-count coincide at 7 only
// because every screen-facing export is both non-null for this fixture AND wired into this
// screen; a derived value added for some other consumer entirely (not rendered here at all)
// would desync the two sides without this screen having done anything wrong — a limit worth
// naming rather than a defect this test can see around, since nothing short of re-deriving
// each value from its own inputs (i.e. hardcoding the six again, just as function calls
// instead of as strings) could rule it out.
//
// `rmvFrom` (profile work, M3p) was exactly the *other* kind of new export arriving: not
// screen-facing at all, but the shared litres/ata/minutes arithmetic `rmv` below and
// `domain/consumption.ts`'s windowed figure both call — nothing here renders a bare
// "litres ÷ ata ÷ minutes" row, so it can never be the value behind a mark on this screen.
// The fix is not naming `rmvFrom` in this file: that would be this test accommodating a fact
// about the implementation it does not own. Instead `derived.ts` names it —
// `SHARED_ARITHMETIC_EXPORTS`, right beside `rmvFrom` itself — and `screenFacing` below reads
// that list the same way it already reads `Object.keys(derived)`: as the module's own account
// of its exports, not this test's guess at one. A future shared core is excluded from this
// count by someone growing that array in derived.ts, in the same commit that adds it; this
// test file does not change either way.
it('marks every value this screen reads from derived.ts as computed, not just six of seven', async () => {
  const earlier = dive({ id: 'earlier', date: '2026-08-16', timeIn: '08:12', durationMin: 44 });
  const target = dive({
    id: 'target',
    date: '2026-08-16',
    timeIn: '10:38',
    durationMin: 45,
    avgDepthM: 20,
    maxDepthM: 25,
    tanks: [tank()],
  });
  stubDives({ dives: [target, earlier], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: target.id });
  const t = await render(<DiveDetailScreen id={target.id} />);
  const markCount = textNodesOf(t).filter((n) => n.children[0] === '=').length;
  const screenFacing = Object.keys(derived).filter(
    (name) =>
      typeof (derived as Record<string, unknown>)[name] === 'function' &&
      !derived.SHARED_ARITHMETIC_EXPORTS.includes(name),
  );
  expect(markCount).toBe(screenFacing.length);
});

// The `=` mark proves a row is computed; this proves the OTHER half of §0.6's rule ("...and
// sit in muted ink") independently — a fix that renders the mark but forgets
// detailValueComputed would pass every test above and still leave the value looking exactly
// like an entered one. DESIGN.md §0.6's table also sizes a computed value at 13.5, down from
// the entered 15 — checked here too, since nothing above touches font size either.
it("mutes a computed value's own ink and shrinks it, not just its label", async () => {
  const d = dive({ date: '2026-08-16', timeIn: '09:15', durationMin: 44 });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  // timeOut('09:15', 44) = '09:59'; formatDuration(44) = '44 min'.
  const computedValue = textNode(t, '09:59');
  const enteredValue = textNode(t, '44 min');
  // Without this, a computed value that never renders as its own node at all (e.g. still
  // buried inside a combined "09:15 – 09:59" string) would make colorOf(computedValue)
  // read `undefined` — which trivially differs from any real colour and would pass this
  // assertion for the wrong reason.
  expect(computedValue).toBeDefined();
  expect(colorOf(computedValue)).not.toBe(colorOf(enteredValue));
  expect(fontSizeOf(computedValue)).toBe(13.5);
  expect(fontSizeOf(enteredValue)).toBe(15);
});

// M1c task 7 (DESIGN.md §0.6): "give the mark a fixed-width slot rather than letting it
// push digits around" — the `=` must carry its own explicit `width` rather than being sized
// to its glyph. A fixed slot is what keeps a computed row's value flush with an entered
// row's own (`detailValue`'s `textAlign: 'right'`, untouched by this task) regardless of
// whether a `=` precedes it, instead of the value's position depending on however wide "= "
// happens to render in a given font.
it('gives the mark a fixed width, rather than sizing it to the glyph', async () => {
  const d = dive({ date: '2026-08-16', timeIn: '09:15', durationMin: 44 });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const marks = textNodesOf(t).filter((n) => n.children[0] === '=');
  expect(marks.length).toBeGreaterThan(0);
  for (const mark of marks) {
    const width = styleArrayOf(mark).reduce((a: unknown, s: any) => (typeof s?.width === 'number' ? s.width : a), undefined);
    expect(typeof width).toBe('number');
  }
});

// M1c task 5's other half: the detail hero (DESIGN.md §0.6) — site name heading, a
// `#number · date · centre` mono sub-line, and the 34 px depth anchor (DepthValue's
// `variant="hero"`, from task 1). `renderDetail`'s helper `numbers: new Map()` never
// carries a number for its target, so a dedicated `mockUseDives` call is needed here to
// give this dive one, the same way the "shows every cylinder its own MOD" test above does.
it('opens with a hero — number, site name heading, then date · centre in mono', async () => {
  const d = dive({ date: '2026-08-22', siteName: 'Blue Hole', centerName: 'Ponorka', maxDepthM: 18 });
  stubDives({ dives: [d], numbers: new Map([[d.id, 6]]), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const lines = textIn(await render(<DiveDetailScreen id={d.id} />));
  expect(lines).toContain('#6');
  expect(lines).toContain('Blue Hole');
  expect(lines).toContain('22 Aug 2026 · Ponorka');
});

// The hero's depth is specifically the 34 px hero variant, not a second 20 px row-scale
// depth — DepthValue.test.tsx already pins that 'hero' renders at 34 and 'row' at 20 in
// isolation; this is the proof DiveDetailScreen actually passes `variant="hero"` at its one
// call site, rather than defaulting to 'row' like every other DepthValue on this screen
// (the "Depth & duration" cluster's own Max depth row uses the plain 20 px variant, so the
// same '18.0' numeral legitimately renders twice at two different sizes — this checks that
// 34 is one of them, not that 20 is absent).
it('renders the hero depth at the 34 px detail-scale variant', async () => {
  const d = dive({ date: '2026-08-16', maxDepthM: 18 });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const sizesOf18 = textNodesOf(t)
    .filter((n) => String(n.children[0] ?? '').includes('18.0'))
    .map((n) => fontSizeOf(n));
  expect(sizesOf18).toContain(34);
});

// M1c closing fixes, Important #3: this cluster used to gate its "Max depth"/"Avg depth"
// rows on `formatDepth(...) !== null`, while the value beside the label — `DepthValue`,
// which renders from `depthColorOrNull` — refused to draw anything for a negative depth.
// The two disagreed on exactly this input: the row (and its "Max depth" label) rendered,
// DepthValue drew nothing beside it, and a diver saw a dangling label with no value ever
// answering it. `formatDepth` and `depthColorOrNull` now share one owner (format/display.ts's
// formatDepthParts), so a negative reading is refused at the gate too, and the label never
// appears in the first place — the same "omit the element entirely" rule §1 already applies
// to every other unrecorded/unreadable field, extended to cover an unreadable one too. Duration
// stays real and positive here so the cluster itself still renders (showDepthDuration), which
// is what makes "no Max depth label" a meaningful assertion rather than "nothing rendered at
// all".
it('omits the Max depth row entirely for a negative reading, rather than a dangling label', async () => {
  const d = dive({ date: '2026-08-16', maxDepthM: -5, durationMin: 40 });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const text = textIn(await render(<DiveDetailScreen id={d.id} />)).join(' ');
  expect(text).toContain('Depth & duration');
  expect(text).not.toContain('Max depth');
  expect(text).not.toContain('-5');
});

// A dive with only a date (§6's frozen minimum) must still render a clean hero: no number
// (planned/never-numbered), no centre, and critically no stray "· ·" from joining absent
// parts, which a naive template string (rather than filter-then-join) would leave behind.
//
// M1d correction: this used to assert the hero had NO heading at all for such a dive — the
// bug half of item 5. The list row already called it "Unnamed site" while its own detail
// page opened on a sub-line with nothing above it. `diveSiteLabel` is now the one rule for
// both, and it always produces text.
it('renders a clean hero for a dive with only a date, with no stray separators', async () => {
  const d = dive({ date: '2026-08-16' });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const text = textIn(t).join(' ');
  expect(text).toContain('16 Aug 2026');
  expect(text).not.toContain('null');
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('·  ·');
  // The 20 px hero heading (the canvas's compact title, issue #3) names the dive rather than
  // being absent — the same words DiveRow.test.tsx pins for the same dive in the list.
  const headings = textNodesOf(t).filter((n) => fontSizeOf(n) === 20);
  expect(headings.map((n) => String(n.children[0] ?? ''))).toEqual(['Unnamed site']);
});

// The other half of item 5, and the reason `diveSiteLabel` is site-first: when the label
// falls back to the CENTRE, the hero sub-line must not also print it. The sub-line renders
// `#number · date · centre`, so an unsited dive would otherwise show "Aqua" twice, one line
// apart. The screen reads that off the label itself rather than re-deriving "siteName is
// null", so the two can't drift.
it('does not repeat the centre in the sub-line when the heading has already fallen back to it', async () => {
  const d = dive({ date: '2026-08-22', siteName: null, centerName: 'Aqua' });
  stubDives({ dives: [d], numbers: new Map([[d.id, 6]]), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);

  const heading = textNodesOf(t).find((n) => fontSizeOf(n) === 20);
  expect(String(heading?.children[0] ?? '')).toBe('Aqua');
  // The sub-line still carries everything else it had, and nothing after the date.
  const sub = textNodesOf(t).find((n) => String(n.children[0] ?? '').startsWith('22 Aug 2026'));
  expect(String(sub?.children[0] ?? '')).toBe('22 Aug 2026');
});

// The control for the test above: with a real site name, the centre is NOT the label, so
// the sub-line keeps it. Without this, "drop the centre from the sub-line entirely" would
// pass — and that is the more likely wrong fix, since it needs less code.
it('keeps the centre in the sub-line whenever the heading is not already showing it', async () => {
  const d = dive({ date: '2026-08-22', siteName: 'Blue Hole', centerName: 'Aqua' });
  stubDives({ dives: [d], numbers: new Map([[d.id, 6]]), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const sub = textNodesOf(t).find((n) => String(n.children[0] ?? '').startsWith('22 Aug 2026'));
  expect(String(sub?.children[0] ?? '')).toBe('22 Aug 2026 · Aqua');
  // The hero's own heading, which the assertion above never reads: `diveSiteLabel` is
  // site-FIRST, and its precedence was pinned only in display.test.ts. Nothing here set both
  // fields on the heading's own dive, so this call site accepted a centre-first inline copy
  // — a dive titled after the shop rather than the place, on every trip booked through one.
  const heading = textNodesOf(t).find((n) => fontSizeOf(n) === 20);
  expect(String(heading?.children[0] ?? '')).toBe('Blue Hole');
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

// Review task 7, Important #1: seven fields (GPS, waves/current/surge, tank size/count/O2/He,
// weight, rating) used to build their own `${x} unit` strings inline, bypassing
// format/display.ts, and rendered the literal string "NaN" for exactly the input DESIGN.md
// §10's COERCION CONTRACT requires M1d's form to produce — an empty numeric field reaching
// the domain as NaN, never 0. The review verified 8 literal "NaN" strings reaching this
// screen from a dive shaped like this one.
it('never renders the literal string "NaN", for any of the fields that used to leak it', async () => {
  const text = (
    await renderDetail(
      dive({
        date: '2026-08-16',
        latitude: Number.NaN,
        longitude: Number.NaN,
        waves: Number.NaN,
        current: Number.NaN,
        surge: Number.NaN,
        weightsKg: Number.NaN,
        rating: Number.NaN,
        tanks: [
          tank({
            material: null,
            configuration: null,
            sizeL: Number.NaN,
            workingBar: null,
            o2Pct: Number.NaN,
            hePct: Number.NaN,
            startBar: null,
            endBar: null,
          }),
        ],
      }),
    )
  ).join(' ');
  expect(text).not.toContain('NaN');
});

// The mirror of the test above: the same fields with real readings still reach the screen,
// so the fix routing them through format/display.ts didn't just make them disappear.
it('shows GPS, condition scale, weight and rating fields when they are real readings', async () => {
  const text = (
    await renderDetail(
      dive({ date: '2026-08-16', latitude: 50.12345, longitude: 14.56789, waves: 2, weightsKg: 6.5, rating: 4 }),
    )
  ).join(' ');
  expect(text).toContain('50.12345, 14.56789');
  expect(text).toContain('6.5 kg');
  // The rating is the drawn dots since issue #6, so its figure is no longer printed — the row
  // announces it instead (the dots test below reads the dots themselves).
  expect(text).not.toContain('4 / 5');
});

it('announces the rating as its figure, since the dots say nothing to a screen reader', async () => {
  const t = await renderDetailTree(dive({ rating: 4 }));
  const announced = (t.root?.queryAll((n) => n.props?.accessible === true) ?? []).map((n) => String(n.props.accessibilityLabel ?? ''));
  expect(announced).toContain('Rating: 4 / 5');
});

// Important #1 fallout: "Gas & cylinders" used to gate on raw `dive.tanks.length > 0`, the
// one cluster on this screen not gated on computed presence. That was safe only while every
// tank field rendered unconditionally (including as "NaN") — now that non-finite fields
// correctly disappear, a tank whose only recorded fields were non-finite would otherwise
// leave this heading standing over zero rows, same shape the Important #2 test below pins
// for this screen's other clusters.
it('omits the Gas & cylinders heading when every tank field is non-finite, not just when tanks is empty', async () => {
  const text = (
    await renderDetail(
      dive({
        date: '2026-08-16',
        tanks: [
          tank({
            material: null,
            configuration: null,
            sizeL: Number.NaN,
            workingBar: null,
            o2Pct: Number.NaN,
            hePct: Number.NaN,
            startBar: null,
            endBar: null,
          }),
        ],
      }),
    )
  ).join(' ');
  expect(text).not.toContain('Gas & cylinders');
});

// Review task 7, Important #2: surfaceIntervalMin now refuses an interval of a day or more
// (derived.test.ts pins the bound itself); this is the screen-level proof that a refused
// interval renders as an absent row, not as the "525555 min" the review found on screen.
it('omits the surface interval row for two logged dives a year apart, rather than showing an unbounded number', async () => {
  const earlier = dive({ id: 'earlier', date: '2025-08-16', timeIn: '09:00', durationMin: 44 });
  const target = dive({ id: 'target', date: '2026-08-16', timeIn: '09:00' });
  const text = (await renderDetailIn([target, earlier], target)).join(' ');
  expect(text).not.toContain('Surface interval');
  expect(text).not.toContain('525555');
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
  // `.join('')`, not `.join(' ')`: DepthValue (M1c task 1) now splits "25.0 m" across two
  // sibling Text nodes (value, then a quieter nested unit carrying its own leading space),
  // so a join(' ') would insert a second space nothing on screen shows ("25.0  m") and
  // break the 'toContain' below. join('') reconstructs exactly what's rendered, since
  // sibling Text nodes never gain a space RN didn't put there itself.
  const text = (
    await renderDetail(dive({ date: '2026-08-16', maxDepthM: 25, avgDepthM: 20, durationMin: 40 }))
  ).join('');
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

// §0.6's hairline rule, as the canvas draws it (issue #3): every ROW carries the line on its top
// edge, so a cluster's first row draws the rule under its label and its last row has none
// beneath it — the next cluster's 22 of air does the separating. No cluster draws a rule of its
// own any more; the old shape ruled clusters and left the rows between them bare.
it('rules every row on its top edge, and no cluster, so a group ends on its last row', async () => {
  const d = dive({
    date: '2026-08-16',
    siteName: 'Blue Hole',
    maxDepthM: 18,
    durationMin: 45,
    waterTempC: 21,
  });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  if (!t.root) throw new Error('DiveDetailScreen did not render a root element');
  // 'light' for the same reason "draws no profile chart" below gives: that is the scheme
  // useColorScheme() reports under Jest, and the sheet has to match the one that rendered.
  const styles = makeStyles('light');
  const ruled = t.root.queryAll(
    (n) => typeof n.type === 'string' && [n.props?.style].flat(3).filter(Boolean).some((st: any) => (st?.borderTopWidth ?? 0) > 0),
  );
  // Status, Date, Site, Max depth, Duration, Water temp — six rows, six rules, and nothing else
  // on the screen draws one.
  expect(ruled).toHaveLength(6);
  for (const node of ruled) expect([node.props.style].flat(3)).toContain(styles.detailRow);
});

// Whole-branch review, Minor #7: this used to be named "because no dive carries a sample
// series" — a global truth this branch removed, since plenty of dives carry one now. What it
// actually pins is narrower and still true: THIS dive's `useDiveSamples()` answers `null`, so
// the screen draws no graphic of its own. `DiveRow.test.tsx`'s identical defect was caught and
// renamed earlier on this same branch, and the comment below claimed this one kept its name
// deliberately — which was the wrong call twice over, since the two are the same test.
it('draws no profile chart for a dive whose hook answers with no series', async () => {
  const t = await renderDetailTree(diveWithGas);
  // DivesScreen.tsx's own constraint applies here too: this screen resolves its scheme via
  // useColorScheme(), which is 'light' under Jest — the whitelist has to be built from the
  // same scheme the screen actually rendered with, or every real style would misreport as
  // "ad hoc" against the wrong scheme's cached objects.
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
});

// ------------------------------------------------------------------------------------------
// §0.4's depth profile, and §7's `Imported from` row beneath it.
//
// The test above is the other half of this block, renamed for what it pins rather than for what
// was true when it was written: it renders a dive whose `useDiveSamples()` answers `null` —
// which is what most dives in a real logbook answer, and what every assertion in this file
// written before the hook existed answers — and pins that nothing is drawn for one. What
// follows is the case that did not exist when it was written.
// ------------------------------------------------------------------------------------------

/** The committed reference dive's own series (`src/testing/suuntoFixture.ts`), not a hand-rolled
 * one: DESIGN.md's testing facts forbid asserting a number from memory of a fuller dive, and this
 * screen is where the card meets a real `Dive` row. */
const FIXTURE = fixtureSeries();

/** The dive that carries it — the fixture's own header maximum (24.33 m), so the hero above the
 * card and the card's own axis are scaled from the same figure a diver would actually see. */
const diveWithProfile = dive({ id: 'profiled', maxDepthM: 24.33 });

it('asks for THIS dive’s own series, not for whatever the last one held', async () => {
  // `useDiveSamples`' own docblock names the failure this forbids: the hook subscribes inside a
  // `useEffect` keyed on the id, and expo-router keeps a route's component mounted, so a screen
  // that asked for the wrong id would draw a real curve under the wrong dive's name — §0.4 broken
  // in the one way that cannot be seen.
  stubSamples(FIXTURE);
  await renderDetailTree(diveWithProfile);
  expect(mockUseDiveSamples).toHaveBeenCalledWith(diveWithProfile.id);
});

it('puts the profile between the hero and the first cluster, where §0.4 reserved the space', async () => {
  stubSamples(FIXTURE);
  const lines = textIn(await renderDetailTree(diveWithProfile));
  // Review, Finding 4: pinned directly rather than left to the two comparisons below to imply.
  // If the card vanished, `lines.indexOf(t('group.profile'))` is -1, and `-1 < indexOf(dateTime)`
  // alone would still pass — only the first comparison actually caught that, and only because
  // `heroDepth`'s own index happens to be a real, non-negative number. This says "the card is
  // present" once, in a form nothing about the ordering math can make degrade quietly.
  expect(lines).toContain(t('group.profile'));
  // Every string here is read from the thing that owns it — the formatter for the figure, the
  // i18n key for each label. A typed `'24,3'` would assert a decimal comma from a locale this
  // test never sets, and a typed `'Depth profile'` would pin one of the app's two languages.
  const heroDepth = formatDepthParts(diveWithProfile.maxDepthM, 'metric')?.value;
  if (heroDepth === undefined) throw new Error('the fixture dive has no displayable depth');
  // The hero is the FIRST place the depth is said (the Depth & duration cluster says it again,
  // below the card), so `indexOf` is the hero's own line by construction.
  expect(lines.indexOf(t('group.profile'))).toBeGreaterThan(lines.indexOf(heroDepth));
  expect(lines.indexOf(t('group.profile'))).toBeLessThan(lines.indexOf(t('group.dateTime')));
});

it('names the computer a dive was imported from', async () => {
  const device = 'Suunto D5';
  const tree = await renderDetailTree(
    dive({ id: 'd', importSource: suuntoJsonImporter.source, importDevice: device }),
  );
  expect(textIn(tree)).toContain(device);
});

it('falls back to the importer’s own label when the device was never recorded', async () => {
  // The permanent state of every dive imported before the column existed: dedupe means
  // re-running the same files writes nothing, so those rows keep `importDevice = null` for
  // good (spec §7). The label is read off the importer rather than typed, so a rename there
  // cannot leave this test agreeing with a string the app no longer shows.
  const tree = await renderDetailTree(
    dive({ id: 'd', importSource: suuntoJsonImporter.source, importDevice: null }),
  );
  expect(textIn(tree)).toContain(suuntoJsonImporter.label());
});

// Review, Finding 2: today's only importer normalises a blank device name to `null` before it
// ever reaches the database, so `dive.importDevice` cannot actually hold `''` from that writer —
// but the column also arrives by sync, from a future client or a second importer that forgot to
// normalise. A blank must read exactly like the null case above, not like a name, or this would
// render "Imported from" with nothing after it.
it('treats a blank device name as no device, falling back to the importer’s own label', async () => {
  const tree = await renderDetailTree(
    dive({ id: 'd', importSource: suuntoJsonImporter.source, importDevice: '' }),
  );
  // Under the old `??` alone, `''` is not nullish, so this would read the blank string
  // itself rather than ever calling `importerLabelFor` — the label below would not appear.
  expect(textIn(tree)).toContain(suuntoJsonImporter.label());
});

// A name of nothing but spaces is as blank as an empty one, and a comparison against `''`
// alone would let it through to render the label over an invisible value — the same defect
// the case above closes, spelled differently by whichever writer eventually sends it.
it('treats a whitespace-only device name as no device either', async () => {
  const tree = await renderDetailTree(
    dive({ id: 'd', importSource: suuntoJsonImporter.source, importDevice: '   ' }),
  );
  expect(textIn(tree)).toContain(suuntoJsonImporter.label());
});

// The trim is applied to the name itself, not only to the test for one — a padded name is
// shown as the name, never with the export's own whitespace carried into the row.
it('shows a padded device name without the padding', async () => {
  const tree = await renderDetailTree(
    dive({ id: 'd', importSource: suuntoJsonImporter.source, importDevice: '  Suunto D5  ' }),
  );
  expect(textIn(tree)).toContain('Suunto D5');
});

it('says nothing about importing for a dive the diver logged by hand', async () => {
  const tree = await renderDetailTree(dive({ id: 'd', importSource: null }));
  expect(textIn(tree)).not.toContain(t('field.importedFrom'));
});

it('says nothing about importing for a source no importer in the registry claims', async () => {
  // A row read back from a database another version of the app wrote, or a format since
  // removed. `importerLabelFor` answers null, and a row reading "Imported from ·" with nothing
  // after it would be worse than the absence.
  const tree = await renderDetailTree(
    dive({ id: 'd', importSource: 'no-such-importer', importDevice: null }),
  );
  expect(textIn(tree)).not.toContain(t('field.importedFrom'));
});

// **The guard, on the screen that draws the app's first real SVG** (§0.1/§0.4). The sweep above
// runs on a dive with no series, so until this one existed every node the card draws was
// unexamined here — and `unexpectedGraphics`' SVG arm reported any of them on sight, by its own
// deliberate default, until this task taught it what a legitimate one looks like.
//
// 'light' for the reason its neighbour above gives: that is the scheme `useColorScheme()` reports
// under Jest, and the sheet compared against has to be the one that rendered.
it('draws the card without a single colour that is not a depth or a token', async () => {
  stubSamples(FIXTURE);
  const tree = await renderDetailTree(diveWithProfile);
  // Review, Finding 3: the sweep below is worthless if nothing drew — if `DepthProfile` stopped
  // rendering, an empty tree reports nothing wrong for the wrong reason. `DivesScreen`'s own
  // equivalent sweep (`draws none on a list whose rows have a shape to draw`) guards itself the
  // same way. Not a fixed count, unlike that one's single sparkline stroke: how many `Path`s the
  // fixture's series draws depends on how many depth bands it crosses, which is not this test's
  // concern — only that it is more than none.
  expect((tree.root ? tree.root.queryAll((n) => n.type === 'RNSVGPath') : []).length).toBeGreaterThan(0);
  expect(unexpectedGraphics(tree, 'light')).toEqual([]);
});

it('says the dive is gone rather than crashing when the id is unknown', async () => {
  const text = (await renderDetailFor('no-such-id')).join(' ');
  expect(text.toLowerCase()).toContain('not found');
});

// Not in the brief's sample, but surfaceIntervalMin is one of the six computed values the
// brief names, and none of the tests above actually exercise it. useDives() hands back every
// live dive newest-date-first, so the dive that happened BEFORE `target` sits at the NEXT
// array index, not the previous one — this pins that direction with a real, checkable number
// (the same 08:12 + 44 min -> 102 min -> "1 h 42 min" example derived.test.ts's own
// surfaceIntervalMin suite and display.test.ts's formatSurfaceInterval suite use), not just
// presence-of-a-label. Getting the index direction backwards would either omit this row
// entirely or pair `target` with the wrong dive.
//
// Review task 7, cannot-fail #4: the LOGGED in this test's own name used to be untested — both
// fixtures were logged (dive()'s own default), so mutating previousLoggedDive to search the
// WHOLE list instead of splitPlanned's logged half survived every test in the suite. `between`
// is a PLANNED dive sitting between target and earlier in raw list order (09:30, between
// target's 10:38 and earlier's 08:12): if the logged-only filter were ever dropped, `between`
// would be `earlier`'s neighbour instead, pairing target with a 09:30/44 min dive and reading
// "24 min" — a different, wrong, but equally plausible-looking number — rather than 102.
it('computes surface interval from the previous LOGGED dive, in list order newest-first', async () => {
  const earlier = dive({ id: 'earlier', date: '2026-08-16', timeIn: '08:12', durationMin: 44 });
  const between = dive({ id: 'between', date: '2026-08-16', timeIn: '09:30', durationMin: 44, status: 'planned' });
  const target = dive({ id: 'target', date: '2026-08-16', timeIn: '10:38' });
  // newest-first: target (10:38), then the planned dive (09:30), then earlier (08:12).
  const text = (await renderDetailIn([target, between, earlier], target)).join(' ');
  expect(text).toContain('1 h 42 min');
  expect(text).not.toContain('24 min');
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

// This used to pin §1's no-form-shaming stance for BOOLEANS: `hood: false` was a real
// recorded answer ("no hood worn") and had to render as "No" rather than vanish the way a
// null does. M1h's token set cannot express that answer at all (§10, and `Dive.equipment`),
// so what is left to defend is the half that survived — a recorded set reaches the screen as
// the diver's own words, and an empty one is simply an absent row rather than an empty one.
it('reads a recorded equipment set back in the diver\'s own words, and omits the row for an empty one', async () => {
  const worn = (await renderDetail(dive({ date: '2026-08-16', equipment: ['hood', 'torch'] }))).join(' ');
  expect(worn).toContain('Hood · Torch');
  const none = (await renderDetail(dive({ date: '2026-08-16', equipment: [] }))).join(' ');
  expect(none).not.toContain('Equipment');
});

// M1h's other new fields, on the screen the form writes into. Each is a §10 pairing where a
// judgement sits beside a number, so both halves are asserted: a screen that dropped either
// would still look complete.
it('shows the M1h conditions and equipment fields it now records', async () => {
  const text = (
    await renderDetail(
      dive({
        date: '2026-08-16',
        visibility: 'high',
        visibilityM: 25,
        weather: 'cloudy',
        suitThicknessMm: 5,
        weightsKg: 6,
        weightsFeel: 'over',
      }),
    )
  ).join(' ');
  expect(text).toContain('High');
  expect(text).toContain('25.0 m');
  expect(text).toContain('Cloudy');
  expect(text).toContain('5 mm');
  expect(text).toContain('6 kg');
  expect(text).toContain('Over');
  // Two rows about visibility, and they must not both be called the same thing — see
  // `conditionsFields`. Identical labels would be unreadable in a column and identical to a
  // screen reader.
  expect(text).toContain('Visibility distance');
});

/**
 * **Which formatter each 0–3 scale is read back through**, on the screen the form writes
 * into — and the reason this screen was in M1h's scope at all: picking *Small* under Waves
 * on the form and reading *Light* back here is §4.1's opening `Steel`/`steel` drift, one
 * screen apart instead of one word apart.
 *
 * Measured before this test existed, all of it at 1553 green: this screen's `formatWaves`
 * repointed at `formatCurrent`, its `formatSurge` likewise, and — the failure with no
 * visible trace at all — the Waves row deleted outright, which nothing could catch, because
 * a dive that recorded no waves legitimately shows no row.
 *
 * **Level 1 on all three, deliberately.** It is the one level where the three vocabularies
 * disagree word for word (*Small* · *Light* · *Some*); at level 2 they all say *Medium*, so
 * a test written there would pass with the three rows wired to any of the three formatters.
 * Asserted THROUGH the formatters rather than against words typed here: §4.1 gives the words
 * to `format/display.ts` and `display.test.ts` pins what each one says, so a rewording stays
 * one edit while a rewiring stays red.
 */
it('reads each 0–3 scale back through the formatter that scale owns', async () => {
  const rows = [
    ['Waves', formatWaves],
    ['Current', formatCurrent],
    ['Surge', formatSurge],
  ] as [string, (level: number) => string | null][];
  // The level being asked about has to be one the three formatters answer differently, or
  // every assertion below is satisfied by any wiring at all.
  expect(new Set(rows.map(([, format]) => format(1))).size).toBe(rows.length);

  const texts = await renderDetail(dive({ date: '2026-08-16', waves: 1, current: 1, surge: 1 }));
  for (const [label, format] of rows) {
    const row = texts.indexOf(label);
    // The row exists at all — deleting it is otherwise indistinguishable from a dive that
    // simply recorded nothing for it.
    expect(row).toBeGreaterThanOrEqual(0);
    // ...and the value beside that label is its own scale's word. Since issue #6 these are
    // tiles, which put the value ABOVE the field's name as adjacent `Text`s, so the word just
    // before the label is the value rather than a coincidence.
    expect(texts[row - 1]).toBe(format(1));
  }
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

// DESIGN.md §0.6 ("Chrome the type scale does not cover"): the back control used to render
// in sans-medium 16 and read as a heading rather than a way out — "mono, muted and small"
// is the fix. Proven the same RELATIVE way "mutes a computed value's own ink..." above
// proves muting (rather than against a hardcoded theme token): this screen resolves its own
// scheme via useColorScheme(), and this file's own conventions elsewhere already warn
// against assuming which scheme that resolves to under Jest. Comparing the back label
// against the hero site heading's own full-ink, sans, 22 px style sidesteps that entirely.
it('renders the back control mono and muted, distinctly from the hero heading', async () => {
  const d = dive({ date: '2026-08-16', siteName: 'Blue Hole' });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const back = textNode(t, '‹ Back');
  const heading = textNode(t, 'Blue Hole');
  expect(back).toBeDefined();
  expect(heading).toBeDefined();
  const backStyle = styleArrayOf(back);
  expect(backStyle.some((s) => s.fontFamily === fonts.mono)).toBe(true);
  expect(backStyle.some((s) => s.fontFamily === fonts['sans-medium'])).toBe(false);
  expect(fontSizeOf(back)).toBeLessThan(fontSizeOf(heading));
  expect(colorOf(back)).not.toBe(colorOf(heading));
});

// M1b's wide (tablet) layout (DESIGN.md §3): DivesScreen.tsx embeds this exact component
// beside the list, for whichever dive is selected, rather than duplicating its markup. It
// never navigates to /dive/[id] to do that, so there is no route param to read an id from —
// an `id` prop overrides it instead. useLocalSearchParams is stubbed to a DIFFERENT id here
// on purpose, so this proves the prop actually wins rather than merely working when the two
// happen to agree.
it('uses the id prop instead of the route param, for embedded (wide-layout) use', async () => {
  const target = dive({ id: 'target', siteName: 'Shark Reef' });
  const other = dive({ id: 'other', siteName: 'Blue Hole' });
  stubDives({ dives: [other, target], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: 'other' });
  const text = textIn(await render(<DiveDetailScreen id="target" />)).join(' ');
  expect(text).toContain('Shark Reef');
  expect(text).not.toContain('Blue Hole');
});

// DivesScreen.tsx passes showBackButton={false} for that same embedded instance: side by
// side, the list stays on screen the whole time, so there is nothing for BackButton to go
// back TO, and its router.back()/canGoBack() describe the app's real navigation stack,
// which embedding never touched.
it('renders no back control when showBackButton is false', async () => {
  stubDives({ dives: [diveWithGas], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({});
  const t = await render(<DiveDetailScreen id={diveWithGas.id} showBackButton={false} />);
  expect(() => findBackButton(t)).toThrow();
});

// The not-found branch renders BackButton too (the three tests above pin it as a real
// exit, not a dead end) — showBackButton={false} has to suppress it there as well, not
// only in the common, dive-found branch.
it('renders no back control in the not-found branch either, when showBackButton is false', async () => {
  stubDives({ dives: [dive({ id: 'some-other-id' })], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({});
  const t = await render(<DiveDetailScreen id="no-such-id" showBackButton={false} />);
  expect(() => findBackButton(t)).toThrow();
});

// --- M1d task 7: the dive's own two actions — edit (or complete), and delete ---
//
// `softDeleteDive` existed, was tested at the repository level, and wrote the `deleted_at`
// tombstone M2's sync needs — and nothing called it. There was no way to delete a dive in
// the app at all. Deleting belongs here rather than on a list row: it is a deliberate act
// performed on one dive you are looking at.

/** One control by its exact accessibilityLabel — `undefined` when the screen renders none,
 * which several tests below assert directly. */
function findControl(t: RenderResult, label: string) {
  return (t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === label) : [])[0];
}

/** Presses one control, failing at the query rather than at a confusing downstream
 * `fireEvent` error when the screen rendered none — the same contract `findBackButton`
 * above and DivesScreen.test.tsx's own `findSearchInput` already follow. */
async function pressControl(t: RenderResult, label: string) {
  const node = findControl(t, label);
  if (!node) throw new Error(`DiveDetailScreen rendered no control labelled ${label}`);
  await fireEvent.press(node);
}

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
afterEach(() => alertSpy.mockClear());

/** The buttons the platform Alert was actually asked to show — the third argument of the
 * one `Alert.alert` call, exactly as `DiveDetailScreen` passed it. */
function alertButtons(): { text?: string; style?: string; onPress?: () => void }[] {
  return (alertSpy.mock.calls[0]?.[2] ?? []) as { text?: string; style?: string; onPress?: () => void }[];
}

/** Opens the record's actions (⋯, issue #3) and presses Delete in the sheet — the only way to
 * reach it since the canvas moved it off the page. */
async function pressDelete(t: RenderResult) {
  await pressControl(t, 'More actions');
  await pressControl(t, 'Delete dive');
}

/** Presses Delete and then the Alert's own destructive button, which is the only path that
 * actually deletes anything. */
async function confirmDelete(t: RenderResult) {
  await pressDelete(t);
  const destructive = alertButtons().find((b) => b.style === 'destructive');
  if (!destructive) throw new Error('the confirmation offered no destructive button');
  await act(async () => {
    destructive.onPress?.();
  });
}

it('opens the edit form for the dive on screen', async () => {
  const t = await renderDetailTree(dive({ id: 'target', siteName: 'Blue Hole' }));
  const edit = findControl(t, 'Edit');
  expect(edit).toBeDefined();

  await pressControl(t, 'Edit');
  // The dive's OWN id — a control that always opened the first dive in the list, or the
  // route's own param, would be indistinguishable from this one on a one-dive logbook.
  expect(mockPush).toHaveBeenCalledWith(editDiveHref('target'));
  // ...and it opens the form on the dive's own status, which is what "Edit" means. A plain
  // edit that carried `openAs` would flip the form's §2.4 control for a diver who only
  // asked to change a note.
  expect(mockPush.mock.calls[0]?.[0]?.params?.openAs).toBeUndefined();
});

// --- M1d task 8: the top-right action is always *Edit*; *Complete dive* is its own control ---
//
// It used to be one control wearing two labels: *Edit* over `editDiveHref` for a logged dive,
// *Complete dive* over `completeDiveHref` for a planned one. That left a planned dive with no
// plain-edit affordance at all — fixing a typo in a plan meant pressing "Complete dive" and
// then flipping the form's §2.4 control back to Planned. The two acts are now two controls:
// *Edit* at the trailing edge of the top bar for EVERY dive, and, for a planned dive only,
// *Complete dive* at the end of the content, where a deliberate act on the whole dive takes a
// deliberate reach (`detailCompleteRow`, theme/styles.ts).
//
// Every test below asserts WHICH HREF a named control sends, not merely that some link was
// pushed: this pair's whole history is a label and a link disagreeing (§10 — "Complete dive"
// wired to the plain edit link completes nothing while saying it did), and an assertion on
// labels alone, or on `mockPush` having been called, survives the two hrefs being swapped.
it('keeps Edit when the back control is hidden — the tablet pane still edits its dive', async () => {
  // `EditButton` is rendered OUTSIDE the `showBackButton` guard, with a comment saying so,
  // and nothing checked it: pulled inside, a tablet would have no edit control at all, and
  // every other test in this file — all of which leave `showBackButton` at its default —
  // would still pass. DivesScreen.test.tsx pins the same pairing from the other side.
  stubDives({ dives: [dive({ id: 'target', siteName: 'Blue Hole' })], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({});
  const t = await render(<DiveDetailScreen id="target" showBackButton={false} />);

  // The flag really took effect, so the line below is not passing because nothing was hidden.
  expect(t.root?.queryAll((n) => n.props?.accessibilityLabel === 'Go back')).toHaveLength(0);
  expect(findControl(t, 'Edit')).toBeDefined();

  await pressControl(t, 'Edit');
  expect(mockPush).toHaveBeenCalledWith(editDiveHref('target'));
});

it('offers Edit for a planned dive too, not only Complete dive', async () => {
  const t = await renderDetailTree(dive({ id: 'p1', status: 'planned' }));
  expect(findControl(t, 'Edit')).toBeDefined();

  await pressControl(t, 'Edit');
  // The plain edit link, from the plain edit label. A planned dive edited to fix a typo must
  // still be planned when the form opens — `openAs` absent is what leaves the §2.4 control
  // on the dive's own status.
  expect(mockPush).toHaveBeenCalledWith(editDiveHref('p1'));
  expect(mockPush.mock.calls[0]?.[0]?.params?.openAs).toBeUndefined();
});

it('also offers Complete dive for a planned dive, opening the same form on Logged', async () => {
  const t = await renderDetailTree(dive({ id: 'p1', status: 'planned' }));
  expect(findControl(t, 'Complete dive')).toBeDefined();

  await pressControl(t, 'Complete dive');
  expect(mockPush).toHaveBeenCalledWith(completeDiveHref('p1'));
  // `completeDiveHref('p1')` and `editDiveHref('p1')` differ ONLY in this param, so read it
  // as the literal value the route will see rather than trusting the object comparison above
  // to have distinguished them: a control quietly reverted to the plain edit link would still
  // open the right dive's form, and would then leave the §2.4 control on Planned.
  expect(mockPush.mock.calls[0]?.[0]?.params?.openAs).toBe('logged');
});

// The discriminating test, and the one the brief names: BOTH controls pressed in ONE render,
// each asserted against its OWN href. Swapping the two hrefs in DiveDetailScreen.tsx leaves
// every label, every control's presence, and `mockPush.toHaveBeenCalled()` untouched — this
// is what reddens.
it('sends each control its own link, never the other’s', async () => {
  const t = await renderDetailTree(dive({ id: 'p1', status: 'planned' }));

  await pressControl(t, 'Edit');
  await pressControl(t, 'Complete dive');

  expect(mockPush).toHaveBeenCalledTimes(2);
  expect(mockPush.mock.calls[0]?.[0]).toEqual(editDiveHref('p1'));
  expect(mockPush.mock.calls[1]?.[0]).toEqual(completeDiveHref('p1'));
  // Spelled out param by param as well, because the two hrefs share a pathname and an id: an
  // `toEqual` pair that had both sides wrong in the same way would still be two distinct
  // objects, and this says which is which in the terms the route reads.
  expect(mockPush.mock.calls[0]?.[0]?.params?.openAs).toBeUndefined();
  expect(mockPush.mock.calls[1]?.[0]?.params?.openAs).toBe('logged');
});

it('offers no Complete dive anywhere for a logged dive, only Edit', async () => {
  const t = await renderDetailTree(dive({ id: 'target', status: 'logged', siteName: 'Blue Hole' }));
  expect(findControl(t, 'Edit')).toBeDefined();
  expect(findControl(t, 'Complete dive')).toBeUndefined();
  // Not just "no control with that accessibility label" — the words themselves are absent, so
  // a Complete control rendered without a label (or as a plain, unpressable line of text)
  // can't slip past. §2.4 gives this action to a planned dive and to nothing else.
  expect(textIn(t)).not.toContain('Complete dive');
});

// Where each control sits is half of the decision, and neither label nor href can see it.
// `textIn` walks the tree in render order, so "before the first cluster" and "between the last
// cluster and Delete" are readable directly from that order: *Edit* is top-bar chrome above
// the hero, *Complete dive* is the end of the scrolled content, immediately above *Delete
// dive* — the two whole-dive acts grouped where a deliberate act takes a deliberate reach.
it('puts Edit and ⋯ above the hero and Complete dive at the end of the content', async () => {
  const d = dive({ id: 'p1', status: 'planned', siteName: 'Blue Hole', date: '2026-09-01', durationMin: 40 });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const texts = textIn(t);

  const edit = texts.indexOf('Edit');
  const site = texts.indexOf('Blue Hole'); // the hero heading
  const last = texts.indexOf('Duration'); // the last cluster's last label
  const complete = texts.indexOf('Complete dive');

  expect(edit).toBeGreaterThanOrEqual(0);
  expect(complete).toBeGreaterThanOrEqual(0);
  // Edit is chrome above the hero, and ⋯ is beside it...
  expect(edit).toBeLessThan(site);
  expect(findControl(t, 'More actions')).toBeDefined();
  // ...and Complete dive is past every cluster, the last thing on the page.
  expect(complete).toBeGreaterThan(last);
  expect(complete).toBe(texts.length - 1);
});

// §0.1: colour encodes depth and nothing else, so this control gets no hue — and it is not
// destructive, so it must not read as *Delete dive* either. §0.6's existing quiet-control
// vocabulary is what separates them: "a bordered pill in tracked uppercase, not plain text,
// so it reads as a control rather than a label" — the same `actionPill` this exact action
// already wears on an "Up next" row, versus Delete's deliberately plain muted label.
it('gives Complete dive the bordered-pill control treatment, in no hue', async () => {
  const t = await renderDetailTree(dive({ id: 'p1', status: 'planned' }));
  if (!t.root) throw new Error('DiveDetailScreen did not render a root element');
  // 'light' is the scheme useColorScheme() reports under Jest — the same note every other
  // style assertion in this file carries.
  const styles = makeStyles('light');
  const theme = themeFor('light');

  const complete = textNode(t, 'Complete dive');
  expect(complete).toBeDefined();

  // A bordered pill wraps the label — a shape the app already owns rather than new vocabulary,
  // and the one this action wears on an "Up next" row.
  const pills = t.root.queryAll((n) => [n.props?.style].flat(3).filter(Boolean).includes(styles.detailCompletePill));
  expect(pills).toHaveLength(1);
  expect(pills[0]!.props.style.borderWidth).toBeGreaterThan(0);
  expect(pills[0]!.props.style.borderColor).toBe(theme.border);

  // Monochrome: whatever ink it carries, it may not be a hue.
  expect([theme.fg, theme.fgMuted]).toContain(colorOf(complete));
});

// §0.5's floor, on the Pressable rather than on the visually smaller pill inside it — the
// same "small visible control, generous hidden target" split `plannedAction`/`dayStripAction`
// already use, and the reason the pill is nested rather than being the Pressable itself.
it('gives Complete dive a 48 dp tap target, not just a pill-sized one', async () => {
  const t = await renderDetailTree(dive({ id: 'p1', status: 'planned' }));
  const control = findControl(t, 'Complete dive');
  expect(control).toBeDefined();
  const minHeight = [control!.props.style].flat(3).filter(Boolean)
    .reduce((a: unknown, s: any) => (typeof s?.minHeight === 'number' ? s.minHeight : a), undefined);
  expect(minHeight).toBeGreaterThanOrEqual(48);
});

it('asks before deleting, and deletes nothing until the diver confirms', async () => {
  const t = await renderDetailTree(dive({ id: 'target', siteName: 'Blue Hole' }));
  await pressDelete(t);

  expect(alertSpy).toHaveBeenCalled();
  // Pressing the control is a request to be asked, not a deletion. Without this, a
  // mis-wired confirmation that deleted first and asked afterwards would pass every other
  // test in this section.
  expect(mockSoftDelete).not.toHaveBeenCalled();
  const buttons = alertButtons();
  // The red lives in OS chrome (amendment C, §0.1): `style: 'destructive'` is the platform's
  // own, the same way the keyboard's colours are.
  expect(buttons.find((b) => b.style === 'destructive')?.text).toBe('Delete');
  expect(buttons.find((b) => b.style === 'cancel')).toBeDefined();
});

// The sheet closes on a yes and only then (issue #3): a no leaves the diver where they were,
// one Cancel from the dive, rather than dropping them back onto the page as though nothing had
// been asked.
it('closes the sheet once the diver says yes, and leaves it open on a no', async () => {
  mockSoftDelete.mockResolvedValue(undefined);
  const t = await renderDetailTree(dive({ id: 'target' }));
  await pressDelete(t);
  await act(async () => {
    alertButtons().find((b) => b.style === 'cancel')?.onPress?.();
  });
  expect(textIn(t)).toContain('Delete dive');

  await act(async () => {
    alertButtons().find((b) => b.style === 'destructive')?.onPress?.();
  });
  expect(textIn(t)).not.toContain('Delete dive');
});

it('deletes the dive and leaves the detail screen once the diver confirms', async () => {
  mockCanGoBack.mockReturnValue(true);
  mockSoftDelete.mockResolvedValue(undefined);
  const t = await renderDetailTree(dive({ id: 'target' }));

  await confirmDelete(t);

  // `softDeleteDive`, never a hard delete: it writes the `deleted_at` tombstone (§6) that
  // M2's sync needs to propagate the deletion, and `db/dives.test.ts` pins that the row
  // survives with the tombstone and that the numbering above it closes up.
  await waitFor(() => expect(mockSoftDelete).toHaveBeenCalled());
  expect(mockSoftDelete.mock.calls[0]?.[1]).toBe('target');
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
});

// --- DESIGN.md §10's in-flight guard, on the delete side ---
//
// `runDelete` carries both halves the save control carries — a `deletingRef` latch and a
// `disabled` prop — under a docblock claiming the same reasoning, and had none of the three
// tests the save guard has. Deleting is the one action in the app that removes something, so
// a second write landing on an already-tombstoned row is the failure worth pinning: it
// resolves, it advances `updated_at` a second time, and under §7's whole-row last-write-wins
// that second stamp is what another device compares against.
//
// The two halves are pinned separately, because a test exercising only one goes green with
// the other deleted — and here they guard genuinely different doors. The Alert's own button
// is a plain callback, so a double-tap on it never consults `disabled` at all; only the ref
// turns the second one away. `disabled` is what stops the CONTROL reopening the alert while
// a write is still running.

/** A `softDeleteDive` that hangs until the test lets it finish. `release` is assigned
 * synchronously by the Promise constructor, so it is callable before the write has been
 * started even once. */
function hangingDelete(): () => void {
  let release!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockSoftDelete.mockImplementation(async () => {
    await inFlight;
  });
  return release;
}

it('tombstones the dive once when the confirmation is double-tapped', async () => {
  mockCanGoBack.mockReturnValue(true);
  const release = hangingDelete();
  const t = await renderDetailTree(dive({ id: 'target' }));
  await pressDelete(t);
  const destructive = alertButtons().find((b) => b.style === 'destructive');
  if (!destructive) throw new Error('the confirmation offered no destructive button');

  // Both taps in the SAME frame, which is what a double-tap is: React has not re-rendered
  // anything between them, so a state flag read at render time is still `false` for the
  // second one and the ref is the only thing fast enough to turn it away. Dispatched
  // straight at the Alert's own callback rather than through `fireEvent.press` — that opens
  // an `act` scope of its own, and the first press's is still open here because the write is
  // deliberately held, which React rejects outright and which corrupts the next test's tree.
  await act(async () => {
    destructive.onPress?.();
    destructive.onPress?.();
  });

  // Recorded before the write is released, so this is genuinely "while in flight" rather
  // than "after the latch had already let go".
  const writesInFlight = mockSoftDelete.mock.calls.length;
  release();
  await waitFor(() => expect(mockBack).toHaveBeenCalled());

  expect(writesInFlight).toBe(1);
  expect(mockSoftDelete).toHaveBeenCalledTimes(1);
  // One deletion, one exit — not two of either.
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('lets the diver try again after a failed delete, rather than latching the control shut', async () => {
  mockCanGoBack.mockReturnValue(true);
  mockSoftDelete.mockRejectedValue(new Error('disk full'));
  const t = await renderDetailTree(dive({ id: 'target' }));

  await confirmDelete(t);
  await waitFor(() => expect(mockSoftDelete).toHaveBeenCalledTimes(1));

  // A guard that never released would leave the diver looking at a dive they cannot delete
  // and a control that silently stopped working — the same dead end §1 exists to prevent,
  // reached from the opposite direction.
  await confirmDelete(t);
  await waitFor(() => expect(mockSoftDelete).toHaveBeenCalledTimes(2));
});

// Since issue #3 the sheet that asked has closed by the time the write is in flight, so what
// is disabled is the way back into it: ⋯ is the one control that could start a second delete.
it('marks ⋯ disabled while the write is in flight, and only then', async () => {
  mockCanGoBack.mockReturnValue(true);
  const release = hangingDelete();
  const t = await renderDetailTree(dive({ id: 'target' }));
  expect(findControl(t, 'More actions')?.props?.accessibilityState?.disabled).not.toBe(true);

  await pressDelete(t);
  const destructive = alertButtons().find((b) => b.style === 'destructive');
  if (!destructive) throw new Error('the confirmation offered no destructive button');
  await act(async () => {
    destructive.onPress?.();
  });

  // `accessibilityState.disabled` is the half a screen reader announces, and the only half
  // observable from here: `Pressable` consumes the `disabled` prop itself rather than
  // forwarding it to the host `View` these queries reach. A control that ignores a tap it
  // still announces as available is its own kind of dead button.
  await waitFor(() => expect(findControl(t, 'More actions')?.props?.accessibilityState?.disabled).toBe(true));

  release();
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
});

it('says so when a delete fails, and leaves the dive where it is', async () => {
  mockCanGoBack.mockReturnValue(true);
  mockSoftDelete.mockRejectedValue(new Error('disk full'));
  const t = await renderDetailTree(dive({ id: 'target', siteName: 'Blue Hole' }));

  await confirmDelete(t);

  // §10: a local write failure is shown to the diver. Silently leaving the dive on screen
  // would be indistinguishable from a control that does nothing at all.
  await waitFor(() => expect(textIn(t).join(' ').toLowerCase()).toContain("couldn't delete"));
  expect(mockBack).not.toHaveBeenCalled();
  expect(textIn(t).join(' ')).toContain('Blue Hole');
});

it('clears the pane instead of navigating, when the wide layout supplies onDeleted', async () => {
  mockCanGoBack.mockReturnValue(true);
  mockSoftDelete.mockResolvedValue(undefined);
  const onDeleted = jest.fn();
  stubDives({ dives: [dive({ id: 'target' })], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({});
  const t = await render(<DiveDetailScreen id="target" showBackButton={false} onDeleted={onDeleted} />);

  await confirmDelete(t);

  // Side by side with the list there is nothing to navigate away from — `router.back()`
  // would leave the Dives screen entirely, and doing nothing would leave this pane showing
  // "Dive not found." for a dive that was just correctly deleted.
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('offers neither action for a dive it could not find', async () => {
  stubDives({ dives: [dive({ id: 'some-other-id' })], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: 'no-such-id' });
  const t = await render(<DiveDetailScreen />);

  // The not-found branch has no dive to edit, complete or delete, and a control there would
  // either do nothing or act on the wrong id.
  expect(findControl(t, 'Edit')).toBeUndefined();
  expect(findControl(t, 'Complete dive')).toBeUndefined();
  expect(findControl(t, 'More actions')).toBeUndefined();
  expect(textIn(t).join(' ')).toContain('Dive not found');
});

/**
 * M1f. `useDives()` answers asynchronously, and on the renders before it does this screen is
 * handed an empty list — which, until `resolved` existed, was indistinguishable from a
 * logbook that genuinely does not hold this dive. So the screen said "Dive not found." about
 * a dive that was there, every time, and then corrected itself a render later.
 *
 * The three cases below are one guard, and it needs all three: the sentence must be absent
 * while there is no answer, PRESENT once there is one (or a gate with the polarity reversed
 * passes the first test alone), and the way out must survive both — §0.6's "a form with no
 * visible way out was shipped once and only found by using the app", which applies with more
 * force to a screen showing nothing else at all.
 */
describe('before the dives read has answered', () => {
  it('does not claim the dive is missing', async () => {
    stubDives({ dives: [], numbers: new Map(), error: undefined, resolved: false });
    mockUseLocalSearchParams.mockReturnValue({ id: 'target' });
    const t = await render(<DiveDetailScreen />);
    expect(textIn(t).join(' ')).not.toContain('Dive not found');
  });

  it('still offers the way out while it waits', async () => {
    stubDives({ dives: [], numbers: new Map(), error: undefined, resolved: false });
    mockUseLocalSearchParams.mockReturnValue({ id: 'target' });
    const t = await render(<DiveDetailScreen />);
    // Throws if there is none, so this asserts on the query rather than on `undefined`.
    expect(findBackButton(t)).toBeDefined();
  });

  it('says it the moment the read answers and the dive really is not there', async () => {
    stubDives({ dives: [dive({ id: 'some-other-id' })], numbers: new Map(), error: undefined, resolved: true });
    mockUseLocalSearchParams.mockReturnValue({ id: 'target' });
    const t = await render(<DiveDetailScreen />);
    expect(textIn(t).join(' ')).toContain('Dive not found');
  });
});

// DESIGN.md §3's unit setting, on the screen that shows the most figures at once. The
// property that matters here is not "feet appear" but that **no figure is left behind**:
// a diver reading depths in feet beside a pressure in bar has no way to know which of the
// two the app forgot.
describe('the unit setting', () => {
  const fullDive = dive({
    maxDepthM: 24.6,
    avgDepthM: 18,
    visibilityM: 20,
    waterTempC: 25,
    airTempC: 30,
    weightsKg: 6.5,
    durationMin: 47,
    tanks: [tank({ workingBar: 232, startBar: 200, endBar: 50 })],
  });

  // `DepthValue` renders its numeral and its unit as two sibling Text nodes (§0.6 sets the
  // unit quieter), so `textIn`'s flat list yields "81" and " ft" separately and joining on
  // a space gives "81  ft". Collapsed here so an assertion can name the string the diver
  // actually sees, in one form for both the split and the joined renderings.
  const readAs = (parts: string[]) => parts.join(' ').replace(/\s+/g, ' ');

  it('reads every figure on the screen in the chosen system, leaving none in the other', async () => {
    mockUseUnitSystem.mockReturnValue('imperial');
    const text = readAs(await renderDetail(fullDive));

    // Depth (hero, max, avg), visibility, both temperatures, weights, all three pressures,
    // and the two derived figures that are themselves a depth and a pressure.
    expect(text).toContain('81 ft'); // max depth, 24.6 m
    expect(text).toContain('59 ft'); // avg depth, 18 m
    expect(text).toContain('66 ft'); // visibility, 20 m
    expect(text).toContain('77 °F'); // water temp, 25 °C
    expect(text).toContain('86 °F'); // air temp, 30 °C
    expect(text).toContain('14 lb'); // weights, 6.5 kg
    expect(text).toContain('3365 psi'); // working pressure, 232 bar
    expect(text).toContain('2901 psi'); // start, 200 bar
    expect(text).toContain('725 psi'); // end, 50 bar
    expect(text).toContain('2176 psi'); // used = 150 bar, from derived.ts
    expect(text).toContain('111 ft'); // MOD for 32 % at 1.4 ata, 33.75 m

    // The two gas figures (M3). 150 bar x 12 l = 1800 l of free gas = 63.6 cu ft; over
    // 18 m avg (2.8 ata) and 47 min that is 13.68 l/min = 0.48 cu ft/min. These are the two
    // this sweep used to miss — it banned `m`, `bar` and `kg` and never named litres, so an
    // imperial diver read `1800 l` and `13.7 l/min` under a screen of feet and psi.
    expect(text).toContain('64 cu ft');
    expect(text).toContain('0.48 cu ft/min');

    // And nothing at all left in the other system. The metric unit words must not appear
    // anywhere on the screen — this is what a half-converted screen fails on.
    expect(text).not.toMatch(/\d\s(m|bar|kg)\b/);
    expect(text).not.toContain('°C');
    // `l/min` is unambiguous — nothing else on this screen is a rate — so it can be swept for
    // directly. A bare `\d l` cannot be: a cylinder's SIZE is litres in both systems on
    // purpose (its imperial counterpart is free gas at working pressure, a different
    // quantity), so `12 l` below is correct here and the metric gas total is named instead.
    expect(text).not.toMatch(/l\/min/);
    expect(text).not.toContain('1800 l');
    expect(text).toContain('12 l'); // the cylinder itself, deliberately unconverted

    // Duration stays minutes in both systems, so it must still be here.
    expect(text).toContain('47 min');
  });

  it('reads the same dive in metres and bar when the diver is metric', async () => {
    const text = readAs(await renderDetail(fullDive));
    expect(text).toContain('24.6 m');
    expect(text).toContain('25 °C');
    expect(text).toContain('232 bar');
    expect(text).toContain('6.5 kg');
    // The same two gas figures, in the units they are stored in — the metric half of the pair
    // is the identity, so a metric diver reads exactly what `derived.ts` returned.
    expect(text).toContain('1800 l');
    expect(text).toContain('13.7 l/min');
    expect(text).not.toContain('ft');
    expect(text).not.toContain('psi');
  });

  // §0.1 on the screen that draws depth largest. The hero's colour is the dive's band, and
  // a band is a fact about metres — switching systems changes the numeral and nothing else.
  it('keeps a depth in its own band colour when the system changes', async () => {
    const metric = await renderDetailTree(fullDive);
    mockUseUnitSystem.mockReturnValue('imperial');
    const imperial = await renderDetailTree(fullDive);
    // 'light' is the scheme useColorScheme() reports under Jest — the same note every other
    // style assertion in this file carries.
    const band = depthColor(24.6, 'light');
    const heroColour = (t: RenderResult) =>
      textNodesOf(t)
        .flatMap((n) => [n.props.style].flat(3))
        .map((st) => (st as { color?: string } | undefined)?.color)
        .find((c) => c === band);
    expect(heroColour(metric)).toBe(band);
    expect(heroColour(imperial)).toBe(band);
  });
});

// --- The centre row goes somewhere, when there is somewhere to go (M3c) ---------------------

/**
 * `dive_centers` had no reader on any screen until M3c: a diver could add a centre, watch it
 * sync, and never see it again. §6 pairs a dive to `center_id` and snapshots `center_name`, so
 * the id is what decides whether this row has a page behind it.
 */
it('opens the centre’s page from the Centre row when the dive is paired to one', async () => {
  const d = dive({ centerId: 'c-p', centerName: 'Ponorka' });
  const t = await renderDetailTree(d);
  const row = t.root?.queryAll((n) => n.props?.accessibilityLabel === 'Open Ponorka') ?? [];
  expect(row).toHaveLength(1);
  await fireEvent.press(row[0]!);
  expect(String((router.push as jest.Mock).mock.calls.at(-1)?.[0])).toBe('/center/c-p');
});

/**
 * **A dive with a snapshot and no id has nowhere to go, and the row is text.** That is the
 * ordinary case rather than a fault: §2.3 only started publishing centres in M2o, so a centre
 * typed by hand has never named a catalogue row — and a row that looked pressable and did nothing
 * is the dead control §0.6 objects to four separate times.
 */
it('leaves the Centre row as plain text when the dive names a centre it never published', async () => {
  const d = dive({ centerId: null, centerName: 'Ponorka' });
  const t = await renderDetailTree(d);
  expect(textIn(t)).toContain('Ponorka');
  expect(t.root?.queryAll((n) => n.props?.accessibilityLabel === 'Open Ponorka')).toHaveLength(0);
});

// --- ...and so does the site row, on the same rule (M3f) -------------------------------------

/**
 * `/site/[id]` exists as of M3f, so the *Site* row is a destination on exactly the terms the
 * *Centre* row already was: §6 pairs a dive to `site_id` and snapshots `site_name`, and the id is
 * what decides whether there is a page behind the row.
 */
it('opens the site’s page from the Site row when the dive is paired to one', async () => {
  const d = dive({ siteId: 's-kot', siteName: 'Kotelna' });
  const t = await renderDetailTree(d);
  const row = t.root?.queryAll((n) => n.props?.accessibilityLabel === 'Open Kotelna') ?? [];
  expect(row).toHaveLength(1);
  await fireEvent.press(row[0]!);
  expect(String((router.push as jest.Mock).mock.calls.at(-1)?.[0])).toBe('/site/s-kot');
});

/** The same ordinary case one column over: §2.3 only started publishing sites in M2o, so a site
 * typed by hand has never named a catalogue row and the row stays text. */
it('leaves the Site row as plain text when the dive names a site it never published', async () => {
  const d = dive({ siteId: null, siteName: 'Kotelna' });
  const t = await renderDetailTree(d);
  expect(textIn(t)).toContain('Kotelna');
  expect(t.root?.queryAll((n) => n.props?.accessibilityLabel === 'Open Kotelna')).toHaveLength(0);
});

/**
 * **The two rows go to two different pages, and nothing else on the screen goes anywhere.**
 *
 * Both halves matter and they fail differently. A dive paired to both must not send the *Site*
 * row to `/center/…` — the two ids sit one line apart in `whereFields` and the columns are one
 * word different — so the destinations are asserted per row rather than counted. And every other
 * row here is a value: a buddy, a depth, a suit.
 */
it('makes the two paired rows destinations and no others', async () => {
  const d = dive({ siteId: 's1', siteName: 'Blue Hole', centerId: 'c-p', centerName: 'Ponorka', buddy: 'Jana' });
  const t = await renderDetailTree(d);
  const opens = (t.root?.queryAll((n) => typeof n.props?.accessibilityLabel === 'string' && String(n.props.accessibilityLabel).startsWith('Open ')) ?? []);
  expect(opens.map((n) => String(n.props.accessibilityLabel))).toEqual(['Open Blue Hole', 'Open Ponorka']);

  await fireEvent.press(opens[0]!);
  expect(String((router.push as jest.Mock).mock.calls.at(-1)?.[0])).toBe('/site/s1');
  await fireEvent.press(opens[1]!);
  expect(String((router.push as jest.Mock).mock.calls.at(-1)?.[0])).toBe('/center/c-p');
});

/**
 * **Every row on the dive detail is one height, the ones you can press and the ones you read**
 * (issue #3, the owner's call on PR #20: the canvas's uniform 48).
 *
 * M3k gave the *Site* and *Centre* rows §0.5's floor and left the facts dense, and #3 first kept
 * a difference at 64 against 48. On the simulator the taller rows read as uneven spacing rather
 * than as a cue, so the owner took the canvas's one height; what says a row opens a page is
 * issue #5's to settle, not a height. The rows that navigate still clear the floor — at 48 the
 * floor IS the row — and `styles.test.ts`'s sweep over every `Pressable` is what keeps them there.
 *
 * Asked of what each row RESOLVES to (`StyleSheet.flatten`, the merge React Native itself makes
 * on the way to the view) over one render holding both populations, so a style composed onto the
 * pressable row alone — a height, a different alignment — is red here however it is spelled.
 */
it('gives a row that navigates the same 48, centred, as a row a diver only reads', async () => {
  const styles = makeStyles('light');
  const d = dive({ siteId: 's1', siteName: 'Blue Hole', centerId: 'c-p', centerName: 'Ponorka', buddy: 'Jana' });
  const t = await renderDetailTree(d);
  const entries = (n: { props?: { style?: unknown } }) => [n.props?.style].flat(3).filter(Boolean);
  const rows = t.root?.queryAll((n) => entries(n).includes(styles.detailRow)) ?? [];
  const opens = (n: { props?: { accessibilityLabel?: unknown } }) =>
    typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Open ');
  const resolved = (n: { props: { style?: unknown } }) => {
    const { minHeight, alignItems } = StyleSheet.flatten(n.props.style as never) as Record<string, unknown>;
    return { minHeight, alignItems };
  };

  const navigating = rows.filter(opens);
  const reading = rows.filter((n) => !opens(n));
  // Both populations are on this tree, or the comparison below is about an empty set.
  expect(navigating).toHaveLength(2);
  expect(reading.length).toBeGreaterThan(0);

  for (const row of [...navigating, ...reading]) {
    expect(resolved(row)).toEqual({ minHeight: 48, alignItems: 'center' });
  }
});


// ---------------------------------------------------------------------------------------
// Czech (M3h) — §4.1's "one deliberate exception, until i18next", discharged
// ---------------------------------------------------------------------------------------
//
// Until this milestone `format/display.ts` spoke Czech and this screen did not, so a Czech
// diver read *Vstup: Břeh* — a Czech value under an English label. What closes it is that the
// labels are keys (`field.*`, src/i18n) shared with the dive form, so the word a diver types
// into and the word they read back cannot be two words.

describe('in Czech', () => {
  beforeEach(() => {
    setActiveLanguage('cs');
  });
  afterEach(async () => {
    // Unmounted before the language goes back: `useT` subscribes this screen to i18next's
    // `languageChanged`, so switching while it is mounted is a state update outside `act`.
    await cleanup();
    setActiveLanguage('en');
  });

  /**
   * **Every cluster heading and every row label a full dive draws**, asserted as words rather
   * than as "the key resolved": a label left as a literal on this screen would still render,
   * would still be a perfectly good English word, and would fail nothing at all in English.
   */
  it('labels its rows and clusters in Czech, values and all', async () => {
    const said = await renderDetail(
      dive({
        date: '2026-08-16',
        timeIn: '09:30',
        durationMin: 47,
        maxDepthM: 41.2,
        avgDepthM: 18,
        siteName: 'Vis',
        centerName: 'Ponorka',
        entry: 'shore',
        salinity: 'salt',
        waterBody: 'ocean',
        waterTempC: 21,
        visibility: 'high',
        waves: 1,
        current: 2,
        surge: 0,
        weather: 'sunny',
        suit: 'wet',
        suitThicknessMm: 5,
        equipment: ['hood', 'torch'],
        weightsKg: 6,
        weightsFeel: 'good',
        buddy: 'Jana',
        rating: 4,
        tanks: [tank()],
      }),
    );

    // The clusters (§0.6), in the order the screen draws them.
    expect(said).toContain('Datum a čas');
    expect(said).toContain('Lokalita a centrum');
    expect(said).toContain('Hloubka a doba');
    expect(said).toContain('Podmínky');
    expect(said).toContain('Plyn a láhve');
    expect(said).toContain('Vybavení a lidé');
    expect(said).toContain('Poznámky');

    // The rows — the set §4.1 named as duplicated across this screen and the form.
    expect(said).toContain('Stav');
    expect(said).toContain('Datum');
    expect(said).toContain('Čas vstupu');
    expect(said).toContain('Čas výstupu');
    expect(said).toContain('Lokalita');
    expect(said).toContain('Centrum');
    expect(said).toContain('Vstup');
    expect(said).toContain('Slanost');
    expect(said).toContain('Vodní plocha');
    expect(said).toContain('Max. hloubka');
    expect(said).toContain('Prům. hloubka');
    expect(said).toContain('Doba ponoru');
    expect(said).toContain('Teplota vody');
    expect(said).toContain('Viditelnost');
    expect(said).toContain('Vlny');
    expect(said).toContain('Proud');
    expect(said).toContain('Vlnobití');
    expect(said).toContain('Počasí');
    expect(said).toContain('Oblek');
    // The thickness rides on the suit's tile since issue #6 (*Mokrý · 5 mm*), not on a row of its own.
    expect(said).toContain(' · 5 mm');
    expect(said).toContain('Vybavení');
    expect(said).toContain('Zátěž');
    expect(said).toContain('Vyvážení');
    expect(said).toContain('Buddy');
    expect(said).toContain('Hodnocení');
    expect(said).toContain('Láhev');
    expect(said).toContain('Materiál');
    expect(said).toContain('Objem');
    expect(said).toContain('Konfigurace');
    expect(said).toContain('Provozní tlak');
    expect(said).toContain('Počáteční tlak');
    expect(said).toContain('Konečný tlak');
    expect(said).toContain('Spotřeba');

    // And no English label survived beside them. Named individually rather than swept, because
    // a sweep for "any ASCII word" would trip over MOD, RMV, O₂ and a buddy called Jana.
    expect(said).not.toContain('Max depth');
    expect(said).not.toContain('Water temp');
    expect(said).not.toContain('Conditions');
    expect(said).not.toContain('Gas & cylinders');
  });

  /** The values were already Czech before this milestone (M3g moved `format/display.ts`); what
   * this pins is that the labels caught up, so no row reads a Czech word under an English one. */
  it('reads a value and its label in one language', async () => {
    const said = await renderDetail(dive({ entry: 'shore', salinity: 'fresh', suit: 'semidry' }));
    expect(said).toContain('Vstup');
    expect(said).toContain('Břeh');
    expect(said).toContain('Slanost');
    expect(said).toContain('Sladká');
    expect(said).toContain('Oblek');
    expect(said).toContain('Polosuchý');
  });

  /** The screen's own chrome: the way out, the actions, and the record's sheet behind ⋯. */
  it('names its way out and its actions in Czech, the sheet behind ⋯ included', async () => {
    const t = await renderDetailTree(dive({ status: 'planned', latitude: 43.0378, longitude: 16.1489 }));
    expect(textIn(t)).toContain('‹ Zpět');
    expect(textIn(t)).toContain('Upravit');
    expect(textIn(t)).toContain('Dokončit ponor');
    expect(textIn(t)).toContain('Zobrazit na mapě');
    await pressControl(t, 'Další akce');
    expect(textIn(t)).toContain('Plánovaný ponor');
    expect(textIn(t)).toContain('Smazat ponor');
    expect(textIn(t)).toContain('zeptá se · nejde vzít zpět');
    expect(textIn(t)).toContain('Zrušit');
  });

  /** A numbered cylinder, which is the one label on this screen that interpolates. */
  it('numbers a second cylinder in Czech', async () => {
    const said = await renderDetail(dive({ tanks: [tank(), tank({ sizeL: 7 })] }));
    expect(said).toContain('Láhev 1');
    expect(said).toContain('Láhev 2');
  });

  it('says a dive it cannot find is not there, in Czech', async () => {
    expect(await renderDetailFor('nope')).toContain('Ponor nenalezen.');
  });

  /**
   * **This screen's own subscription** (`useT`, src/i18n), and the only thing that proves it is
   * there: nothing is re-rendered by the test, so the repaint can only come from this screen
   * hearing i18next's `languageChanged`. `LanguageSync` is a sibling in the root layout and its
   * state change reaches nobody here — without the hook a diver would change the setting in
   * Settings, come back, and read the old words until something else redrew the screen.
   */
  it('repaints itself when the language changes under it', async () => {
    await cleanup();
    setActiveLanguage('en');
    const t = await renderDetailTree(dive({ maxDepthM: 41.2 }));
    expect(textIn(t)).toContain('Max depth');

    await act(() => {
      setActiveLanguage('cs');
    });
    expect(textIn(t)).toContain('Max. hloubka');
    expect(textIn(t)).not.toContain('Max depth');
  });
});

// ------------------------------------------------------------------------------------------
// Issue #3: the screen brought to the owner's design canvas (screens 03 and 14).
//
// What the canvas draws, and what each test below holds the screen to: a compact hero with the
// dive number on its own line, a "Show on map" card carrying the position, rows of one height
// with a hairline on each, a muted `=` in a fixed slot, and the record's own actions behind ⋯
// rather than at the end of the content. DESIGN.md §0.6 and §10 record what changed and where
// the screen deliberately does not follow the drawing.
// ------------------------------------------------------------------------------------------

describe('brought to the design canvas', () => {
  /** Every style a node wears, merged the way React Native merges an array. */
  const worn = (node: { props: { style?: unknown } } | null | undefined): Record<string, unknown> =>
    Object.assign({}, ...[node?.props.style].flat(5).filter(Boolean));

  /** The row a label sits in: the label's own parent, which is the row's View or Pressable. */
  const rowOf = (screen: RenderResult, label: string) => {
    // The label's own row: its parent, or — for a depth row, whose label leads with a figure glyph
    // since issue #6 — the parent of the glyph-and-label unit.
    const sheet = makeStyles('light');
    let row = textNode(screen, label)?.parent;
    if (row && [row.props.style].flat(3).includes(sheet.detailLabelLed)) row = row.parent;
    if (!row) throw new Error(`no row labelled ${label}`);
    return row;
  };

  const placed = dive({
    id: 'placed',
    date: '2026-08-22',
    timeIn: '09:15',
    siteName: 'Blue Hole',
    centerName: 'Ponorka',
    latitude: 43.0378,
    longitude: 16.1489,
    maxDepthM: 18,
    durationMin: 45,
  });

  async function renderNumbered(d: Dive, number?: number): Promise<RenderResult> {
    stubDives({ dives: [d], numbers: new Map(number === undefined ? [] : [[d.id, number]]), error: undefined });
    mockUseLocalSearchParams.mockReturnValue({ id: d.id });
    return render(<DiveDetailScreen id={d.id} />);
  }

  describe('the hero', () => {
    it('gives the dive number a line of its own above the site, as a dive row does', async () => {
      const screen = await renderNumbered(placed, 6);
      const lines = textIn(screen);
      expect(lines).toContain('#6');
      expect(lines.indexOf('#6')).toBeLessThan(lines.indexOf('Blue Hole'));
    });

    it('says when and with whom under the site: date · time in · centre', async () => {
      const lines = textIn(await renderNumbered(placed, 6));
      expect(lines).toContain('22 Aug 2026 · 09:15 · Ponorka');
      expect(lines.indexOf('Blue Hole')).toBeLessThan(lines.indexOf('22 Aug 2026 · 09:15 · Ponorka'));
    });

    it('leaves out a time that was never recorded, with no stray separator', async () => {
      const lines = textIn(await renderNumbered(dive({ ...placed, timeIn: null }), 6));
      expect(lines).toContain('22 Aug 2026 · Ponorka');
    });

    it('draws no number line for a dive that has no number', async () => {
      const lines = textIn(await renderNumbered(dive({ ...placed, status: 'planned' })));
      expect(lines.filter((line) => line.startsWith('#'))).toEqual([]);
    });

    it('sets the site compact, at 20 on a 22 line', async () => {
      const screen = await renderNumbered(placed, 6);
      const site = worn(textNode(screen, 'Blue Hole'));
      expect(site.fontSize).toBe(20);
      expect(site.lineHeight).toBe(22);
    });

    it('closes on whitespace rather than a rule', async () => {
      const screen = await renderNumbered(placed, 6);
      const hero = textNode(screen, 'Blue Hole')?.parent?.parent;
      expect(worn(hero).borderBottomWidth ?? 0).toBe(0);
      expect(worn(hero).paddingBottom).toBe(18);
    });
  });

  describe('the rows', () => {
    const full = dive({
      date: '2026-08-16',
      timeIn: '09:15',
      siteName: 'Blue Hole',
      maxDepthM: 25,
      avgDepthM: 20,
      durationMin: 45,
      waterTempC: 21,
      buddy: 'Eva',
      tanks: [tank()],
    });

    it('gives every row one 48 pt line, a hairline on its top edge, and the app’s column', async () => {
      const screen = await renderNumbered(full);
      const styles = makeStyles('light');
      const column = styles.diveRow.paddingHorizontal;
      for (const label of ['Status', 'Date', 'Time out', 'Max depth', 'Duration', 'Water temp', 'Gas used', 'Buddy']) {
        const row = worn(rowOf(screen, label));
        expect([label, row.minHeight]).toEqual([label, 48]);
        expect([label, row.borderTopWidth]).toEqual([label, 1]);
        expect([label, row.borderTopColor]).toEqual([label, themeFor('light').border]);
        expect([label, row.paddingHorizontal]).toEqual([label, column]);
        expect([label, row.paddingVertical]).toEqual([label, 12]);
      }
    });

    it('starts the first cluster flush under what is above it, and every later one 22 below its rows', async () => {
      const screen = await renderNumbered(full);
      // Conditions first since issue #6 (the canvas's whole *Dive detail*): it is the cluster flush
      // under the hero, and Date & time takes the ordinary 22 below it.
      const headers = [t('group.conditions'), t('group.dateTime'), t('group.depthDuration'), t('group.gas')].map(
        (title) => worn(textNode(screen, title)?.parent),
      );
      expect(headers.map((header) => header.paddingTop)).toEqual([0, 22, 22, 22]);
      expect(new Set(headers.map((header) => header.paddingBottom))).toEqual(new Set([6]));
    });

    // The first cluster sits flush only under something that closes on its own air — the hero
    // or a card. Under the `Imported from` row it takes the ordinary 22, or its label would read
    // as that row's caption.
    it('gives the first cluster its 22 back when the Imported from row is above it', async () => {
      const screen = await renderNumbered(dive({ ...full, importSource: suuntoJsonImporter.source, importDevice: 'Suunto D5' }));
      expect(worn(textNode(screen, t('group.dateTime'))?.parent).paddingTop).toBe(22);
    });

    it('gives the computed mark a 14 pt slot of its own', async () => {
      const screen = await renderNumbered(full);
      const marks = textNodesOf(screen).filter((n) => n.children[0] === '=');
      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) expect(worn(mark).width).toBe(14);
    });
  });

  describe('the map card', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    afterEach(() => openURL.mockClear());

    it('carries the dive’s position under "Show on map", in place of a GPS row', async () => {
      const lines = textIn(await renderNumbered(placed, 6));
      expect(lines).toContain(t('detail.showOnMap'));
      expect(lines).toContain('43.03780, 16.14890');
      expect(lines).not.toContain(t('field.gps'));
    });

    it('is not drawn for a dive with no position', async () => {
      const lines = textIn(await renderNumbered(dive({ ...placed, latitude: null, longitude: null }), 6));
      expect(lines).not.toContain(t('detail.showOnMap'));
    });

    it('sits between the hero and the first cluster', async () => {
      const lines = textIn(await renderNumbered(placed, 6));
      expect(lines.indexOf(t('detail.showOnMap'))).toBeGreaterThan(lines.indexOf('Blue Hole'));
      expect(lines.indexOf(t('detail.showOnMap'))).toBeLessThan(lines.indexOf(t('group.dateTime')));
    });

    // Issue #21: Ponor's own map, pointed at the dive, pushed over this screen so Back returns
    // here. Where the map opens and what it selects is `MapScreen.test.tsx`'s.
    it('opens Ponor’s map pointed at the dive, and not the device’s maps', async () => {
      (router.push as jest.Mock).mockClear();
      const screen = await renderNumbered(placed, 6);
      await pressControl(screen, t('detail.showOnMap'));
      // `over: 'page'`: pushed over this dive's own page, so the map's link back to it goes back.
      expect(router.push).toHaveBeenCalledWith({ pathname: '/dive/[id]/map', params: { id: 'placed', over: 'page' } });
      expect(openURL).not.toHaveBeenCalled();
    });

    // A plan's site row, as `useDiveSite` would hand it over — only the fields the map reads.
    const blueRow = (over: Partial<DiveSite> = {}) =>
      ({ id: 'blue', name: 'Blue Hole', latitude: 43.0378, longitude: 16.1489, ...over }) as DiveSite;
    const plan = dive({ ...placed, status: 'planned', siteId: 'blue' });

    async function renderPlan(site: DiveSite | null, logbook: Dive[] = [plan]): Promise<RenderResult> {
      (useDiveSite as jest.Mock).mockReturnValue(site);
      stubDives({ dives: logbook, numbers: new Map(), error: undefined });
      mockUseLocalSearchParams.mockReturnValue({ id: plan.id });
      const screen = await render(<DiveDetailScreen id={plan.id} />);
      (router.push as jest.Mock).mockClear();
      return screen;
    }
    afterEach(() => (useDiveSite as jest.Mock).mockReturnValue(null));

    // §2.4 keeps a plan off the map, so a plan points the map at its SITE when it has one (the
    // owner's call on #21's PR) — the same map the site's own page opens. Pushed over the PLAN, so
    // it does not claim to be over the site's page (#27's second review): no `over`.
    it('opens Ponor’s map on a planned dive’s site, since the plan itself is not drawn', async () => {
      const screen = await renderPlan(blueRow());
      expect(useDiveSite).toHaveBeenLastCalledWith('blue');
      await pressControl(screen, t('detail.showOnMap'));
      expect(router.push).toHaveBeenCalledWith({ pathname: '/site/[id]/map', params: { id: 'blue' } });
      expect(openURL).not.toHaveBeenCalled();
    });

    // #27's second review: whether the map can show the site is the MAP's rule, asked here — and the
    // map finds a site the diver has dived at their own mark, with or without a catalogue position.
    it('opens Ponor’s map on a dived site that has no position of its own', async () => {
      const been = dive({ id: 'been', siteId: 'blue', siteName: 'Blue Hole', latitude: 43.0378, longitude: 16.1489 });
      const screen = await renderPlan(blueRow({ latitude: null, longitude: null }), [plan, been]);
      await pressControl(screen, t('detail.showOnMap'));
      expect(router.push).toHaveBeenCalledWith({ pathname: '/site/[id]/map', params: { id: 'blue' } });
    });

    // #27's review: a map pointed at a site it cannot find opens on everything with nothing
    // selected and no Directions — worse than the plan's own pin in the device's maps. So a site
    // this device does not hold (or has not read yet), and one the map could not place, go there.
    it.each([
      ['is not on this device', null],
      ['has no position and has not been dived', blueRow({ latitude: null, longitude: null })],
    ])('opens the device’s maps for a plan whose site %s', async (_, row) => {
      const screen = await renderPlan(row);
      await pressControl(screen, t('detail.showOnMap'));
      expect(openURL).toHaveBeenCalledWith('https://maps.apple.com/?ll=43.0378,16.1489&q=Blue%20Hole');
      expect(router.push).not.toHaveBeenCalled();
    });

    // The decision is made from what the screen already holds, so a press does nothing it would
    // have to wait for: a double tap cannot open two maps on a slow read, and nothing opens over a
    // page the diver has since gone back to (#27's second review).
    it('decides at the press, without waiting on a read', async () => {
      const screen = await renderPlan(blueRow());
      await pressControl(screen, t('detail.showOnMap'));
      // No `act` flush between the press and the assertion: the push has already happened.
      expect(router.push).toHaveBeenCalledTimes(1);
    });

    // A logged dive with a site still points at the DIVE — its place, with its sheet — not at the
    // site: the site branch is for what the map does not draw, and must not shadow the dive's own.
    it('points a logged dive at the dive, even when it has a site', async () => {
      (router.push as jest.Mock).mockClear();
      const screen = await renderNumbered(dive({ ...placed, siteId: 'blue' }), 6);
      expect(useDiveSite).toHaveBeenLastCalledWith(null);
      await pressControl(screen, t('detail.showOnMap'));
      expect(router.push).toHaveBeenCalledWith({ pathname: '/dive/[id]/map', params: { id: 'placed', over: 'page' } });
    });

    // A plan at a place typed by hand has no mark anywhere, so the device's maps do what the words
    // promise, as every dive's card did before #21.
    it('opens a planned dive with no site in the device’s maps', async () => {
      (router.push as jest.Mock).mockClear();
      const screen = await renderNumbered(dive({ ...placed, status: 'planned' }), 6);
      expect(useDiveSite).toHaveBeenLastCalledWith(null);
      await pressControl(screen, t('detail.showOnMap'));
      expect(openURL).toHaveBeenCalledWith('https://maps.apple.com/?ll=43.0378,16.1489&q=Blue%20Hole');
      expect(router.push).not.toHaveBeenCalled();
    });

    // A pair no map can draw — finite, but off the globe — gets no card, and must not therefore
    // vanish from the dive: it stays the GPS row it always was.
    it('keeps a position no map can draw as the row it was, rather than dropping it', async () => {
      const lines = textIn(await renderNumbered(dive({ ...placed, latitude: 91, longitude: 16.1489 }), 6));
      expect(lines).not.toContain(t('detail.showOnMap'));
      expect(lines).toContain(t('field.gps'));
      expect(lines).toContain('91.00000, 16.14890');
    });

    it('is a surface card, radius 12, at least 56 tall, on the app’s column', async () => {
      const screen = await renderNumbered(placed, 6);
      const card = worn(findControl(screen, t('detail.showOnMap')));
      expect(card.backgroundColor).toBe(themeFor('light').surface);
      expect(card.borderRadius).toBe(12);
      expect(card.minHeight).toBe(56);
      expect(card.marginHorizontal).toBe(makeStyles('light').diveRow.paddingHorizontal);
    });
  });

  describe('the record’s actions, behind ⋯', () => {
    it('keeps Delete off the page and puts ⋯ in the top bar', async () => {
      const screen = await renderNumbered(placed, 6);
      expect(findControl(screen, t('detail.moreActions'))).toBeDefined();
      expect(textIn(screen)).not.toContain(t('detail.deleteLabel'));
    });

    it('opens a sheet naming the dive, with Delete, what it costs, and a way out', async () => {
      const screen = await renderNumbered(placed, 6);
      await pressControl(screen, t('detail.moreActions'));
      const lines = textIn(screen);
      expect(lines).toContain('Dive #6');
      expect(lines).toContain('Blue Hole · 22 Aug 2026');
      expect(lines).toContain(t('detail.deleteLabel'));
      expect(lines).toContain(t('detail.deleteCost'));
      expect(findControl(screen, t('common.cancel'))).toBeDefined();
    });

    it('names a planned dive’s sheet without a number it does not have', async () => {
      const screen = await renderNumbered(dive({ ...placed, status: 'planned' }));
      await pressControl(screen, t('detail.moreActions'));
      expect(textIn(screen)).toContain(t('detail.plannedDiveTitle'));
    });

    it('closes on Cancel without asking anything', async () => {
      const screen = await renderNumbered(placed, 6);
      await pressControl(screen, t('detail.moreActions'));
      await pressControl(screen, t('common.cancel'));
      expect(textIn(screen)).not.toContain(t('detail.deleteLabel'));
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('draws the destructive action in ink, never a hue', async () => {
      const screen = await renderNumbered(placed, 6);
      await pressControl(screen, t('detail.moreActions'));
      expect(colorOf(textNode(screen, t('detail.deleteLabel')))).toBe(themeFor('light').fg);
      expect(colorOf(textNode(screen, t('detail.deleteCost')))).toBe(themeFor('light').fgMuted);
    });

    it('stands the sheet 8 in from three edges, radius 22, over a scrim', async () => {
      const screen = await renderNumbered(placed, 6);
      await pressControl(screen, t('detail.moreActions'));
      const sheet = worn(textNode(screen, 'Dive #6')?.parent?.parent);
      expect([sheet.left, sheet.right, sheet.borderRadius]).toEqual([8, 8, 22]);
      expect(sheet.backgroundColor).toBe(themeFor('light').sheet);
    });
  });
});

// --- Issue #6: the conditions as tiles, the depth glyphs, the rating as dots ---

describe('the conditions as tiles', () => {
  const FULL = dive({
    entry: 'boat',
    waterBody: 'ocean',
    weather: 'sunny',
    waves: 1,
    visibility: 'high',
    current: 2,
    surge: 0,
    suit: 'wet',
    suitThicknessMm: 5,
    waterTempC: 19,
  });

  it('builds the tiles in the canvas’s order, each with its drawing, value and field', () => {
    const tiles = conditionTiles(FULL);
    expect(tiles.map((tile) => tile.key)).toEqual(['entry', 'waterBody', 'weather', 'waves', 'visibility', 'current', 'surge', 'suit']);
    expect(tiles.map((tile) => tile.icon)).toEqual([
      'entry.boat',
      'waterBody.ocean',
      'weather.sunny',
      'waves.1',
      'visibility',
      'current',
      'surge.none',
      'suit.wet',
    ]);
    const surge = tiles.find((tile) => tile.key === 'surge')!;
    expect(surge.value).toBe('None');
    expect(surge.label).toBe('Surge');
    // The suit carries its thickness on its own tile (the owner, 2026-11-17).
    expect(tiles.find((tile) => tile.key === 'suit')!.extra).toBe('5 mm');
  });

  it('leaves out a condition the dive does not record', () => {
    expect(conditionTiles(dive({ weather: 'rainy' })).map((tile) => tile.key)).toEqual(['weather']);
    expect(conditionTiles(dive({}))).toEqual([]);
  });

  it('shows a scale it cannot draw as its word, with no icon', () => {
    const [waves] = conditionTiles(dive({ waves: 7 }));
    expect(waves!.icon).toBeNull();
    expect(waves!.value.length).toBeGreaterThan(0);
  });

  it('keeps a thickness without a suit as a row', async () => {
    const said = await renderDetail(dive({ suitThicknessMm: 7 }));
    expect(said).toContain('Suit thickness');
    expect(conditionTiles(dive({ suitThicknessMm: 7 }))).toEqual([]);
  });

  it('draws the tiles on the screen and no longer repeats them as rows', async () => {
    const t = await renderDetailTree(FULL);
    const styles = makeStyles('light');
    const rowLabels = (t.root?.queryAll((n) => n.type === 'Text' && [n.props.style].flat(3).includes(styles.detailLabel)) ?? []).map(
      (n) => n.children.join(''),
    );
    for (const label of ['Entry', 'Water body', 'Weather', 'Waves', 'Visibility', 'Current', 'Surge', 'Suit', 'Suit thickness']) {
      expect(rowLabels).not.toContain(label);
    }
    // Eight drawings: one per tile.
    const tiles = t.root?.queryAll((n) => n.type === 'View' && [n.props.style].flat(3).includes(styles.conditionTile)) ?? [];
    expect(tiles).toHaveLength(8);
    // The water temperature, which has no drawing, is still a row of the same cluster.
    expect(rowLabels).toContain('Water temp');
  });

  it('draws no tiles and no Conditions heading for a dive without conditions', async () => {
    const said = await renderDetail(dive({}));
    expect(said).not.toContain('Conditions');
  });

  it('leads the max and average depth rows with their glyphs', async () => {
    const t = await renderDetailTree(dive({ maxDepthM: 28.4, avgDepthM: 17.6, durationMin: 47 }));
    const styles = makeStyles('light');
    const rowOf = (label: string) =>
      t.root?.queryAll((n) => n.type === 'View' && [n.props.style].flat(3).includes(styles.detailRow)).find((row) =>
        row.queryAll((n) => n.type === 'Text').some((n) => n.children.join('') === label),
      );
    expect(rowOf('Max depth')?.queryAll((n) => n.type === 'RNSVGSvgView')).toHaveLength(1);
    expect(rowOf('Avg depth')?.queryAll((n) => n.type === 'RNSVGSvgView')).toHaveLength(1);
    expect(rowOf('Duration')?.queryAll((n) => n.type === 'RNSVGSvgView')).toHaveLength(0);
  });

  // Final review, Important #4: a rating outside the scale (§10 keeps the column unclamped) must not
  // be dressed as five filled dots — `RatingDots` refuses to let dots stand in for a number that is
  // not on the scale — so it keeps the figure, as a scale level out of range keeps its word.
  it('prints a rating outside the scale as its figure, not as five dots', async () => {
    const t = await renderDetailTree(dive({ rating: 9 }));
    const styles = makeStyles('light');
    expect(t.root?.queryAll((n) => n.type === 'View' && [n.props.style].flat(3).includes(styles.ratingDot)) ?? []).toHaveLength(0);
    expect(textIn(t)).toContain('9 / 5');
  });

  it('draws the rating as the five dots the list and the form use, four filled for a 4', async () => {
    const t = await renderDetailTree(dive({ rating: 4 }));
    const styles = makeStyles('light');
    const dots = t.root?.queryAll((n) => n.type === 'View' && [n.props.style].flat(3).includes(styles.ratingDot)) ?? [];
    expect(dots).toHaveLength(5);
    expect(dots.filter((n) => [n.props.style].flat(3).includes(styles.ratingDotFilled))).toHaveLength(4);
    expect(textIn(t)).not.toContain('4 / 5');
  });
});

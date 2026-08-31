import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import { dive } from '../domain/diveFixture';
import { softDeleteDive } from '../db/dives';
import { useDives, type DiveListState } from '../db/useDives';
// Namespace import, not the usual named one: the completeness test below (`marks every
// value this screen reads from derived.ts as computed`) needs the module's own export list
// at runtime, via `Object.keys`, rather than a set of names typed into this file — see that
// test's own comment for why.
import * as derived from '../domain/derived';
import { type Dive, type Tank } from '../domain/types';
import { completeDiveHref, editDiveHref } from '../navigation/editDiveLink';
import { fonts } from '../theme/fonts';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
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
// M1d task 7: this screen now writes, too — the one write it has, `softDeleteDive`. Mocked
// per module exactly as DiveFormScreen.test.tsx mocks `createDive`/`updateDive`, so a delete
// test controls what the write resolves or rejects with and no real database is involved.
// `router.push` joins the fake for the Edit control, which opens `/dive/[id]/edit`.
jest.mock('../db/dives', () => ({ softDeleteDive: jest.fn() }));
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
const SUSPICIOUS_TYPE_NAME = /svg|path|circle|rect|ellipse|polyline|polygon|canvas|chart|sparkline|profile|image/i;

function unexpectedGraphics(t: RenderResult, scheme: 'dark' | 'light' = 'dark') {
  if (!t.root) return [];
  const known = Object.values(makeStyles(scheme));
  const byName = t.root.queryAll((n) => typeof n.type === 'string' && SUSPICIOUS_TYPE_NAME.test(n.type));
  const byAdHocStyle = t.root.queryAll((n) => {
    if (n.type !== 'View') return false;
    const style = [n.props?.style].flat(5).filter(Boolean);
    return style.length > 0 && !style.some((s) => known.includes(s));
  });
  return [...byName, ...byAdHocStyle];
}

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

afterEach(() => {
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
    ? t.root.queryAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Back to dives')
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

it('shows every cylinder its own MOD, because there is no single dive MOD', async () => {
  const d = dive({
    date: '2026-06-04',
    tanks: [
      { material: 'steel', sizeL: 12, count: 2, workingBar: 232, o2Pct: 18, hePct: 45, startBar: 230, endBar: 90 },
      { material: 'alu',   sizeL: 7,  count: 1, workingBar: 200, o2Pct: 50, hePct: 0,  startBar: 200, endBar: 120 },
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
      { material: 'steel', sizeL: 12, count: 1, workingBar: 232, o2Pct: 18, hePct: 45, startBar: 230, endBar: 90 },
      { material: 'alu',   sizeL: 7,  count: 1, workingBar: 200, o2Pct: 50, hePct: 0,  startBar: 200, endBar: 120 },
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
      { material: 'steel', sizeL: 12, count: 2, workingBar: 232, o2Pct: 18, hePct: 45, startBar: 230, endBar: 90 },
      { material: 'alu',   sizeL: 7,  count: 1, workingBar: 200, o2Pct: 50, hePct: 0,  startBar: 200, endBar: 120 },
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
  expect(text).toContain('steel'); // Material
  expect(text).toContain('12 l'); // Size
  expect(text).toContain('232 bar'); // Working pressure
  expect(text).toContain('0 %'); // O₂ — recorded, not absent, even though unusable for MOD
  expect(text).toContain('21 %'); // He
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
// here, so a value added to that module is counted automatically too.
//
// The fixture below is built so all six of today's exports return non-null and each renders
// as exactly one row: one tank (not two) keeps MOD and Used from doubling up the way task
// 4's "shows every cylinder its own MOD" test deliberately exercises elsewhere, and the
// earlier/target pair is the same shape "marks the surface interval..." above already
// proves resolves to a non-null interval. Marked-count and export-count coincide at 6 today
// only because every current export is both non-null for this fixture AND wired into this
// screen; a derived value added for some other screen entirely (not rendered here at all)
// would desync the two sides without this screen having done anything wrong — a limit worth
// naming rather than a defect this test can see around, since nothing short of re-deriving
// each value from its own inputs (i.e. hardcoding the six again, just as function calls
// instead of as strings) could rule it out.
it('marks every value this screen reads from derived.ts as computed, not just five of six', async () => {
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
  expect(markCount).toBe(Object.keys(derived).length);
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
it('opens with a hero — site name heading, then number · date · centre in mono', async () => {
  const d = dive({ date: '2026-08-22', siteName: 'Blue Hole', centerName: 'Ponorka', maxDepthM: 18 });
  stubDives({ dives: [d], numbers: new Map([[d.id, 6]]), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const text = textIn(await render(<DiveDetailScreen id={d.id} />)).join(' ');
  expect(text).toContain('Blue Hole');
  expect(text).toContain('#6 · 22 Aug 2026 · Ponorka');
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
  // The 22 px hero heading names the dive rather than being absent — the same words
  // DiveRow.test.tsx pins for the same dive in the list it was tapped from.
  const headings = textNodesOf(t).filter((n) => fontSizeOf(n) === 22);
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

  const heading = textNodesOf(t).find((n) => fontSizeOf(n) === 22);
  expect(String(heading?.children[0] ?? '')).toBe('Aqua');
  // The sub-line still carries everything else it had.
  const sub = textNodesOf(t).find((n) => String(n.children[0] ?? '').startsWith('#6'));
  expect(String(sub?.children[0] ?? '')).toBe('#6 · 22 Aug 2026');
});

// The control for the test above: with a real site name, the centre is NOT the label, so
// the sub-line keeps it. Without this, "drop the centre from the sub-line entirely" would
// pass — and that is the more likely wrong fix, since it needs less code.
it('keeps the centre in the sub-line whenever the heading is not already showing it', async () => {
  const d = dive({ date: '2026-08-22', siteName: 'Blue Hole', centerName: 'Aqua' });
  stubDives({ dives: [d], numbers: new Map([[d.id, 6]]), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const t = await render(<DiveDetailScreen id={d.id} />);
  const sub = textNodesOf(t).find((n) => String(n.children[0] ?? '').startsWith('#6'));
  expect(String(sub?.children[0] ?? '')).toBe('#6 · 22 Aug 2026 · Aqua');
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
            sizeL: Number.NaN,
            count: Number.NaN,
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
  expect(text).toContain('4 / 5');
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
            sizeL: Number.NaN,
            count: Number.NaN,
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

// DESIGN.md §0.6's hairline rule, applied to this screen's clusters: separators sit on the
// TOP edge, so each cluster's own line reads as the rule under the cluster before it. `gap`
// alone was doing all the separating here, which left the seven clusters reading as one
// undifferentiated column — the same complaint §0.6 exists to answer for the list.
//
// The FIRST cluster is the exception, and that is what `detailClusterFirst` is for: it sits
// immediately below the hero, which already draws its own bottom border, so a rule here too
// would land as a visible double line. Both halves need pinning — a variant that never
// applied would show up as a doubled line, and a border that never applied would leave the
// screen exactly as it was.
it('rules each cluster off from the one above it, except the first, which the hero already closes', async () => {
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

  const clusters = t.root.queryAll((n) => [n.props?.style].flat(3).filter(Boolean).includes(styles.detailCluster));
  // Date & time, Site & centre, Depth & duration, Conditions — four, so "the first" is
  // genuinely distinguishable from "every cluster" and from "the last".
  expect(clusters).toHaveLength(4);

  const borderWidthOf = (node: (typeof clusters)[number]) =>
    [node.props.style].flat(3).filter(Boolean).reduce((a: number, s: any) => (typeof s?.borderTopWidth === 'number' ? s.borderTopWidth : a), 0);
  const borderColorOf = (node: (typeof clusters)[number]) =>
    [node.props.style].flat(3).filter(Boolean).reduce((a: unknown, s: any) => s?.borderTopColor ?? a, undefined);

  const paddingTopOf = (node: (typeof clusters)[number]) =>
    [node.props.style].flat(3).filter(Boolean).reduce((a: number, s: any) => (typeof s?.paddingTop === 'number' ? s.paddingTop : a), 0);

  expect(borderWidthOf(clusters[0]!)).toBe(0);
  // No leftover padding either: that space exists to hold a label off a line, and the first
  // cluster has no line — keeping it would just push the screen's first heading away from
  // the hero on top of `detailContent`'s own padding.
  expect(paddingTopOf(clusters[0]!)).toBe(0);
  for (const cluster of clusters.slice(1)) {
    expect(borderWidthOf(cluster)).toBeGreaterThan(0);
    expect(borderColorOf(cluster)).toBe(themeFor('light').border);
    // Enough room below the line that the cluster's own label isn't sitting on it.
    expect(paddingTopOf(cluster)).toBeGreaterThan(0);
  }
});

it('draws no profile chart, because no dive carries a sample series', async () => {
  const t = await renderDetailTree(diveWithGas);
  // DivesScreen.tsx's own constraint applies here too: this screen resolves its scheme via
  // useColorScheme(), which is 'light' under Jest — the whitelist has to be built from the
  // same scheme the screen actually rendered with, or every real style would misreport as
  // "ad hoc" against the wrong scheme's cached objects.
  expect(unexpectedGraphics(t, 'light')).toHaveLength(0);
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
  const back = textNode(t, '‹ Dives');
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

/** Presses Delete and then the Alert's own destructive button, which is the only path that
 * actually deletes anything. */
async function confirmDelete(t: RenderResult) {
  await pressControl(t, 'Delete dive');
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
// *Complete dive* at the end of the content above *Delete dive* — the same place, and for the
// same reason, `detailDelete` already sits there (theme/styles.ts).
//
// Every test below asserts WHICH HREF a named control sends, not merely that some link was
// pushed: this pair's whole history is a label and a link disagreeing (§10 — "Complete dive"
// wired to the plain edit link completes nothing while saying it did), and an assertion on
// labels alone, or on `mockPush` having been called, survives the two hrefs being swapped.
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
it('puts Edit above the hero and Complete dive at the end of the content, above Delete', async () => {
  const d = dive({ id: 'p1', status: 'planned', siteName: 'Blue Hole', date: '2026-09-01' });
  stubDives({ dives: [d], numbers: new Map(), error: undefined });
  mockUseLocalSearchParams.mockReturnValue({ id: d.id });
  const texts = textIn(await render(<DiveDetailScreen id={d.id} />));

  const edit = texts.indexOf('Edit');
  const site = texts.indexOf('Blue Hole'); // the hero heading
  const status = texts.indexOf('Status'); // the first cluster's first label
  const complete = texts.indexOf('Complete dive');
  const del = texts.indexOf('Delete dive');

  expect(edit).toBeGreaterThanOrEqual(0);
  expect(complete).toBeGreaterThanOrEqual(0);
  expect(del).toBeGreaterThanOrEqual(0);
  // Edit is chrome above the hero...
  expect(edit).toBeLessThan(site);
  // ...and Complete dive is past every cluster, immediately before Delete.
  expect(complete).toBeGreaterThan(status);
  expect(complete).toBeLessThan(del);
});

// §0.1: colour encodes depth and nothing else, so this control gets no hue — and it is not
// destructive, so it must not read as *Delete dive* either. §0.6's existing quiet-control
// vocabulary is what separates them: "a bordered pill in tracked uppercase, not plain text,
// so it reads as a control rather than a label" — the same `actionPill` this exact action
// already wears on an "Up next" row, versus Delete's deliberately plain muted label.
it('gives Complete dive the bordered-pill control treatment, not Delete’s plain label', async () => {
  const t = await renderDetailTree(dive({ id: 'p1', status: 'planned' }));
  if (!t.root) throw new Error('DiveDetailScreen did not render a root element');
  // 'light' is the scheme useColorScheme() reports under Jest — the same note every other
  // style assertion in this file carries.
  const styles = makeStyles('light');
  const theme = themeFor('light');

  const complete = textNode(t, 'Complete dive');
  const del = textNode(t, 'Delete dive');
  expect(complete).toBeDefined();
  expect(del).toBeDefined();

  // A bordered pill wraps the label, and Delete has no such wrapper — that is the whole
  // difference in weight, and it is a shape the app already owns rather than new vocabulary.
  const pills = t.root.queryAll((n) => [n.props?.style].flat(3).filter(Boolean).includes(styles.detailCompletePill));
  expect(pills).toHaveLength(1);
  expect(pills[0]!.props.style.borderWidth).toBeGreaterThan(0);
  expect(pills[0]!.props.style.borderColor).toBe(theme.border);

  // Monochrome on both: whatever ink each carries, neither may be a hue.
  for (const colour of [colorOf(complete), colorOf(del)]) {
    expect([theme.fg, theme.fgMuted]).toContain(colour);
  }
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
  await pressControl(t, 'Delete dive');

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

it("keeps the app's own delete control muted, never coloured", async () => {
  const t = await renderDetailTree(dive({ id: 'target' }));
  // §0.1: colour encodes depth and nothing else, so this app's own surface stays monochrome
  // — the destructive colour belongs to the Alert above and to nothing this screen draws.
  expect(colorOf(textNode(t, 'Delete dive'))).toBe(themeFor('light').fgMuted);
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
  expect(findControl(t, 'Delete dive')).toBeUndefined();
  expect(textIn(t).join(' ')).toContain('Dive not found');
});

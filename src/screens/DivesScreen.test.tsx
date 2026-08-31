import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import { dive } from '../domain/diveFixture';
// The real numbering rule, not a stub: §2.5's numbers are computed, so a test that
// hand-wrote them would be asserting its own arithmetic rather than the app's.
import { assignDiveNumbers } from '../domain/diveNumber';
import { reorderDivesForDate, softDeleteDive, type ReorderOutcome } from '../db/dives';
import { useDives, type DiveListState } from '../db/useDives';
import { useWideLayout } from '../hooks/useWideLayout';
import { completeDiveHref } from '../navigation/editDiveLink';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import DivesScreen from './DivesScreen';

// This file used to mock `react-native-safe-area-context` (its own official `jest/mock`)
// because DivesScreen called `useSafeAreaInsets()` to clear the home indicator, and the
// real hook throws without a Provider ancestor, which a bare render has none of. DESIGN.md
// §3's note moved the floating row to the TOP, where the clearance it needs is
// `screen`/`wideListColumn`'s own static `paddingTop: 48` — the same one every screen in
// the app uses — so this screen reads no insets at all any more and the mock went with the
// call. Nothing else this file renders reads them either.

// Jest hoists jest.mock() calls above the imports above at transform time regardless of
// where it sits textually, so it can live here without an import/first violation.
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
// The unit preference (§3), mocked per module exactly as `useDives` is above and for the
// same reason: it is a live database read, and this screen must be renderable in either
// system without one. Left on its own default, `metric`, by every test that does not care
// — which is what keeps the existing assertions below reading in metres, unchanged.
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));

// DivesScreen calls this one directly (via ReorderControls.tsx's applyReorder), unlike
// every read, which goes through the mocked useDives() above — mocked separately so a
// reorder test can control exactly what ReorderOutcome it resolves with, without a real
// database.
jest.mock('../db/dives', () => ({ reorderDivesForDate: jest.fn(), softDeleteDive: jest.fn() }));
// `softDeleteDive` joins it for the wide layout below: the embedded DiveDetailScreen owns the
// delete, and Jest mocks a module once per test FILE regardless of which file under test does
// the importing. Left out, the embedded pane would call `undefined` and report a failed delete.
// A bare jest.fn() returns undefined, which is falsy — every pre-existing test below, none
// of which mentions wide layouts, is unaffected and keeps exercising the narrow layout.
// Only the wide-layout tests near the bottom of this file set this to true.
jest.mock('../hooks/useWideLayout', () => ({ useWideLayout: jest.fn() }));
// Needed once this screen can embed DiveDetailScreen.tsx (the wide layout, below): that
// component imports both of these names from expo-router itself (see its own test file),
// and Jest mocks a module once per test FILE regardless of which file under test does the
// importing. `router` doubles as this screen's own real navigation call for the narrow
// layout (`openDive`/`logDive`).
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

// Adapted from the brief's react-test-renderer-shaped example to the API the installed
// @testing-library/react-native@14 actually exposes — the same adaptation already used in
// DiveRow.test.tsx and DepthValue.test.tsx: `render` wraps its own `act()` and is async,
// its `root` is a `test-renderer` `TestInstance` exposing `queryAll(predicate)` rather than
// `findAllByType`, and its tree holds host elements only. Assertions are otherwise
// unchanged from the brief's own text.
function textNodesOf(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.type === 'Text') : [];
}

function textIn(t: RenderResult): string[] {
  return textNodesOf(t)
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

/** The capsule's leading glyph — the magnifier that opens `/search`. Matched on the label
 * rather than the symbol because the label is what this screen decides and a screen reader
 * hears; which SF Symbol it draws is ActionCapsule.test.tsx's concern. It has ONE label now:
 * the glyph used to toggle between a magnifier and an × while the field lived on this
 * screen, and reports no state at all since the field moved to one of its own. */
function findSearchToggle(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === 'Search dives') : [];
  if (!node) throw new Error('DivesScreen did not render a "Search dives" control');
  return node;
}

/** Every "Move ... up" / "Move ... down" control, in tree order. Matched by
 * prefix/suffix, not the exact label, because ReorderControls.tsx's `rowLabel`
 * now bakes each row's own site name and position into the label text (the
 * fix for this task's Minor finding) — see ReorderControls.test.tsx for
 * coverage of that label's actual content. */
function findAllMoveButtons(t: RenderResult, direction: 'up' | 'down') {
  return t.root
    ? t.root.queryAll(
        (n) =>
          typeof n.props?.accessibilityLabel === 'string' &&
          n.props.accessibilityLabel.startsWith('Move ') &&
          n.props.accessibilityLabel.endsWith(` ${direction}`),
      )
    : [];
}

/** Every DayStrip action currently reading "Reorder" (mode off) or "Done" (mode on), in
 * tree order — DayStrip.tsx always labels its one Pressable `Reorder ${date}` or
 * `Done reordering ${date}`, so matching that prefix finds the button regardless of
 * which day it belongs to (tests that care which day use the count/order instead, the
 * same way findAllMoveButtons's own callers do). M1c task 6: hand-ordering now goes
 * through this toggle first — no test below can reach a day's arrows without pressing it. */
function findDayStripAction(t: RenderResult, mode: 'Reorder' | 'Done') {
  const prefix = mode === 'Reorder' ? 'Reorder ' : 'Done reordering ';
  return t.root
    ? t.root.queryAll(
        (n) => n.props?.accessibilityRole === 'button' && typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(prefix),
      )
    : [];
}

/** Every node currently dimmed by DivesScreen.tsx's `reorderDimmed` style (opacity
 * 0.32) — styles.ts's own comment on that key: applied to every row that is not part of
 * the one active reorder day, once some day is active. */
function dimmedNodes(t: RenderResult) {
  return t.root
    ? t.root.queryAll((n) => {
        const style = [n.props?.style].flat(5).filter(Boolean) as Record<string, unknown>[];
        return style.some((s) => s.opacity === 0.32);
      })
    : [];
}

/** Toggling a DayStrip changes the SectionList's own `data` length (a `reorderGroup`
 * entry replaces N separate `dive` entries, or back), which is enough of a reshape that
 * VirtualizedList schedules its own internal, low-priority cell-range update up to
 * `updateCellsBatchingPeriod` (default 50 ms) later. A test that toggles more than one
 * strip needs this flushed, inside act(), before the NEXT interaction — otherwise that
 * timer can fire between two un-act()-wrapped steps and log a "not wrapped in act(...)"
 * warning, or worse, bleed into whichever test runs next (this file already flags that
 * exact risk, for a different cause, in the concurrency test below). Every test that
 * presses at most one DayStrip toggle never reaches this path and does not need it. */
async function pressToggleAndSettle(node: NonNullable<RenderResult['root']>) {
  await fireEvent.press(node);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

/** M1c task 8, DESIGN.md §0.6 ("The search field yields to the list"). The SectionList's
 * own scrollable host node, located by the one prop DivesScreen.tsx sets directly on it
 * (`onScroll`, wired to useHideOnScroll) rather than by any row's content — fireEvent.scroll
 * climbs from whatever node it is given looking for a matching handler (the same climbing
 * behaviour findRow below already relies on for press), so this just names the target
 * directly instead of reusing an unrelated row lookup that would break if row content
 * changed. Throws rather than returning undefined, matching findSearchInput's contract. */
function findScrollable(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => typeof n.props?.onScroll === 'function') : [];
  if (!node) throw new Error('DivesScreen did not render a scrollable node with onScroll');
  return node;
}

/** DESIGN.md §3's note: the floating TOP row holding the action capsule — located by the
 * one style only that wrapper wears. It used to be found by `accessibilityElementsHidden`,
 * the prop that gated its hide-on-scroll state; the row is persistent now (see this file's
 * own note where those tests were), so that prop is gone and the style is what identifies
 * it. Named `findFloatingRow` through three homes because it has always been the same
 * object: whatever floats over the list. */
function findFloatingRow(t: RenderResult) {
  const [node] = t.root
    ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').topActionRow))
    : [];
  if (!node) throw new Error('DivesScreen did not render the floating row wrapper');
  return node;
}

/** The "+" — now the capsule's trailing glyph rather than a 60 dp circle, and matched by
 * the same accessibilityLabel it carried as a circle, which EmptyState's differently
 * labelled primary action (rendered only on the empty-logbook branch, never alongside this
 * one) can never collide with. */
function findLogDive(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === 'Log a dive') : [];
  if (!node) throw new Error('DivesScreen did not render the "+"');
  return node;
}

/** A DiveRow, found by its own number badge ("#<n>") rather than its site name: a
 * centre-less trip's TripHeader is titled after that same site name (domain/trips.ts's
 * `tripKeyOf`), so matching on the name would find the header FIRST — and pressing it would
 * silently do nothing, since it carries no press handler for `fireEvent.press` to climb to
 * (see fire-event.js's own `findEventHandler`: no handler found up the tree just returns,
 * it doesn't throw). "#<n>" is unique to DiveRow. Presses any Text node inside the row;
 * `fireEvent.press` climbs to the nearest ancestor with a press handler regardless of which
 * descendant it's called on (the same mechanism DiveRow.test.tsx's own top note relies on
 * for `fireEvent.press(t.root)`). Throws rather than returning undefined, matching
 * findSearchInput's contract above. */
function findRow(t: RenderResult, number: number) {
  const [node] = t.root ? t.root.queryAll((n) => n.type === 'Text' && n.children.includes(`#${number}`)) : [];
  if (!node) throw new Error(`DivesScreen did not render a row numbered #${number}`);
  return node;
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

const mockReorderDivesForDate = reorderDivesForDate as jest.Mock;
const mockUseWideLayout = useWideLayout as jest.Mock;
const mockSoftDelete = softDeleteDive as jest.Mock;
// The wide layout embeds DiveDetailScreen, whose delete confirms through the platform Alert
// (§0.1: the red belongs to OS chrome). Spied once for the file; nothing else here calls it.
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
afterEach(() => alertSpy.mockClear());
const mockRouterPush = router.push as jest.Mock;
const mockRouterBack = router.back as jest.Mock;
const mockRouterReplace = router.replace as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as jest.Mock;

afterEach(() => {
  mockUseDives.mockReset();
  mockReorderDivesForDate.mockReset();
  mockUseWideLayout.mockReset();
  mockRouterPush.mockReset();
  mockUseLocalSearchParams.mockReset();
});

it('shows the empty state when there are no dives', async () => {
  stubDives({ dives: [], numbers: new Map(), error: undefined });
  const t = await render(<DivesScreen />);
  expect(textIn(t).join(' ')).toContain('Log your first dive');
});

// Review task 7, Important #4: EmptyState's primary action is the entire first-run
// experience, and a Pressable carries no accessibilityRole on its own — a screen reader
// user was never told this text was actionable. The empty-logbook branch renders nothing
// else (no fab, no search box — DivesScreen.tsx's early return), so any
// accessibilityRole="button" node found here is unambiguously EmptyState's own action.
it("announces the empty state's primary action as a button", async () => {
  stubDives({ dives: [], numbers: new Map(), error: undefined });
  const t = await render(<DivesScreen />);
  const buttons = t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : [];
  expect(buttons).toHaveLength(1);
});

it('pins planned dives above logged ones under "Up next"', async () => {
  stubDives({
    dives: [dive({ id: 'p', date: '2026-09-01', status: 'planned' }), dive({ id: 'l', date: '2026-08-16' })],
    numbers: new Map([['l', 12]]),
    error: undefined,
  });
  const text = textIn(await render(<DivesScreen />)).join(' ');
  expect(text).toContain('Up next');
  expect(text.indexOf('Up next')).toBeLessThan(text.indexOf('12'));
});

// TripHeader.test.tsx already pins what each variant looks like; this is the proof that
// THIS screen hands "Up next" the upNext variant and its own count, rather than dressing a
// forward-looking queue as one more logged trip. Two planned dives and a logged one, so the
// count is a number the section actually had to work out (not `dives.length`, and not a
// constant that would read right for one dive).
it('heads "Up next" with its dive count in full ink, not as another trip', async () => {
  stubDives({
    dives: [
      dive({ id: 'p1', date: '2026-09-05', status: 'planned' }),
      dive({ id: 'p2', date: '2026-09-01', status: 'planned' }),
      dive({ id: 'l', date: '2026-08-16', siteName: 'Blue Hole' }),
    ],
    numbers: new Map([['l', 12]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const styles = makeStyles('light'); // the scheme useColorScheme() reports under Jest
  const texts = t.root ? t.root.queryAll((n) => n.type === 'Text') : [];

  const upNext = texts.find((n) => n.children[0] === 'Up next');
  const trip = texts.find((n) => n.children[0] === 'Blue Hole');
  if (!upNext || !trip) throw new Error('expected both an "Up next" and a trip header');
  const inkOf = (n: typeof upNext) =>
    [n.props.style].flat(3).filter(Boolean).reduce((a: unknown, s: any) => s?.color ?? a, undefined);
  expect(inkOf(upNext)).toBe(themeFor('light').fg);
  expect(inkOf(trip)).toBe(themeFor('light').fgMuted);

  // The count sits in the same trailing slot, and same style, a trip's date range uses.
  const count = texts.find((n) => n.children[0] === '2 dives');
  if (!count) throw new Error('"Up next" did not state how many dives are queued');
  expect([count.props.style].flat(3).filter(Boolean)).toContain(styles.tripDateRange);
});

// useDives() hands back one order, newest-date-first (compareDiveOrder,
// reversed) — correct for logged trips, but backwards within "Up next":
// a planned dive further in the future sorts as "newest", so the mock
// below is deliberately furthest-future-first, exactly what the real hook
// would return. Three dives, not two, so a partial or coincidentally-right
// reorder can't pass this by luck — only a genuine full reversal puts all
// three in soonest-first order.
it('orders "Up next" soonest-first, not newest-date-first', async () => {
  stubDives({
    dives: [
      dive({ id: 'far', date: '2026-12-25', status: 'planned', siteName: 'Far Reef' }),
      dive({ id: 'mid', date: '2026-10-10', status: 'planned', siteName: 'Mid Wall' }),
      dive({ id: 'soon', date: '2026-09-05', status: 'planned', siteName: 'Soon Cave' }),
    ],
    numbers: new Map(),
    error: undefined,
  });
  const text = textIn(await render(<DivesScreen />)).join(' ');
  const soonIndex = text.indexOf('Soon Cave');
  const midIndex = text.indexOf('Mid Wall');
  const farIndex = text.indexOf('Far Reef');
  expect(soonIndex).toBeGreaterThan(-1);
  expect(midIndex).toBeGreaterThan(-1);
  expect(farIndex).toBeGreaterThan(-1);
  expect(soonIndex).toBeLessThan(midIndex);
  expect(midIndex).toBeLessThan(farIndex);
});

it('surfaces a read error instead of rendering an empty logbook', async () => {
  stubDives({ dives: [], numbers: new Map(), error: new Error('disk') });
  const text = textIn(await render(<DivesScreen />)).join(' ');
  expect(text).not.toContain('Log your first dive');
  expect(text.toLowerCase()).toContain("couldn't");
});

// Review task 7, Important #3: a failed useDives() settings read used to be folded into
// the same fatal `error` as a failed dives read, blanking the entire logbook over what is
// only a display-preference failure — dive numbering, not the dives themselves. The dives
// must still render, and the diver must still be told something is wrong rather than shown
// a silently-reset dive count.
it('shows the dives and a settings notice, rather than blanking the logbook, when only the settings read fails', async () => {
  stubDives({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
    settingsError: new Error('settings unreadable'),
  });
  const text = textIn(await render(<DivesScreen />)).join(' ');
  expect(text).toContain('Blue Hole');
  expect(text).not.toContain("Couldn't open your logbook");
  expect(text.toLowerCase()).toContain("couldn't read your settings");
});

// The two failure modes are independent switches, not one accidentally standing in for the
// other: a failed DIVES read still blanks the logbook even when the settings read also
// failed alongside it — the fatal branch takes priority rather than the two colliding into
// some third, unspecified state.
it('still blanks the logbook for a failed dives read even when the settings read also failed', async () => {
  stubDives({
    dives: [],
    numbers: new Map(),
    error: new Error('disk'),
    settingsError: new Error('settings unreadable'),
  });
  const text = textIn(await render(<DivesScreen />)).join(' ');
  expect(text.toLowerCase()).toContain("couldn't open your logbook");
  expect(text.toLowerCase()).not.toContain("couldn't read your settings");
});

// DESIGN.md §3 lists search as one of the Dives screen's jobs, and §3's note (owner's call,
// measured on iOS 26 Messages) splits that job in two: the TRIGGER is a magnifier in the
// top-right capsule, and the FIELD lives at the bottom of a screen of its own, on the
// keyboard. What belongs to THIS screen is therefore the trigger and nothing else — that it
// opens `/search`, and that no query, field or filter is left here.
//
// Everything the field itself does — narrowing the list, saying when nothing matched, the
// way out — moved with it to SearchScreen.test.tsx rather than being dropped. This file's
// own history is the reason to say so: two tests here asserted a search field that this
// screen no longer owns, and deleting them without a forwarding address would look like
// coverage quietly lost.
it('opens the search screen from the magnifier, and holds no search field of its own', async () => {
  stubDives({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' }), dive({ id: 'b', siteName: 'Shark Reef' })],
    numbers: new Map([
      ['a', 1],
      ['b', 2],
    ]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);

  expect(t.root?.queryAll((n) => n.type === 'TextInput')).toHaveLength(0);
  await fireEvent.press(findSearchToggle(t));
  expect(mockRouterPush).toHaveBeenCalledWith('/search');
  // ...and pressing it navigated rather than filtering in place: both dives are still here.
  const text = textIn(t).join(' ');
  expect(text).toContain('Blue Hole');
  expect(text).toContain('Shark Reef');
});

// **This test used to assert the opposite, and the opposite was right at the time.** It
// pinned the row to the BOTTOM, offset by the real `insets.bottom`, against DESIGN.md
// §0.6's "Search is a floating capsule at the bottom, beside the `+`". §3's note supersedes
// that placement outright — "Tabs go to the bottom; search and `+` move to a top-right
// capsule", an owner's call measured off iOS 26 — and the reason is a collision, not a
// preference: the tab bar now occupies the space that row stood in. So the assertion is
// inverted rather than deleted, and it keeps the same shape it had, which is what makes it
// able to fail: `top` present and `bottom` absent, plus `right` pinned closer than `left`
// is (the row spans the width so the search field has somewhere to grow, and
// `justifyContent: 'flex-end'` is what actually puts the capsule on the right — asserted
// here because "renders a capsule" would pass wherever it sat).
it('floats the action capsule at the top of the screen, pinned right, not at the bottom', async () => {
  stubDives({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const style = [findFloatingRow(t).props.style].flat(5).filter(Boolean) as Record<string, unknown>[];

  expect(style.some((s) => s.position === 'absolute')).toBe(true);
  expect(style.some((s) => s.top !== undefined)).toBe(true);
  expect(style.some((s) => s.bottom !== undefined)).toBe(false);
  expect(style.some((s) => s.justifyContent === 'flex-end')).toBe(true);
});

// The list must not open with its first rows underneath the capsule that now floats over
// them. Checked as a relation rather than a number — the padding has to clear the capsule's
// own height, so a capsule that grew without the padding following would fail this — and
// read off makeStyles rather than retyped, so neither side can be satisfied by a constant
// copied into the test.
it('clears the list past the capsule floating over its first rows', async () => {
  const styles = makeStyles('dark');
  const capsuleHeight = (styles.actionCapsulePlain as Record<string, unknown>).height;
  const listPaddingTop = (styles.listContent as Record<string, unknown>).paddingTop;
  expect(typeof capsuleHeight).toBe('number');
  expect(listPaddingTop).toBeGreaterThan(capsuleHeight as number);
});

// §3's note: the capsule carries search and `+` "as equal monochrome glyphs" — ONE object
// in one row, not two controls that happen to sit near each other. Proven structurally:
// each must be a genuine DESCENDANT of the row `findFloatingRow` locates, so a `+` that
// drifted into its own wrapper would fail even while still rendering in the same corner.
it('carries both glyphs inside the one floating row, as a single object', async () => {
  stubDives({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const row = findFloatingRow(t);
  expect(row.queryAll((n) => n.props?.accessibilityLabel === 'Log a dive')).toHaveLength(1);
  expect(row.queryAll((n) => n.props?.accessibilityLabel === 'Search dives')).toHaveLength(1);
});

// **The row is persistent, and that is the owner's call rather than a regression.** §0.6's
// "Both recede as the list scrolls down and return on the way up" described a capsule that
// HELD a search field at the bottom; §3's note moves the trigger to a glyph and the field to
// its own screen, so search already costs a glyph rather than a strip, and the `+` beside it
// is this screen's primary action. Four wiring tests for the old behaviour were removed with
// this one written in their place, so "it no longer hides" is asserted rather than merely
// left untested — `useHideOnScroll` and its own unit tests are untouched and still green.
it('leaves the capsule in place as the list scrolls, rather than receding', async () => {
  stubDives({
    dives: Array.from({ length: 12 }, (_, i) => dive({ id: `d${i}`, date: `2026-08-${10 + i}`, siteName: `Site ${i}` })),
    numbers: new Map(),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const before = [findFloatingRow(t).props.style].flat(5).filter(Boolean);

  await fireEvent.scroll(findScrollable(t), { nativeEvent: { contentOffset: { y: 400 } } });

  const after = [findFloatingRow(t).props.style].flat(5).filter(Boolean);
  expect(after).toEqual(before);
  expect(findFloatingRow(t).props.pointerEvents).toBeUndefined();
  // The glyphs are still reachable, which is the thing a receding row took away.
  expect(findSearchToggle(t)).toBeTruthy();
  expect(findLogDive(t)).toBeTruthy();
});

// DESIGN.md §0.6 gave the "+" and the search capsule the same shadow so the two floating
// pieces could not drift apart; §3's note makes them one capsule and a field beside it, and
// the requirement survives the move — checked against the ACTUAL shared value styles.ts
// gives the search capsule (via makeStyles, not a number retyped into this test), so a
// capsule carrying some other, merely-similar-looking shadow would fail this even though
// "> 0" alone would have missed it.
it('gives the action capsule the exact same shadow treatment as the search capsule beside it', async () => {
  const styles = makeStyles('dark');
  const searchShadow = (styles.searchCapsulePlain as Record<string, unknown>).shadowOpacity;
  const actionShadow = (styles.actionCapsulePlain as Record<string, unknown>).shadowOpacity;
  expect(typeof searchShadow).toBe('number');
  expect(searchShadow).toBeGreaterThan(0);
  expect(actionShadow).toBe(searchShadow);
});

// §0.5's 48 dp tap-target floor. It mattered more, not less, once the "+" gave up its 60 dp
// circle for a glyph in a shared capsule — the whole cost §3 accepts is that the "+" "stops
// being big", and getting smaller than a thumb is not part of that bargain. Both glyphs are
// checked, since they are the same object and a regression would hit either.
it('keeps both capsule glyphs at a 48 dp touch target', async () => {
  stubDives({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  for (const node of [findLogDive(t), findSearchToggle(t)]) {
    const style = [node.props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
    const widthOf = style.reduce((acc: number, s) => (typeof s.width === 'number' ? s.width : acc), 0);
    const heightOf = style.reduce((acc: number, s) => (typeof s.height === 'number' ? s.height : acc), 0);
    expect(widthOf).toBeGreaterThanOrEqual(48);
    expect(heightOf).toBeGreaterThanOrEqual(48);
  }
});

// M1c task 2, DESIGN.md §0.6's "Trip header" row: Archivo SemiBold 11.5, uppercase,
// +0.13 em tracked, muted — set apart from diveSite (16px sans-medium, full ink)
// beneath it by every one of size/case/tracking/colour at once, where before both
// were roughly body-sized and bolded and read as the same visual class. Matched
// against BOTH 'BLUE HOLE' and 'Blue Hole' on purpose: RN's `textTransform:
// 'uppercase'` is a paint-time transform of a Text node, not a rewrite of its actual
// string content, so which one this renderer reports for `n.children[0]` is an
// implementation detail this test has no business pinning down.
it('sets trip headers apart from row text rather than merely bolding them', async () => {
  stubDives({
    dives: [dive({ date: '2026-08-16', siteName: 'Blue Hole', maxDepthM: 32.4 })],
    numbers: new Map(),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const header = textNodesOf(t).find(
    (n) => String(n.children[0] ?? '') === 'BLUE HOLE' || String(n.children[0] ?? '') === 'Blue Hole',
  );
  const style = [header?.props.style].flat(3).filter(Boolean);
  expect(style.some((s) => s?.textTransform === 'uppercase')).toBe(true);
  expect(style.some((s) => (s?.letterSpacing ?? 0) >= 1)).toBe(true);
});

// DESIGN.md §2.5's UI-facing half: hand-ordering is offered only where it can
// actually change something, and a reorder that cannot take effect must say
// so rather than silently spring back. domain/trips.test.ts and
// ReorderControls.test.tsx already cover canReorder/moveDown/applyReorder in
// isolation; these exercise the real wiring end to end.
//
// M1c task 6, DESIGN.md §0.6: hand-ordering now sits behind a DayStrip toggle rather
// than showing arrows unconditionally — every test below that needs arrows presses
// "Reorder" first, the same way a diver would.

// The task brief's own required test: in the resting state (before the strip is
// switched on) the day shows its "Reorder" strip, but the depth value still occupies
// its normal slot in each row — no arrows yet. This is the one assertion that actually
// proves the fix: an implementation that never removed the old, always-on arrows would
// fail the "no arrows" half, and one that hid the depth value for every reorderable day
// (active or not) would fail the "12.2 still visible" half.
it('shows no arrows until the day strip is switched on', async () => {
  const a = dive({ date: '2026-08-18', siteName: 'Blue Hole', maxDepthM: 12.2 });
  const b = dive({ date: '2026-08-18', siteName: 'Blue Hole', maxDepthM: 9.2 });
  stubDives({ dives: [a, b], numbers: new Map(), error: undefined });
  const t = await render(<DivesScreen />);
  const text = textIn(t).join(' ');
  expect(text).toContain('Reorder');
  expect(text).toContain('12.2'); // depth still visible in the resting state
  expect(findAllMoveButtons(t, 'up')).toHaveLength(0);
  expect(findAllMoveButtons(t, 'down')).toHaveLength(0);
});

// §0.6's hairline rule (theme/styles.ts) puts every row's separator on its TOP edge, so it
// reads as the line under whatever precedes that row — normally a TripHeader, but
// `toListEntries` (this file's own top docblock) puts a DayStrip in between for a
// qualifying day, so the seam that actually matters here is "TripHeader -> DayStrip ->
// first row", not the plainer "TripHeader -> first row" every other trip gets. Three things
// could go wrong at that seam and none would be caught by DayStrip.test.tsx or
// DiveRow.test.tsx alone, since each renders its component in isolation with nothing above
// it. This composed screen is where they meet.
//
// M1d correction: the strip used to be asserted to carry NO border at all, which is what
// left a trip whose first entry is a strip with its header sitting flush against it and a
// rule only below the strip (reported on the running app). A TOP border is not the doubled
// line that assertion was guarding against — the strip's top edge is the header/strip seam,
// while the first row's own top edge is the strip/row seam, two different places. A BOTTOM
// border on the strip is what would double, landing immediately beside the row's own top
// hairline, so that half of the assertion stays exactly as it was.
it('rules the day strip on its top edge only, so its boundary with the first row it governs is a single line', async () => {
  const a = dive({ date: '2026-08-18', siteName: 'Blue Hole', maxDepthM: 12.2 });
  const b = dive({ date: '2026-08-18', siteName: 'Blue Hole', maxDepthM: 9.2 });
  stubDives({ dives: [a, b], numbers: new Map(), error: undefined });
  const t = await render(<DivesScreen />);
  if (!t.root) throw new Error('DivesScreen did not render a root element');
  // DivesScreen resolves its own scheme via useColorScheme(), which is 'light' under Jest.
  const styles = makeStyles('light');

  const strips = t.root.queryAll((n) => [n.props?.style].flat(3).filter(Boolean).includes(styles.dayStrip));
  expect(strips).toHaveLength(1);
  const [strip] = strips;
  if (!strip) throw new Error('expected a DayStrip node');
  const stripStyle = [strip.props.style].flat(3).filter(Boolean);
  expect(
    stripStyle.some(
      (s: any) => s?.borderTopWidth > 0 && s?.borderTopColor === themeFor('light').border,
    ),
  ).toBe(true);
  expect(stripStyle.some((s: any) => typeof s?.borderBottomWidth === 'number' && s.borderBottomWidth > 0)).toBe(false);
  // M1c closing fixes, Important #6: the bottom-edge check above would stay false for a
  // border applied via the `borderWidth` SHORTHAND instead — RN honours it exactly like
  // `borderTopWidth`/`borderBottomWidth` set individually, so a strip styled with
  // `borderWidth: 1` would slip through having grown the exact doubled line this half of
  // the test exists to catch.
  expect(stripStyle.some((s: any) => typeof s?.borderWidth === 'number' && s.borderWidth > 0)).toBe(false);

  const rows = t.root.queryAll((n) => n.props?.style === styles.diveRow);
  expect(rows).toHaveLength(2); // both of the strip's own dives, no reorder mode engaged
  for (const row of rows) {
    expect(row.props.style.borderTopWidth).toBeGreaterThan(0);
    expect(row.props.style.borderTopColor).toBe(themeFor('light').border);
  }
});

// The distinguishing pair the task brief specifically calls for: a qualifying day and a
// non-qualifying day in the SAME trip, so a strip that rendered for every day
// (including timed ones) — not just the one canReorder actually allows — would be
// caught rather than coincidentally passing. Mirrors DESIGN.md §0.6's own example
// ("Blue Hole, 16–18 Aug is three days and only the 18th qualifies") one day short.
it('gates the day strip itself on canReorder — a day with entry times gets none, a day without one does', async () => {
  const timedA = dive({ id: 't1', date: '2026-08-16', siteName: 'Reef', timeIn: '09:00' });
  const timedB = dive({ id: 't2', date: '2026-08-16', siteName: 'Reef', timeIn: '14:00' });
  const untimedA = dive({ id: 'u1', date: '2026-08-17', siteName: 'Reef', maxDepthM: 12.2 });
  const untimedB = dive({ id: 'u2', date: '2026-08-17', siteName: 'Reef', maxDepthM: 9.2 });
  // Newest-first, matching useDives()'s own order (this file's top docblock note) — the
  // 17th (untimed) is more recent than the 16th (timed).
  stubDives({ dives: [untimedB, untimedA, timedB, timedA], numbers: new Map(), error: undefined });

  const t = await render(<DivesScreen />);
  expect(findDayStripAction(t, 'Reorder')).toHaveLength(1); // only the 17th qualifies
  const text = textIn(t).join(' ');
  expect(text).toContain('17 Aug 2026');
  expect(text).toContain('no times');
});

it('offers move controls for an untimed same-day pair, once its strip is switched on, and asks reorderDivesForDate for the chronological order', async () => {
  // Same siteName on both — groupIntoTrips groups by place first, so two
  // dives with DIFFERENT names would land in two separate one-dive trips and
  // never even reach sameDateGroups/canReorder, passing this test (or the
  // "does not offer" one below) for the wrong reason.
  const x = dive({ id: 'x', date: '2026-08-16', siteName: 'Blue Hole' });
  const y = dive({ id: 'y', date: '2026-08-16', siteName: 'Blue Hole' });
  stubDives({
    dives: [x, y],
    numbers: new Map([
      ['x', 2],
      ['y', 1],
    ]),
    error: undefined,
  });
  mockReorderDivesForDate.mockResolvedValue({ applied: true, effectiveOrder: ['y', 'x'], overriddenIds: [] });

  const t = await render(<DivesScreen />);
  const [toggle] = findDayStripAction(t, 'Reorder');
  if (!toggle) throw new Error('expected a Reorder strip for the untimed pair');
  await fireEvent.press(toggle);

  const [firstDown] = findAllMoveButtons(t, 'down');
  if (!firstDown) throw new Error('expected a move-down control once the strip is active');
  await fireEvent.press(firstDown);

  // display order [x,y] -> swap(0,1) -> [y,x] -> chronological (reversed) -> [x,y]
  await waitFor(() => {
    expect(mockReorderDivesForDate).toHaveBeenCalledWith(expect.anything(), '2026-08-16', ['x', 'y']);
  });
});

// S1, the screen's own half: a planned dive sharing the date. `splitPlanned` has already
// lifted it into "Up next" by the time this group is built, so the ids this screen can hand
// `reorderDivesForDate` are the day's LOGGED dives and nothing else — which is why the
// repository's completeness check had to be scoped to those (db/dives.ts). Found on a
// device: two untimed logged dives plus one plan on the same day could not be reordered at
// all, and the diver got "Couldn't reorder that day".
it('hand-orders a day that also holds a planned dive, naming only the logged ones', async () => {
  stubDives({
    dives: [
      dive({ id: 'p', date: '2026-08-16', status: 'planned', siteName: 'Blue Hole' }),
      dive({ id: 'x', date: '2026-08-16', siteName: 'Blue Hole' }),
      dive({ id: 'y', date: '2026-08-16', siteName: 'Blue Hole' }),
    ],
    numbers: new Map([
      ['x', 2],
      ['y', 1],
    ]),
    error: undefined,
  });
  mockReorderDivesForDate.mockResolvedValue({ applied: true, effectiveOrder: ['y', 'x'], overriddenIds: [] });

  const t = await render(<DivesScreen />);
  // The strip still appears, and it counts the LOGGED dives — "2 dives, no times". A strip
  // that counted the plan would both say the wrong number and describe a day this screen
  // cannot actually produce an order for.
  const [toggle] = findDayStripAction(t, 'Reorder');
  if (!toggle) throw new Error('expected a Reorder strip for the untimed pair');
  expect(textIn(t).join(' ')).toContain('2 dives');
  await fireEvent.press(toggle);

  const [firstDown] = findAllMoveButtons(t, 'down');
  if (!firstDown) throw new Error('expected a move-down control once the strip is active');
  await fireEvent.press(firstDown);

  // Two ids, and the planned dive's is not one of them — the whole point, and what the
  // repository has to accept.
  await waitFor(() => {
    expect(mockReorderDivesForDate).toHaveBeenCalledWith(expect.anything(), '2026-08-16', ['x', 'y']);
  });
  expect(textIn(t).join(' ').toLowerCase()).not.toContain("couldn't reorder");
});

it('does not offer move controls — or a day strip at all — for a same-day pair that already has entry times', async () => {
  // Same siteName on both, for the same reason noted in the test above —
  // otherwise this would pass because groupIntoTrips split them apart, not
  // because canReorder's timeIn check actually fired.
  stubDives({
    dives: [
      dive({ id: 'x', date: '2026-08-16', timeIn: '09:00', siteName: 'Blue Hole' }),
      dive({ id: 'y', date: '2026-08-16', timeIn: '14:00', siteName: 'Blue Hole' }),
    ],
    numbers: new Map([
      ['x', 1],
      ['y', 2],
    ]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  expect(findAllMoveButtons(t, 'down')).toHaveLength(0);
  expect(findAllMoveButtons(t, 'up')).toHaveLength(0);
  // canReorder gates the STRIP itself, not just the arrows (toListEntries.tsx's own
  // docblock) — a control that could never actually reorder this day would be a control
  // that lies.
  expect(findDayStripAction(t, 'Reorder')).toHaveLength(0);
  expect(textIn(t).join(' ')).not.toContain('Reorder');
});

// The exact failure this task's brief names: canReorder is meant to make
// applied:false unreachable from here, but a diver must never see a reorder
// silently spring back with no explanation if that gate is ever wrong.
it('shows a message rather than silently springing back when a reorder does not take effect', async () => {
  const x = dive({ id: 'x', date: '2026-08-16', siteName: 'Blue Hole' });
  const y = dive({ id: 'y', date: '2026-08-16', siteName: 'Blue Hole' });
  stubDives({
    dives: [x, y],
    numbers: new Map([
      ['x', 2],
      ['y', 1],
    ]),
    error: undefined,
  });
  mockReorderDivesForDate.mockResolvedValue({ applied: false, effectiveOrder: ['y', 'x'], overriddenIds: ['x'] });

  const t = await render(<DivesScreen />);
  const [toggle] = findDayStripAction(t, 'Reorder');
  if (!toggle) throw new Error('expected a Reorder strip for the untimed pair');
  await fireEvent.press(toggle);

  const [firstDown] = findAllMoveButtons(t, 'down');
  if (!firstDown) throw new Error('expected a move-down control');
  await fireEvent.press(firstDown);

  await waitFor(() => {
    expect(textIn(t).join(' ').toLowerCase()).toContain("couldn't reorder");
  });
});

// This task's review, Important finding: firing two overlapping
// reorderDivesForDate calls for the SAME day lets an earlier tap's promise
// resolve `applied: true` (so no error shows) after a later overlapping
// write has already landed and silently overridden it — a control reporting
// success for an effect that was actually discarded.
//
// The actual guarantee — that two calls issued back to back, before either
// settles, collapse to one write — is proven precisely and deterministically
// against `createReorderGate` itself, with full control over timing via a
// manually-resolvable promise: see ReorderControls.test.tsx's
// `describe('createReorderGate', ...)`. Reproducing that same "fired
// without awaiting either" shape (db/dives.test.ts's own pattern) through
// two genuinely overlapping `fireEvent.press` calls at this level was tried
// first and abandoned: React logs "overlapping act() calls, this is not
// supported" for that and can leave its internal act-tracking in a state
// that bleeds into whichever test runs next in the file. What this level
// still has to prove instead is the WIRING: a diver who presses a control,
// sees it go disabled, and (whether by intent or by a press landing just
// before the disabled state renders) presses it again gets exactly one
// write — and that a DIFFERENT day's gate is untouched throughout.
//
// M1c task 6 changed how that second half has to be shown: only one day can be
// "active" (showing arrows) at a time now (DivesScreen.tsx's single
// `activeReorderDate`), so this switches to Shark Reef's OWN strip midway through,
// while Blue Hole's write is still in flight, rather than expecting both days' arrows
// on screen at once the way the pre-task version of this test did.
it('does not fire a second reorder write for a day whose controls are already disabled by an in-flight one, lets a different day start its own write in the meantime, and recovers once the first settles', async () => {
  const x = dive({ id: 'x', date: '2026-08-16', siteName: 'Blue Hole' });
  const y = dive({ id: 'y', date: '2026-08-16', siteName: 'Blue Hole' });
  const p = dive({ id: 'p', date: '2026-08-10', siteName: 'Shark Reef' });
  const q = dive({ id: 'q', date: '2026-08-10', siteName: 'Shark Reef' });
  stubDives({
    dives: [x, y, p, q],
    numbers: new Map([
      ['x', 4],
      ['y', 3],
      ['p', 2],
      ['q', 1],
    ]),
    error: undefined,
  });
  let resolveBlueHole: ((outcome: ReorderOutcome) => void) | undefined;
  mockReorderDivesForDate
    .mockReturnValueOnce(
      new Promise<ReorderOutcome>((resolve) => {
        resolveBlueHole = resolve;
      }),
    )
    .mockResolvedValueOnce({ applied: true, effectiveOrder: ['p', 'q'], overriddenIds: [] });

  const t = await render(<DivesScreen />);
  // Blue Hole's strip renders first, then Shark Reef's (groupIntoTrips preserves the
  // input's own order).
  const [blueHoleReorder] = findDayStripAction(t, 'Reorder');
  if (!blueHoleReorder) throw new Error('expected a Reorder strip for Blue Hole');
  await pressToggleAndSettle(blueHoleReorder);

  const [xDown] = findAllMoveButtons(t, 'down');
  if (!xDown) throw new Error('expected a move-down control for Blue Hole');
  fireEvent.press(xDown); // deliberately not awaited: the write is left in flight until resolved below
  await waitFor(() => {
    expect(findAllMoveButtons(t, 'down')[0]?.props.accessibilityState?.disabled).toBe(true);
  });

  // A repeat press on the now-disabled control must not reach
  // reorderDivesForDate a second time.
  await fireEvent.press(findAllMoveButtons(t, 'down')[0]!);
  expect(mockReorderDivesForDate).toHaveBeenCalledTimes(1);

  // Switch to Shark Reef WHILE Blue Hole's write is still in flight — createReorderGate
  // is scoped per date, so a different day's controls must still be fully live, not
  // blocked by Blue Hole's own in-flight write.
  const [sharkReefReorder] = findDayStripAction(t, 'Reorder'); // Blue Hole's own now reads "Done"
  if (!sharkReefReorder) throw new Error('expected a Reorder strip for Shark Reef');
  await pressToggleAndSettle(sharkReefReorder);
  const [pDown] = findAllMoveButtons(t, 'down');
  if (!pDown) throw new Error('expected a move-down control for Shark Reef');
  expect(pDown.props.accessibilityState?.disabled).toBe(false);
  await fireEvent.press(pDown);
  await waitFor(() => {
    expect(mockReorderDivesForDate).toHaveBeenCalledTimes(2);
    expect(mockReorderDivesForDate).toHaveBeenNthCalledWith(2, expect.anything(), '2026-08-10', expect.anything());
  });

  // Resolve Blue Hole's original write and switch back to see it recover.
  resolveBlueHole?.({ applied: true, effectiveOrder: ['y', 'x'], overriddenIds: [] });
  const [blueHoleReorderAgain] = findDayStripAction(t, 'Reorder'); // Shark Reef now reads "Done"
  if (!blueHoleReorderAgain) throw new Error('expected Blue Hole to offer Reorder again');
  await pressToggleAndSettle(blueHoleReorderAgain);
  await waitFor(() => {
    expect(findAllMoveButtons(t, 'down')[0]?.props.accessibilityState?.disabled).toBe(false);
  });
});

// "Make sure the guard releases on failure as well as success" — a rejected
// write must not leave that day stuck disabled forever.
it('releases the in-flight guard after a failed write, so a later reorder for the same day still runs', async () => {
  const x = dive({ id: 'x', date: '2026-08-16', siteName: 'Blue Hole' });
  const y = dive({ id: 'y', date: '2026-08-16', siteName: 'Blue Hole' });
  stubDives({
    dives: [x, y],
    numbers: new Map([
      ['x', 2],
      ['y', 1],
    ]),
    error: undefined,
  });
  mockReorderDivesForDate.mockRejectedValueOnce(new Error('db unavailable'));
  mockReorderDivesForDate.mockResolvedValueOnce({ applied: true, effectiveOrder: ['x', 'y'], overriddenIds: [] });

  const t = await render(<DivesScreen />);
  const [toggle] = findDayStripAction(t, 'Reorder');
  if (!toggle) throw new Error('expected a Reorder strip for the untimed pair');
  await fireEvent.press(toggle);

  const [firstDown] = findAllMoveButtons(t, 'down');
  if (!firstDown) throw new Error('expected a move-down control');

  await fireEvent.press(firstDown); // the first attempt rejects
  await waitFor(() => {
    expect(mockReorderDivesForDate).toHaveBeenCalledTimes(1);
  });
  // Not stuck disabled behind the failed attempt.
  await waitFor(() => {
    expect(findAllMoveButtons(t, 'down')[0]?.props.accessibilityState?.disabled).toBe(false);
  });

  await fireEvent.press(firstDown); // a later press for the same day must not be stuck behind it
  await waitFor(() => {
    expect(mockReorderDivesForDate).toHaveBeenCalledTimes(2);
  });
});

// §0.6: "Entering the mode dims the rest ... so row heights do not change." Opacity,
// not a layout change — proven directly below via ReorderControls.test.tsx/DiveRow's
// own container-style tests; this is the DivesScreen-level wiring: dimming turns on
// with the strip and off again once the diver is done.
it('dims every other row to 32% opacity once a day is active, and restores full opacity once it is done', async () => {
  const x = dive({ id: 'x', date: '2026-08-16', siteName: 'Blue Hole' });
  const y = dive({ id: 'y', date: '2026-08-16', siteName: 'Blue Hole' });
  const other = dive({ id: 'o', date: '2026-08-10', siteName: 'Shark Reef' });
  stubDives({
    dives: [x, y, other],
    numbers: new Map([
      ['x', 3],
      ['y', 2],
      ['o', 1],
    ]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  expect(dimmedNodes(t)).toHaveLength(0); // nothing dimmed before any day is active

  const [blueHoleReorder] = findDayStripAction(t, 'Reorder');
  if (!blueHoleReorder) throw new Error('expected a Reorder strip for Blue Hole');
  await fireEvent.press(blueHoleReorder);
  // Exactly the one row outside the active day — Shark Reef's single, unrelated dive —
  // dims; Blue Hole's own two rows (now showing arrows) do not.
  expect(dimmedNodes(t)).toHaveLength(1);

  const [blueHoleDone] = findDayStripAction(t, 'Done');
  if (!blueHoleDone) throw new Error('expected Blue Hole to read Done once active');
  await fireEvent.press(blueHoleDone);
  expect(dimmedNodes(t)).toHaveLength(0); // restored once the mode is off
});

// M1b Task 9: the tablet layout (DESIGN.md §3, useWideLayout.ts's own boundary tests cover
// the threshold itself — these four are about the WIRING: what a tap on a row does, and
// what the detail pane shows, on each side of `wide`). All four stub useWideLayout()
// directly rather than a real window width, the same way every other external read in this
// file is stubbed at its own hook.

// I4: the `+` pushes an ABSOLUTE, typed-route-checked href. Pinned here as well as by the
// type checker, because the two catch different regressions: `tsc` catches the route file
// being renamed, this catches the `+` being wired to some other destination entirely.
it('opens the new-dive route from the "+"', async () => {
  stubDives({ dives: [dive({ id: 'a', siteName: 'Blue Hole' })], numbers: new Map([['a', 1]]), error: undefined });
  const t = await render(<DivesScreen />);
  await fireEvent.press(findLogDive(t));
  expect(mockRouterPush).toHaveBeenCalledWith('/dive/new');
});

it('navigates to the dive detail route on a narrow layout, without embedding it inline', async () => {
  mockUseWideLayout.mockReturnValue(false);
  stubDives({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  await fireEvent.press(findRow(t, 1));
  expect(mockRouterPush).toHaveBeenCalledWith('/dive/a');
  // DiveDetailScreen is never embedded on a narrow layout — "Date & time" is one of its own
  // cluster titles (DiveDetailScreen.tsx), never something DivesScreen renders itself.
  expect(textIn(t).join(' ')).not.toContain('Date & time');
});

it('shows the selected dive beside the list instead of navigating, on a wide layout', async () => {
  mockUseWideLayout.mockReturnValue(true);
  mockUseLocalSearchParams.mockReturnValue({}); // DiveDetailScreen calls this unconditionally; the id prop overrides it either way
  stubDives({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  await fireEvent.press(findRow(t, 1));
  expect(mockRouterPush).not.toHaveBeenCalled();
  expect(textIn(t).join(' ')).toContain('Date & time'); // DiveDetailScreen's own cluster title
});

it('shows a placeholder in the detail pane until a dive is selected, on a wide layout', async () => {
  mockUseWideLayout.mockReturnValue(true);
  mockUseLocalSearchParams.mockReturnValue({});
  stubDives({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  expect(textIn(t).join(' ').toLowerCase()).toContain('select a dive');
});

// DiveDetailScreen.test.tsx already pins showBackButton's own effect in isolation; this is
// the wiring proof that DivesScreen actually passes false for its embedded instance, not
// just that the prop works when someone remembers to pass it.
it("does not render the detail screen's own back control when embedded beside the list", async () => {
  mockUseWideLayout.mockReturnValue(true);
  mockUseLocalSearchParams.mockReturnValue({});
  stubDives({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  await fireEvent.press(findRow(t, 1));
  const backButtons = t.root ? t.root.queryAll((n) => n.props.accessibilityLabel === 'Back to dives') : [];
  expect(backButtons).toHaveLength(0);
  // ...and the dive's own action is still there. `EditButton` sits OUTSIDE the
  // `showBackButton` guard in DiveDetailScreen.tsx, which nothing checked: pulled inside it,
  // a tablet would have no way to edit a dive at all, and the assertion above would still
  // pass. Editing the dive on screen is exactly as valid beside the list as on top of it.
  expect(findControl(t, 'Edit')).toBeDefined();
});

// §2.4's other wide-layout wiring, and the one this screen owns rather than DiveDetailScreen:
// `onDeleted={() => setSelectedId(null)}`. Deleting from the pane must not navigate — the
// list is already on screen, and `router.back()` would leave the Dives screen entirely — and
// it must not do nothing either, or the pane sits on "Dive not found." for a dive that was
// just correctly removed. DiveDetailScreen.test.tsx pins that the prop works when passed;
// this is the proof that this screen actually passes it.
it('clears the tablet detail pane when the dive in it is deleted, rather than stranding it', async () => {
  mockUseWideLayout.mockReturnValue(true);
  mockUseLocalSearchParams.mockReturnValue({});
  mockSoftDelete.mockResolvedValue(undefined);
  const doomed = dive({ id: 'a', siteName: 'Blue Hole', date: '2026-08-16' });
  const survivor = dive({ id: 'b', siteName: 'Shark Reef', date: '2026-08-15' });
  stubDives({ dives: [doomed, survivor], numbers: new Map([['a', 2], ['b', 1]]), error: undefined });
  const t = await render(<DivesScreen />);
  await fireEvent.press(findRow(t, 2));
  expect(textIn(t).join(' ')).toContain('Date & time'); // the pane really is showing the dive

  const del = findControl(t, 'Delete dive');
  if (!del) throw new Error('the embedded detail pane offered no Delete dive control');
  await fireEvent.press(del);
  const destructive = (alertSpy.mock.calls[0]?.[2] as { style?: string; onPress?: () => void }[] | undefined)?.find(
    (b) => b.style === 'destructive',
  );
  if (!destructive) throw new Error('the confirmation offered no destructive button');
  await act(async () => {
    destructive.onPress?.();
  });

  // The live query catches up, which is the half a stubbed hook will not do by itself: the
  // tombstoned dive is gone from `useDives()`'s own list. Without this the pane would still
  // find the dive and the defect would be invisible — it is the dive DISAPPEARING under a
  // stale selection that puts "Dive not found." on a tablet.
  stubDives({ dives: [survivor], numbers: new Map([['b', 1]]), error: undefined });
  await t.rerender(<DivesScreen />);

  expect(textIn(t).join(' ')).toContain('Select a dive');
  expect(textIn(t).join(' ')).not.toContain('Dive not found');
  // Nothing navigated: the default `onDeleted` is `backToDives`, which would pop the stack
  // (or replace to '/') and take the diver off the list they are looking at.
  expect(mockRouterBack).not.toHaveBeenCalled();
  expect(mockRouterReplace).not.toHaveBeenCalled();
});

// --- M1d task 7: §2.4's *Complete dive*, on an "Up next" row ---
//
// "After surfacing, Complete dive asks only for the missing numbers." It is the one action
// a planned dive has and a logged one does not, and it opens the same `/dive/[id]/edit`
// form the detail screen's Edit control does — with the form's Logged/Planned control
// already flipped to Logged, which is the whole difference between the two links. This
// list still writes nothing itself: a dive's status changes in one place, the form's own
// control (DESIGN.md §10), and this only decides what that control opens on.

/** One control by its exact accessibilityLabel — `undefined` when the screen renders none,
 * which the logged-row test below asserts directly. */
function findControl(t: RenderResult, label: string) {
  return (t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === label) : [])[0];
}

it('offers Complete dive on an "Up next" row, and opens that dive\'s own form', async () => {
  stubDives({
    dives: [
      dive({ id: 'p', date: '2026-09-01', status: 'planned', siteName: 'Silfra' }),
      dive({ id: 'l', date: '2026-08-16', siteName: 'Blue Hole' }),
    ],
    numbers: new Map([['l', 12]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);

  // Named after the dive it belongs to, so a queue of planned dives does not announce as a
  // column of identical "Complete dive" buttons.
  const complete = findControl(t, 'Complete dive: Silfra');
  if (!complete) throw new Error('DivesScreen offered no Complete dive control');
  await fireEvent.press(complete);
  expect(mockRouterPush).toHaveBeenCalledWith(completeDiveHref('p'));
  // Nothing was written on the way. The pill is navigation, not a second path that changes
  // a status behind the diver's back — that decision belongs to the form's own control, and
  // to the save the diver then presses. `reorderDivesForDate` is this screen's ONLY write,
  // so an untouched mock is the whole of "this list wrote nothing".
  expect(mockReorderDivesForDate).not.toHaveBeenCalled();
});

it("opens that form with the status control on Logged, so the pill's label stays true", async () => {
  stubDives({
    dives: [dive({ id: 'p', date: '2026-09-01', status: 'planned', siteName: 'Silfra' })],
    numbers: new Map(),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const complete = findControl(t, 'Complete dive: Silfra');
  if (!complete) throw new Error('DivesScreen offered no Complete dive control');
  await fireEvent.press(complete);

  // The one param that separates this from a plain edit — and the whole reason the pill
  // still completes anything. The form no longer logs a planned dive just because it was
  // handed one (that rule silently completed a dive whose site name a diver came back to
  // fix), so a pill sending the plain edit link would open the control on Planned and
  // complete nothing while saying it does. Read as the literal value the route will carry,
  // not re-derived from the same helper the screen calls.
  const href = mockRouterPush.mock.calls[0]?.[0] as { pathname?: string; params?: { id?: string; openAs?: string } };
  expect(href?.pathname).toBe('/dive/[id]/edit');
  expect(href?.params?.id).toBe('p');
  expect(href?.params?.openAs).toBe('logged');
});

// The pill's own name comes from `diveSiteLabel` (format/display.ts), whose site-over-centre
// precedence was pinned only in that module's own test. No fixture on this screen ever set
// both fields, so this call site accepted a centre-first inline copy — every planned dive
// booked through a shop would have announced as "Complete dive: Aqua", and a queue of them
// as a column of identical labels, which is precisely what naming the dive exists to prevent.
it('names the planned dive by its site, not by its centre, when it records both', async () => {
  stubDives({
    dives: [
      dive({ id: 'p1', date: '2026-09-01', status: 'planned', siteName: 'Silfra', centerName: 'Aqua' }),
      dive({ id: 'p2', date: '2026-09-02', status: 'planned', siteName: 'Kleifarvatn', centerName: 'Aqua' }),
    ],
    numbers: new Map(),
    error: undefined,
  });
  const t = await render(<DivesScreen />);

  expect(findControl(t, 'Complete dive: Silfra')).toBeDefined();
  expect(findControl(t, 'Complete dive: Kleifarvatn')).toBeDefined();
  expect(findControl(t, 'Complete dive: Aqua')).toBeUndefined();
});

it('offers no Complete dive on a logged row', async () => {
  stubDives({
    dives: [dive({ id: 'l', date: '2026-08-16', siteName: 'Blue Hole' })],
    numbers: new Map([['l', 12]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);

  // A logged dive is already dived; the control would either do nothing or silently
  // re-log it. Keyed on `status`, so this cannot be satisfied by "the first section only".
  expect(findControl(t, 'Complete dive: Blue Hole')).toBeUndefined();
  expect(textIn(t).join(' ')).not.toContain('Complete dive');
  // ...and the row itself still opens the dive, so the absence above is not the whole row
  // having gone missing.
  await fireEvent.press(findRow(t, 12));
  expect(mockRouterPush).toHaveBeenCalledWith('/dive/l');
});

// --- M1d: what a newly created planned dive actually looks like in the list ---
//
// §2.4's producer arrived last: until this milestone no diver could create a planned dive
// at all, so everything below was only ever exercised against seed data. The numbers here
// come from the real `assignDiveNumbers` rather than a hand-written Map — a stub would let
// this test agree with whatever the screen happened to render, which is the opposite of
// what it is for. §2.5's numbers are computed and never stored, so this is the whole of
// what "a planned dive is excluded from numbering" means in practice.

/** One row's announced label, by the site name in it — `DiveRow`'s own
 * `accessibilityLabel`, which leads with "Dive N" only when the dive has a number, and so
 * is the one place a row states whether it has one at all. */
function rowLabelFor(t: RenderResult, site: string): string {
  const row = (t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : []).find((n) =>
    String(n.props?.accessibilityLabel ?? '').includes(site),
  );
  if (!row) throw new Error(`DivesScreen rendered no row for ${site}`);
  return String(row.props?.accessibilityLabel ?? '');
}

it('puts a new plan in "Up next" with no number, leaving every logged dive numbered as before', async () => {
  const logged = [dive({ id: 'a', date: '2026-08-16', siteName: 'Blue Hole' }), dive({ id: 'b', date: '2026-08-17', siteName: 'Canyon' })];
  const before = assignDiveNumbers(logged, 0);
  expect([before.get('a'), before.get('b')]).toEqual([1, 2]);

  // The same logbook, plus one dive the diver just planned for next month.
  const withPlan = [dive({ id: 'p', date: '2026-09-05', status: 'planned', siteName: 'Silfra' }), ...logged];
  stubDives({ dives: withPlan, numbers: assignDiveNumbers(withPlan, 0), error: undefined });
  const t = await render(<DivesScreen />);
  const text = textIn(t).join(' ');

  // It landed in the queue, above the trips...
  expect(text).toContain('Up next');
  expect(text.indexOf('Up next')).toBeLessThan(text.indexOf('Blue Hole'));
  expect(text.indexOf('Silfra')).toBeLessThan(text.indexOf('Blue Hole'));
  // ...carrying no number of its own — a plan has none until it is completed (§2.4). Read
  // off the row's own announced label, which lists "Dive N" first when there is one, so
  // this is about THIS row rather than about a `#3` happening to be absent from the screen.
  expect(rowLabelFor(t, 'Silfra')).not.toContain('Dive ');
  expect(text).not.toContain('#3');
  // ...and it shifted nothing: the two logged dives are still #1 and #2, which is the half
  // that would fail if a planned dive were numbered and merely hidden from this section.
  expect(rowLabelFor(t, 'Blue Hole')).toContain('Dive 1');
  expect(rowLabelFor(t, 'Canyon')).toContain('Dive 2');
});

it('gives a completed plan its number back, and renumbers the dives above it', async () => {
  // The other end of the same journey: the diver surfaces, opens the plan through *Complete
  // dive*, moves the control to Logged and saves. Nothing migrates — the numbers are
  // recomputed from the rows, so the dive slots into its own date and the later dive moves
  // up. This is the list-level statement of what `diveNumber.test.ts` proves about the map.
  const planned = dive({ id: 'p', date: '2026-08-17', status: 'planned', siteName: 'Silfra' });
  const around = [dive({ id: 'later', date: '2026-08-18', siteName: 'Canyon' }), dive({ id: 'earlier', date: '2026-08-16', siteName: 'Blue Hole' })];

  const queued = [planned, ...around];
  stubDives({ dives: queued, numbers: assignDiveNumbers(queued, 0), error: undefined });
  const before = await render(<DivesScreen />);
  // Two logged dives, so the later one is #2 while the plan sits between them undated by
  // any number at all.
  expect(before.root ? before.root.queryAll((n) => n.type === 'Text' && n.children.includes('#2')) : []).toHaveLength(1);
  expect(textIn(before).join(' ')).toContain('Up next');

  const completed = [{ ...planned, status: 'logged' as const }, ...around];
  stubDives({ dives: completed, numbers: assignDiveNumbers(completed, 0), error: undefined });
  const after = await render(<DivesScreen />);
  const text = textIn(after).join(' ');

  // The queue is empty and gone, the completed dive took #2 by its own date, and the dive
  // that used to be #2 is now #3 — the renumbering §2.5 promises, for free.
  expect(text).not.toContain('Up next');
  expect(text).toContain('#3');
  expect(rowLabelFor(after, 'Blue Hole')).toContain('Dive 1');
  expect(rowLabelFor(after, 'Silfra')).toContain('Dive 2');
  expect(rowLabelFor(after, 'Canyon')).toContain('Dive 3');
});

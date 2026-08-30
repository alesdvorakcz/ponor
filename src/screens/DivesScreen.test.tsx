// The package's own official Jest mock (react-native-safe-area-context/jest/mock, its only
// export under `jest/`) — see the jest.mock call below for why this file needs it at all.
// Imported (not required) so this stays a normal ES import; named `mock...` because
// babel-plugin-jest-hoist only allows a jest.mock() factory to close over out-of-scope
// identifiers that start with `mock` (or `require`), and hoists every jest.mock() call
// above every import in this file regardless. Deliberately the FIRST import in the file,
// above even the `react-native-safe-area-context` import a few lines down: the hoisted
// jest.mock() call below runs its factory the first time anything requires
// 'react-native-safe-area-context', which is exactly what that later import does — if this
// one hadn't already run by then, the factory would close over `mockSafeAreaContext` before
// it was assigned. Confirmed directly, not assumed: with the two imports the other way
// round, the factory threw "Cannot read properties of undefined (reading 'default')" at
// that exact line.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { dive } from '../domain/diveFixture';
import { reorderDivesForDate, type ReorderOutcome } from '../db/dives';
import { useDives } from '../db/useDives';
import { useWideLayout } from '../hooks/useWideLayout';
import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import DivesScreen from './DivesScreen';

// M1c task 11: DivesScreen now calls useSafeAreaInsets() (react-native-safe-area-context)
// to clear the home indicator (DESIGN.md §0.6) — real usage gets a SafeAreaProvider for
// free from expo-router's own root layout (ExpoRoot.js wraps every screen in
// SafeAreaProviderCompat), but this file renders DivesScreen bare, with no such ancestor.
// mockSafeAreaContext (imported above) is the documented way around that: its
// useSafeAreaInsets() falls back to a zero-inset default when no Provider is present,
// rather than the real implementation's hard `throw` ("No safe area value available ..."),
// and its SafeAreaProvider accepts `initialMetrics` so the one test below that actually
// cares about a NON-zero inset can supply one.
jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

// Jest hoists jest.mock() calls above the imports above at transform time regardless of
// where it sits textually, so it can live here without an import/first violation.
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
// DivesScreen calls this one directly (via ReorderControls.tsx's applyReorder), unlike
// every read, which goes through the mocked useDives() above — mocked separately so a
// reorder test can control exactly what ReorderOutcome it resolves with, without a real
// database.
jest.mock('../db/dives', () => ({ reorderDivesForDate: jest.fn() }));
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

/** The screen's one TextInput — the search box. Throws rather than returning
 * undefined so a test that finds none fails at the query, not at a confusing
 * downstream fireEvent error. */
function findSearchInput(t: RenderResult) {
  const [input] = t.root ? t.root.queryAll((n) => n.type === 'TextInput') : [];
  if (!input) throw new Error('DivesScreen did not render a TextInput');
  return input;
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

/** M1c task 11, DESIGN.md §0.6: the floating bottom row — the search capsule AND the "+"
 * beside it, which now share one hide-on-scroll wrapper rather than each tracking its own
 * (renamed from findSearchFieldWrapper, back when this wrapped only the search TextInput
 * at the top of the screen) — located by the one prop only that wrapper sets
 * (`accessibilityElementsHidden`), so a test can read its hidden/visible state without
 * caring how many levels separate it from the search field or the fab. */
function findFloatingRow(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityElementsHidden !== undefined) : [];
  if (!node) throw new Error('DivesScreen did not render the floating row wrapper');
  return node;
}

/** The floating "+" (DivesScreen.tsx's `fab`) — matched by its own accessibilityLabel,
 * which EmptyState's differently-labelled primary action (rendered only on the
 * empty-logbook branch, never alongside this one) can never collide with. */
function findFab(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === 'Log a dive') : [];
  if (!node) throw new Error('DivesScreen did not render the "+"');
  return node;
}

/** Fires a scroll event and, like pressToggleAndSettle above, flushes inside act()
 * afterward. Crossing useHideOnScroll's threshold calls `LayoutAnimation.configureNext`
 * (useHideOnScroll.ts), which — per its own source
 * (Libraries/LayoutAnimation/LayoutAnimation.js) — always arms a real `setTimeout` racing
 * the native animation callback, regardless of whether a native layer is even listening.
 * The same risk pressToggleAndSettle's own comment describes applies here: a test that
 * fires another interaction, or simply ends, before that settles can log an act() warning
 * or leak into whichever test runs next. 300ms comfortably clears the configured 200ms
 * duration plus that race's own +17ms. Only needed for a scroll expected to actually
 * cross the threshold; a sub-threshold scroll never calls configureNext and is fired with
 * a plain `fireEvent.scroll` instead. */
async function scrollAndSettle(node: NonNullable<RenderResult['root']>, y: number) {
  await fireEvent.scroll(node, { nativeEvent: { contentOffset: { y } } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

/** A DiveRow, found by its own number badge ("#<n>") rather than its site name: a
 * single-site trip's TripHeader is titled after that same site name (domain/trips.ts's
 * `placeOf`), so matching on the name would find the header FIRST — and pressing it would
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
const mockReorderDivesForDate = reorderDivesForDate as jest.Mock;
const mockUseWideLayout = useWideLayout as jest.Mock;
const mockRouterPush = router.push as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as jest.Mock;

afterEach(() => {
  mockUseDives.mockReset();
  mockReorderDivesForDate.mockReset();
  mockUseWideLayout.mockReset();
  mockRouterPush.mockReset();
  mockUseLocalSearchParams.mockReset();
});

it('shows the empty state when there are no dives', async () => {
  mockUseDives.mockReturnValue({ dives: [], numbers: new Map(), error: undefined });
  const t = await render(<DivesScreen />);
  expect(textIn(t).join(' ')).toContain('Log your first dive');
});

// Review task 7, Important #4: EmptyState's primary action is the entire first-run
// experience, and a Pressable carries no accessibilityRole on its own — a screen reader
// user was never told this text was actionable. The empty-logbook branch renders nothing
// else (no fab, no search box — DivesScreen.tsx's early return), so any
// accessibilityRole="button" node found here is unambiguously EmptyState's own action.
it("announces the empty state's primary action as a button", async () => {
  mockUseDives.mockReturnValue({ dives: [], numbers: new Map(), error: undefined });
  const t = await render(<DivesScreen />);
  const buttons = t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : [];
  expect(buttons).toHaveLength(1);
});

it('pins planned dives above logged ones under "Up next"', async () => {
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({ dives: [], numbers: new Map(), error: new Error('disk') });
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
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({
    dives: [],
    numbers: new Map(),
    error: new Error('disk'),
    settingsError: new Error('settings unreadable'),
  });
  const text = textIn(await render(<DivesScreen />)).join(' ');
  expect(text.toLowerCase()).toContain("couldn't open your logbook");
  expect(text.toLowerCase()).not.toContain("couldn't read your settings");
});

// Not in the brief's sample, but the brief's own text calls this out as the third state a
// diver can hit: a non-empty logbook where the *search* matches nothing. That is not an
// empty logbook (must not show "Log your first dive") and it is not silence either (must
// say something) — distinct from both other states, so it gets its own coverage rather than
// resting on the assumption that the "no results" branch and the "empty logbook" branch
// can't be confused for each other.
it('tells a diver their search matched nothing, distinctly from an empty logbook', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  await fireEvent.changeText(findSearchInput(t), 'no such site anywhere');
  const text = textIn(t).join(' ');
  expect(text).not.toContain('Log your first dive');
  expect(text).not.toContain('Blue Hole');
  expect(text.toLowerCase()).toContain('no dives match');
});

// DESIGN.md §3 lists search as one of the Dives screen's jobs, and the M1b done-when
// checklist pins it explicitly ("searching narrows the list"). searchDives itself is
// unit-tested in domain/search.test.ts; what is unproven without this is that the screen
// actually wires the TextInput's value into it rather than, say, leaving it inert.
it('narrows the list to dives matching the search text', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' }), dive({ id: 'b', siteName: 'Shark Reef' })],
    numbers: new Map([
      ['a', 1],
      ['b', 2],
    ]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  await fireEvent.changeText(findSearchInput(t), 'Blue');
  const text = textIn(t).join(' ');
  expect(text).toContain('Blue Hole');
  expect(text).not.toContain('Shark Reef');
});

// M1c task 11, DESIGN.md §0.6 rev 5 supersedes the hairline border the M1c task 2 review
// comment above once restored: the search field is no longer a bordered box at the top of
// the screen at all, and the rule for the capsule it became is the opposite one —
// "no bar, no border, no top rule ... separated by a soft shadow, not a line." The test
// that used to pin the border's presence here (`git log` has it) is gone for that reason,
// not dropped by oversight; SearchCapsule.test.tsx's own "gives the fallback the identical
// measured shape as the glass version" test is what now pins "no border, has a shadow
// instead" for the capsule itself. What belongs at THIS (screen) level instead is what
// SearchCapsule itself has no way to know: where DivesScreen actually puts it.
//
// The task brief's own trap, named directly: "an assertion that the capsule renders would
// pass whether or not it is positioned at the bottom." Proven here by rendering with two
// DIFFERENT bottom safe-area insets and requiring the row's own `bottom` offset to move by
// exactly the difference between them — a hard-coded offset (or one read off `top` instead)
// would give the same wrong answer both times; only a genuine `insets.bottom + margin`
// computation can pass this for both.
it('floats the search row at the bottom of the screen, offset by the real safe-area inset rather than a fixed number', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const renderWithBottomInset = async (bottom: number) => {
    const t = await render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom } }}
      >
        <DivesScreen />
      </SafeAreaProvider>,
    );
    return [findFloatingRow(t).props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
  };
  const numberAt = (style: Record<string, unknown>[], key: string) =>
    style.reduce((acc: number | undefined, s) => (typeof s[key] === 'number' ? (s[key] as number) : acc), undefined);

  const zeroInsetStyle = await renderWithBottomInset(0);
  const homeIndicatorStyle = await renderWithBottomInset(34); // a real iPhone's own bottom inset

  expect(zeroInsetStyle.some((s) => s.position === 'absolute')).toBe(true);
  expect(zeroInsetStyle.some((s) => s.top !== undefined)).toBe(false); // bottom, not top

  const zeroBottom = numberAt(zeroInsetStyle, 'bottom');
  const homeIndicatorBottom = numberAt(homeIndicatorStyle, 'bottom');
  expect(zeroBottom).toBeGreaterThan(0); // still clear of the physical screen edge with no inset at all
  expect(homeIndicatorBottom).toBe(zeroBottom! + 34); // moves up by exactly the extra inset — not clamped, not ignored
});

// §0.6: "the + stays at the bottom too, as its own floating button beside the capsule" —
// sharing the capsule's own hide-on-scroll row rather than tracking a separate one of its
// own, so "Both recede as the list scrolls down and return on the way up" holds for both at
// once. Proven structurally, not just by both happening to report the same hidden value:
// the fab must be a genuine DESCENDANT of the exact node findFloatingRow reads
// accessibilityElementsHidden/pointerEvents off, not a sibling that merely mirrors it.
it('nests the + inside the same floating row as the search field, so both hide and reappear together', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const fabInRow = findFloatingRow(t).queryAll((n) => n.props?.accessibilityLabel === 'Log a dive');
  expect(fabInRow).toHaveLength(1);
});

// DESIGN.md §0.6: the "+" is "its own floating button beside the capsule ... sharing the
// same shadow" — checked here against the ACTUAL shared value styles.ts's `floatingShadow`
// gives the capsule (via makeStyles, not a number retyped into this test), so a fab that
// carried some other, merely-similar-looking shadow of its own would fail this even though
// ">  0" alone would have missed it.
it('gives the + the exact same shadow treatment as the search capsule beside it', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const fabStyle = [findFab(t).props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
  const capsuleShadowOpacity = (makeStyles('dark').searchCapsulePlain as Record<string, unknown>).shadowOpacity;
  expect(typeof capsuleShadowOpacity).toBe('number');
  expect(capsuleShadowOpacity).toBeGreaterThan(0);
  expect(fabStyle.some((s) => s.shadowOpacity === capsuleShadowOpacity)).toBe(true);
});

// §0.5's 48 dp tap-target floor, restated by the task brief for this row specifically:
// "so does the +." The search field's own floor is SearchCapsule.test.tsx's concern now;
// this is the one part of it DivesScreen.tsx itself still owns.
it('keeps the + at a 48 dp touch target, same floor as the search field beside it', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const fabStyle = [findFab(t).props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
  const widthOf = fabStyle.reduce((acc: number, s) => (typeof s.width === 'number' ? s.width : acc), 0);
  const heightOf = fabStyle.reduce((acc: number, s) => (typeof s.height === 'number' ? s.height : acc), 0);
  expect(widthOf).toBeGreaterThanOrEqual(48);
  expect(heightOf).toBeGreaterThanOrEqual(48);
});

// M1c task 8, DESIGN.md §0.6: "The search field yields to the list. It hides as the
// list scrolls down and returns on the way back up." nextScrollVisibility itself is
// unit-tested exhaustively, at exact threshold boundaries, in useHideOnScroll.test.ts;
// these four prove the WIRING into this screen — that a real scroll on the real
// SectionList actually drives the real field.
//
// The task brief's own trap, named directly: "an assertion that the field is present
// after scrolling up would also pass if the field never hid at all." The test below
// asserts HIDDEN first, as an explicit precondition the test would already fail at if
// hiding were broken, before ever asserting SHOWN again — so the second half can only
// pass by genuinely recovering from a real hidden state, not by the field having sat
// untouched the whole time.
it('hides the search field on a sustained downward scroll and shows it again on a sustained upward one', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const scrollable = findScrollable(t);

  await scrollAndSettle(scrollable, 100); // well past the 24px threshold, downward
  expect(findFloatingRow(t).props.accessibilityElementsHidden).toBe(true);
  expect(findFloatingRow(t).props.pointerEvents).toBe('none');

  await scrollAndSettle(scrollable, 50); // well past the threshold again, upward from 100
  expect(findFloatingRow(t).props.accessibilityElementsHidden).toBe(false);
  expect(findFloatingRow(t).props.pointerEvents).toBe('auto');
});

// Brief's #1, "no jitter": pinned here too, not just in useHideOnScroll.test.ts, since
// this is what actually ships — a screen that wired the hook up with, say, its own
// lower threshold would pass every unit test in that file while still jittering here.
//
// The small scroll alone is not, on its own, a test that could fail for the reason it
// claims: the field starts visible, so "still visible after a small scroll" would pass
// even if onScroll were never wired to the SectionList at all (confirmed by deliberately
// disconnecting it and re-running — the earlier, single-assertion version of this test
// kept passing). The second scroll below closes that gap: it continues from the same
// tracked position to a total well past the threshold, so the field can only end up
// hidden there if the small scroll first actually reached the handler and was
// genuinely counted, not ignored by a broken/absent wiring.
it('does not hide the search field for a scroll well under the jitter threshold, but does hide it once a real scroll follows', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const scrollable = findScrollable(t);

  // No scrollAndSettle: a sub-threshold scroll never calls
  // LayoutAnimation.configureNext, so there is nothing to flush before asserting.
  await fireEvent.scroll(scrollable, { nativeEvent: { contentOffset: { y: 10 } } }); // well under the 24px threshold
  expect(findFloatingRow(t).props.accessibilityElementsHidden).toBe(false);
  expect(findFloatingRow(t).props.pointerEvents).toBe('auto');

  await scrollAndSettle(scrollable, 40); // +30 from here — past the threshold, so wiring is live
  expect(findFloatingRow(t).props.accessibilityElementsHidden).toBe(true);
});

// Brief's #2, "always reachable" — the one case the scroll accumulator alone cannot
// cover on its own: once a query narrows results to zero, DivesScreen swaps the
// SectionList out for a static message, so there is no list left to scroll back up on.
// useHideOnScroll.ts's own docblock has the full account of why (the keyboard does not
// blur on scroll, so a diver can keep narrowing their query while scrolled away). This
// proves useHideOnScroll's `forceVisible` argument is actually wired to `matching`
// here, not just implemented and unused: without it, this test's last two assertions
// would see the field still stranded hidden from the scroll above.
it('brings the search field back once a query narrows results to zero, even if it was hidden by scrolling', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  await scrollAndSettle(findScrollable(t), 100);
  expect(findFloatingRow(t).props.accessibilityElementsHidden).toBe(true); // hidden first — the precondition this test is actually about

  await fireEvent.changeText(findSearchInput(t), 'no such site anywhere');

  expect(textIn(t).join(' ').toLowerCase()).toContain('no dives match'); // the pre-existing zero-results state still fires
  expect(findFloatingRow(t).props.accessibilityElementsHidden).toBe(false); // ...and the field is reachable again, not stranded hidden
  expect(findFloatingRow(t).props.pointerEvents).toBe('auto');
});

// useHideOnScroll.ts's own docblock names the risk this covers: `forceVisible`
// resets the RENDERED `hidden`, but the tracked accumulator (a ref, deliberately not
// touched during render — see that docblock's account of what react-hooks/refs
// rejected) is only reset lazily, the next time onScroll actually runs, via a
// `pendingReset` flag. This proves that flag is actually consumed, not just set: a
// scroll fired against the freshly-reappeared list must judge distance from a genuinely
// clean baseline, not from wherever the OLD list's tracking was last left.
//
// A single scroll before the round trip is NOT enough to tell a clean reset from a
// stale one apart: nextScrollVisibility's `accum` and `lastY` both measure distance
// from the SAME start (0), so one continuous, never-reset run from the top always
// leaves accum === lastY — a bug that used the stale tracked state instead of a fresh
// one would compute the exact same result by coincidence (caught in the process of
// writing this test: an earlier version scrolled to 15 then straight to 35, and could
// not tell a reset from no reset at all). Crossing the threshold at least once first
// (40, then a further 50) is what actually decouples them: after that, accum (10) and
// lastY (50) diverge, so a follow-up scroll to 30 gives a genuinely different answer
// depending on which one onScroll measures from — 30 clears the 24px threshold from a
// clean (0, 0) baseline, but from the stale (50, 10) one nets only a 20px move (accum
// 10 + (30 - 50) = -10), leaving `hidden` exactly where the forced-visible reset left
// it: unrecomputed, and so still visible.
it('judges the first scroll after a narrow-to-zero-and-back round trip from a clean baseline, not the old list’s stale one', async () => {
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  const scrollable = findScrollable(t);

  await scrollAndSettle(scrollable, 40); // crosses the threshold once, so the tracked reference point is no longer 0
  expect(findFloatingRow(t).props.accessibilityElementsHidden).toBe(true);
  await fireEvent.scroll(scrollable, { nativeEvent: { contentOffset: { y: 50 } } }); // under the threshold from here; leaves accum (10) != lastY (50)

  await fireEvent.changeText(findSearchInput(t), 'no such site anywhere'); // narrows to zero...
  expect(textIn(t).join(' ').toLowerCase()).toContain('no dives match');
  expect(findFloatingRow(t).props.accessibilityElementsHidden).toBe(false); // forced visible — the RENDERED half of the reset, already proven above
  await fireEvent.changeText(findSearchInput(t), ''); // ...and back — a fresh SectionList remounts at the top
  expect(textIn(t).join(' ')).toContain('Blue Hole');

  // Re-found, not the same `scrollable` reference from above: the zero-results round
  // trip above unmounts the old SectionList and mounts a genuinely new one (the
  // ternary in DivesScreen.tsx's listPane), so the pre-round-trip node is now detached
  // — fireEvent silently no-ops on a detached instance (@testing-library/react-native's
  // own fire-event.js: `if (!isInstanceMounted(instance)) return;`), which would make
  // this assertion pass VACUOUSLY (the scroll simply never reaching onScroll at all)
  // rather than for the reason this test claims. Caught the same way as the
  // coincidental-numbers issue above: by first writing this test against the stale
  // reference, watching it fail even against the correct implementation, and tracing
  // why rather than adjusting the expectation to match.
  await scrollAndSettle(findScrollable(t), 30); // clears 24 from a clean baseline; from the stale one, nets only 20 and never recomputes hidden at all
  expect(findFloatingRow(t).props.accessibilityElementsHidden).toBe(true);
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
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({ dives: [a, b], numbers: new Map(), error: undefined });
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
  mockUseDives.mockReturnValue({ dives: [a, b], numbers: new Map(), error: undefined });
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
  mockUseDives.mockReturnValue({ dives: [untimedB, untimedA, timedB, timedA], numbers: new Map(), error: undefined });

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
  mockUseDives.mockReturnValue({
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

it('does not offer move controls — or a day strip at all — for a same-day pair that already has entry times', async () => {
  // Same siteName on both, for the same reason noted in the test above —
  // otherwise this would pass because groupIntoTrips split them apart, not
  // because canReorder's timeIn check actually fired.
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({
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

it('navigates to the dive detail route on a narrow layout, without embedding it inline', async () => {
  mockUseWideLayout.mockReturnValue(false);
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  await fireEvent.press(findRow(t, 1));
  expect(mockRouterPush).toHaveBeenCalledWith('./dive/a');
  // DiveDetailScreen is never embedded on a narrow layout — "Date & time" is one of its own
  // cluster titles (DiveDetailScreen.tsx), never something DivesScreen renders itself.
  expect(textIn(t).join(' ')).not.toContain('Date & time');
});

it('shows the selected dive beside the list instead of navigating, on a wide layout', async () => {
  mockUseWideLayout.mockReturnValue(true);
  mockUseLocalSearchParams.mockReturnValue({}); // DiveDetailScreen calls this unconditionally; the id prop overrides it either way
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({
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
  mockUseDives.mockReturnValue({
    dives: [dive({ id: 'a', siteName: 'Blue Hole' })],
    numbers: new Map([['a', 1]]),
    error: undefined,
  });
  const t = await render(<DivesScreen />);
  await fireEvent.press(findRow(t, 1));
  const backButtons = t.root ? t.root.queryAll((n) => n.props.accessibilityLabel === 'Back to dives') : [];
  expect(backButtons).toHaveLength(0);
});

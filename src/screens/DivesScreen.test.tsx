import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { dive } from '../domain/diveFixture';
import { reorderDivesForDate, type ReorderOutcome } from '../db/dives';
import { useDives } from '../db/useDives';
import { useWideLayout } from '../hooks/useWideLayout';
import DivesScreen from './DivesScreen';

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

// DESIGN.md §2.5's UI-facing half: hand-ordering is offered only where it can
// actually change something, and a reorder that cannot take effect must say
// so rather than silently spring back. domain/trips.test.ts and
// ReorderControls.test.tsx already cover canReorder/moveDown/applyReorder in
// isolation; these three exercise the real wiring end to end.

it('offers move controls for an untimed same-day pair, and asks reorderDivesForDate for the chronological order', async () => {
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
  const [firstDown] = findAllMoveButtons(t, 'down');
  if (!firstDown) throw new Error('expected a move-down control');
  await fireEvent.press(firstDown);

  // display order [x,y] -> swap(0,1) -> [y,x] -> chronological (reversed) -> [x,y]
  await waitFor(() => {
    expect(mockReorderDivesForDate).toHaveBeenCalledWith(expect.anything(), '2026-08-16', ['x', 'y']);
  });
});

it('does not offer move controls for a same-day pair that already has entry times', async () => {
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
// write, and the day recovers once that write settles.
it('does not fire a second reorder write for a day whose controls are already disabled by an in-flight one, and recovers once it settles — leaving a different day untouched throughout', async () => {
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
  let resolveReorder: ((outcome: ReorderOutcome) => void) | undefined;
  mockReorderDivesForDate.mockReturnValue(
    new Promise<ReorderOutcome>((resolve) => {
      resolveReorder = resolve;
    }),
  );

  const t = await render(<DivesScreen />);
  // Blue Hole's pair renders first, then Shark Reef's (groupIntoTrips
  // preserves the input's own order): x's down (enabled), y's (disabled,
  // last row), p's down (enabled), q's (disabled, last row).
  const [xDown, , pDown] = findAllMoveButtons(t, 'down');
  if (!xDown || !pDown) throw new Error('expected both days to offer a move-down control');

  fireEvent.press(xDown); // deliberately not awaited: the write is left in flight until resolved below
  await waitFor(() => {
    const downs = findAllMoveButtons(t, 'down');
    expect(downs[0]?.props.accessibilityState?.disabled).toBe(true); // Blue Hole (2026-08-16): in flight
    expect(downs[2]?.props.accessibilityState?.disabled).toBe(false); // Shark Reef (2026-08-10): untouched
  });

  // A repeat press on the now-disabled control must not reach
  // reorderDivesForDate a second time.
  await fireEvent.press(findAllMoveButtons(t, 'down')[0]!);
  expect(mockReorderDivesForDate).toHaveBeenCalledTimes(1);

  resolveReorder?.({ applied: true, effectiveOrder: ['y', 'x'], overriddenIds: [] });
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

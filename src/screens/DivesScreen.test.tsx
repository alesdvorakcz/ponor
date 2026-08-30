import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';

import { dive } from '../domain/diveFixture';
import { reorderDivesForDate } from '../db/dives';
import { useDives } from '../db/useDives';
import DivesScreen from './DivesScreen';

// Jest hoists jest.mock() calls above the imports above at transform time regardless of
// where it sits textually, so it can live here without an import/first violation.
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
// DivesScreen calls this one directly (via ReorderControls.tsx's applyReorder), unlike
// every read, which goes through the mocked useDives() above — mocked separately so a
// reorder test can control exactly what ReorderOutcome it resolves with, without a real
// database.
jest.mock('../db/dives', () => ({ reorderDivesForDate: jest.fn() }));

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

/** Every node carrying a given `accessibilityLabel`, in tree order — top to
 * bottom, the same order as the dives they belong to. */
function findAllByLabel(t: RenderResult, label: string) {
  return t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === label) : [];
}

const mockUseDives = useDives as jest.Mock;
const mockReorderDivesForDate = reorderDivesForDate as jest.Mock;

afterEach(() => {
  mockUseDives.mockReset();
  mockReorderDivesForDate.mockReset();
});

it('shows the empty state when there are no dives', async () => {
  mockUseDives.mockReturnValue({ dives: [], numbers: new Map(), error: undefined });
  const t = await render(<DivesScreen />);
  expect(textIn(t).join(' ')).toContain('Log your first dive');
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
  const [firstDown] = findAllByLabel(t, 'Move dive down');
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
  expect(findAllByLabel(t, 'Move dive down')).toHaveLength(0);
  expect(findAllByLabel(t, 'Move dive up')).toHaveLength(0);
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
  const [firstDown] = findAllByLabel(t, 'Move dive down');
  if (!firstDown) throw new Error('expected a move-down control');
  await fireEvent.press(firstDown);

  await waitFor(() => {
    expect(textIn(t).join(' ').toLowerCase()).toContain("couldn't reorder");
  });
});

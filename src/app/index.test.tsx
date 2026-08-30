import { fireEvent, render, type RenderResult } from '@testing-library/react-native';

import { dive } from '../domain/diveFixture';
import { useDives } from '../db/useDives';
import DivesScreen from './index';

// Jest hoists jest.mock() calls above the imports above at transform time regardless of
// where it sits textually, so it can live here without an import/first violation.
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));

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

const mockUseDives = useDives as jest.Mock;

afterEach(() => {
  mockUseDives.mockReset();
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

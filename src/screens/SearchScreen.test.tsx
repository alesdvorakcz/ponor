// The package's own official Jest mock — SearchScreen calls useSafeAreaInsets() to clear
// the home indicator under the bottom-anchored dock, gets a real SafeAreaProvider for free
// from expo-router's root layout in the app, and has none when rendered bare here. Imported
// first, and named `mock...`, for the babel-plugin-jest-hoist reason DiveFormScreen.test.tsx
// records: a jest.mock() factory may only close over out-of-scope identifiers starting with
// `mock`/`require`, and every jest.mock() call is hoisted above every import regardless.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useDives, type DiveListState } from '../db/useDives';
import { dive } from '../domain/diveFixture';
import { makeStyles } from '../theme/styles';
import { LOGBOOK_UNREADABLE } from '../domain/logbook';
import SearchScreen from './SearchScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));

const mockUseDives = useDives as jest.Mock;
const mockRouterPush = router.push as jest.Mock;
const mockRouterBack = router.back as jest.Mock;
const mockCanGoBack = router.canGoBack as jest.Mock;

/**
 * The one place this file stubs `useDives()`, and deliberately `mockImplementation` rather
 * than `mockReturnValue` — the real hook hands back a brand-new object holding a brand-new
 * array on every render, and a stub that models one frozen object forever is the fiction
 * that hid an infinitely-looping screen behind 537 green tests (DiveFormScreen.test.tsx's
 * own `stubDives` records it in full).
 */
function stubDives(state: Partial<DiveListState>) {
  mockUseDives.mockImplementation(() => ({
    ...state,
    dives: [...(state.dives ?? [])],
    numbers: new Map(state.numbers ?? []),
  }));
}

beforeEach(() => {
  mockCanGoBack.mockImplementation(() => true);
});

afterEach(() => {
  mockUseDives.mockReset();
  mockRouterPush.mockReset();
  mockRouterBack.mockReset();
  mockCanGoBack.mockReset();
});

function textIn(t: RenderResult): string[] {
  return (t.root ? t.root.queryAll((n) => n.type === 'Text') : [])
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

function findField(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => n.type === 'TextInput') : [];
  if (!node) throw new Error('SearchScreen did not render a search field');
  return node;
}

function findClose(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === 'Close search') : [];
  if (!node) throw new Error('SearchScreen did not render a way out');
  return node;
}

/** The dock the field sits in — located by the one style only that wrapper wears, so a test
 * can read where it is without caring how many levels separate it from the field. */
function findDock(t: RenderResult) {
  const [node] = t.root
    ? t.root.queryAll((n) => [n.props?.style].flat(5).includes(makeStyles('light').searchDock))
    : [];
  if (!node) throw new Error('SearchScreen did not render the search dock');
  return node;
}

const TWO_DIVES = {
  dives: [dive({ id: 'a', siteName: 'Blue Hole' }), dive({ id: 'b', siteName: 'Shark Reef' })],
  numbers: new Map([
    ['a', 1],
    ['b', 2],
  ]),
  error: undefined,
};

// DESIGN.md §3, measured off iOS 26 Messages by the owner: the field is anchored at the
// BOTTOM, where the keyboard rises, not under a header. This is the assertion that would
// fail if it drifted back up — the dock has to be the LAST child of the screen, after
// whatever fills the space above it, since that is what "anchored at the bottom" means in a
// flex column. Order in the tree, not a coordinate, because a coordinate is not something a
// test renderer produces.
it('anchors the field at the bottom of the screen, below the results', async () => {
  stubDives(TWO_DIVES);
  const t = await render(<SearchScreen />);
  const dock = findDock(t);
  const siblings = dock.parent?.children ?? [];
  expect(siblings[siblings.length - 1]).toBe(dock);
  expect(siblings.length).toBeGreaterThan(1); // ...and there is genuinely something above it
});

// The dock clears the home indicator when the keyboard is DOWN — read off the device rather
// than guessed, since how much clearance that needs varies (an iPhone with a home button
// needs none; one with a Dynamic Island needs 34). Proven by rendering with two different
// insets and requiring the padding to move by exactly the difference: a hard-coded number
// would give the same wrong answer both times.
//
// **What is NOT asserted here, deliberately: that the dock rides above the keyboard.** That
// is `KeyboardAvoidingView`'s job and this renderer cannot see it — the component consumes
// its own `behavior` prop and renders a plain `View`, forwarding nothing a host-tree query
// could read (found by writing that query first and watching it come back empty against a
// correct screen; RNTL 14 has no composite-tree escape hatch either — no `UNSAFE_getByType`,
// and `root` holds host elements only). It is verified by using the app instead, which is
// the honest place for a native layout behaviour, and this comment exists so that absence
// reads as a decision rather than a gap.
it('clears the home indicator under the dock, by the device’s own inset', async () => {
  stubDives(TWO_DIVES);
  const paddingWithInset = async (bottom: number) => {
    const t = await render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom } }}
      >
        <SearchScreen />
      </SafeAreaProvider>,
    );
    const style = [findDock(t).props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
    return style.reduce(
      (acc: number | undefined, s) => (typeof s.paddingBottom === 'number' ? s.paddingBottom : acc),
      undefined,
    );
  };

  const flat = await paddingWithInset(0);
  const homeIndicator = await paddingWithInset(34);
  expect(flat).toBeGreaterThan(0); // still clear of the physical edge with no inset at all
  expect(homeIndicator).toBe(flat! + 34); // moves by exactly the inset — not clamped, not ignored
});

// The field takes focus on arrival: the diver has just pressed a magnifier, and a screen
// whose only purpose is this field must not ask for a second tap.
it('focuses the field on arrival', async () => {
  stubDives(TWO_DIVES);
  const t = await render(<SearchScreen />);
  expect(findField(t).props.autoFocus).toBe(true);
});

// **The list clears on arrival**, exactly as Messages' does. A screen that opened showing
// every dive would look like the list the diver just left, and the first keystroke would
// appear to delete most of it. Both named dives are checked, so "shows nothing" cannot pass
// by rendering one of them.
it('shows a prompt rather than the whole logbook before anything is typed', async () => {
  stubDives(TWO_DIVES);
  const t = await render(<SearchScreen />);
  const text = textIn(t).join(' ');
  expect(text).not.toContain('Blue Hole');
  expect(text).not.toContain('Shark Reef');
  expect(text.toLowerCase()).toContain('search your dives');
});

// The whole point of the screen: typing narrows. `searchDives` itself is unit-tested in
// domain/search.test.ts; what is unproven without this is that this screen wires the field's
// value into it rather than leaving it inert.
it('narrows to matching dives as the diver types', async () => {
  stubDives(TWO_DIVES);
  const t = await render(<SearchScreen />);
  await fireEvent.changeText(findField(t), 'Blue');
  const text = textIn(t).join(' ');
  expect(text).toContain('Blue Hole');
  expect(text).not.toContain('Shark Reef');
});

// Three states that read the same unless kept apart — the same discipline DivesScreen keeps
// for its own three. "Nothing typed yet" must never read as "nothing found".
it('says when a search matched nothing, distinctly from the prompt', async () => {
  stubDives(TWO_DIVES);
  const t = await render(<SearchScreen />);
  await fireEvent.changeText(findField(t), 'no such site anywhere');
  const text = textIn(t).join(' ');
  expect(text.toLowerCase()).toContain('no dives match');
  expect(text.toLowerCase()).not.toContain('search your dives');
});

// ...and a failed read must never read as "nothing found" either. Asserted with a query
// typed, so the zero-results branch is the one it would otherwise have fallen into.
it('reports a failed read rather than showing it as an empty result', async () => {
  stubDives({ dives: [], numbers: new Map(), error: new Error('db gone') });
  const t = await render(<SearchScreen />);
  await fireEvent.changeText(findField(t), 'Blue');
  const text = textIn(t).join(' ');
  expect(text).toContain(LOGBOOK_UNREADABLE);
  expect(text.toLowerCase()).not.toContain('no dives match');
});

// A whitespace-only query is not a search. Without the trim it would count as "asked",
// `searchDives` would match everything, and the screen would silently become the dive list.
it('treats a whitespace-only query as nothing typed', async () => {
  stubDives(TWO_DIVES);
  const t = await render(<SearchScreen />);
  await fireEvent.changeText(findField(t), '   ');
  const text = textIn(t).join(' ');
  expect(text).not.toContain('Blue Hole');
  expect(text.toLowerCase()).toContain('search your dives');
});

// A result opens the dive it names. Pressing a Text inside the row works because
// `fireEvent.press` climbs to the nearest ancestor with a handler — the same mechanism
// DiveRow.test.tsx's own note relies on.
it('opens a result’s own dive', async () => {
  stubDives(TWO_DIVES);
  const t = await render(<SearchScreen />);
  await fireEvent.changeText(findField(t), 'Blue');
  const [row] = t.root ? t.root.queryAll((n) => n.type === 'Text' && n.children.includes('Blue Hole')) : [];
  if (!row) throw new Error('no result row');
  await fireEvent.press(row);
  expect(mockRouterPush).toHaveBeenCalledWith('/dive/a');
});

// **Leaving is obvious**, which the owner named as one of the two things that matter here.
// Through `backToDives`, the one owner of leaving a screen stacked on the list — not a
// second copy of its canGoBack guard.
it('leaves through the × beside the field', async () => {
  stubDives(TWO_DIVES);
  const t = await render(<SearchScreen />);
  expect(findClose(t).props.accessibilityRole).toBe('button');
  await fireEvent.press(findClose(t));
  expect(mockRouterBack).toHaveBeenCalledTimes(1);
});

// ...and the same control still works when there is no history to pop — a cold deep link to
// /search. `backToDives` owns that fallback; this proves the screen actually routes through
// it rather than calling `router.back()` itself, which would strand the diver.
it('leaves to the dives list when there is no history to pop', async () => {
  stubDives(TWO_DIVES);
  mockCanGoBack.mockImplementation(() => false);
  const t = await render(<SearchScreen />);
  await fireEvent.press(findClose(t));
  expect(mockRouterBack).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/');
});

// The keyboard is up for this screen's whole life. Scrolling the results is reading, so the
// keyboard should get out of the way; TAPPING one is opening a dive, so that tap must reach
// the row rather than being spent dismissing the keyboard. RN's defaults are the wrong way
// round on both counts ('none' and 'never'), which is why both are set explicitly.
it('dismisses the keyboard on scroll but not on a tap that opens a dive', async () => {
  stubDives(TWO_DIVES);
  const t = await render(<SearchScreen />);
  await fireEvent.changeText(findField(t), 'Blue');
  const [list] = t.root ? t.root.queryAll((n) => n.props?.keyboardDismissMode !== undefined) : [];
  if (!list) throw new Error('SearchScreen did not render the results list');
  expect(list.props.keyboardDismissMode).toBe('on-drag');
  expect(list.props.keyboardShouldPersistTaps).toBe('handled');
});

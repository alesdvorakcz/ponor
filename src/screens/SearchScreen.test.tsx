// The package's own official Jest mock — SearchScreen calls useSafeAreaInsets() to clear
// the home indicator under the bottom-anchored dock, gets a real SafeAreaProvider for free
// from expo-router's root layout in the app, and has none when rendered bare here. Imported
// first, and named `mock...`, for the babel-plugin-jest-hoist reason DiveFormScreen.test.tsx
// records: a jest.mock() factory may only close over out-of-scope identifiers starting with
// `mock`/`require`, and every jest.mock() call is hoisted above every import regardless.
import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useDives, type DiveListState } from '../db/useDives';
import { useDiveSampleShapes } from '../db/useDiveSampleShapes';
import { useKeyboardShown } from '../hooks/useKeyboardShown';
import { dive } from '../domain/diveFixture';
import { type ProfilePoint } from '../domain/profile';
import { makeStyles } from '../theme/styles';
import { logbookUnreadable } from '../domain/logbook';
import { setActiveLanguage } from '../i18n';
import SearchScreen from './SearchScreen';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);
jest.mock('../db/useDives', () => ({ useDives: jest.fn() }));
// Task 6's row sparkline map, mocked per module exactly as `useUnitSystem` below is: a live
// database read this screen must be renderable without, with a default so every pre-existing
// test — none of which has any opinion about samples — keeps getting back "nothing has a
// series" rather than `undefined`, which `shapes.get(...)` at the render cannot survive.
jest.mock('../db/useDiveSampleShapes', () => ({
  useDiveSampleShapes: jest.fn(() => ({ shapes: new Map(), resolved: true, error: undefined })),
}));
// M3m: this screen's dock now asks whether a keyboard is covering the bottom edge. Mocked so
// a test can raise one without a device — the hook's own behaviour is pinned in
// `useKeyboardShown.test.ts`, and what this file is about is what the dock does with the answer.
jest.mock('../hooks/useKeyboardShown', () => ({ useKeyboardShown: jest.fn(() => false) }));
jest.mock('../db/useUnitSystem', () => ({ useUnitSystem: jest.fn(() => 'metric') }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
}));

const mockUseDives = useDives as jest.Mock;
const mockUseDiveSampleShapes = useDiveSampleShapes as jest.Mock;
const mockKeyboardShown = useKeyboardShown as jest.Mock;
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
  // Explicit rather than left to the factory's own default, for the reason this repo's other
  // suites give: `clearAllMocks` clears calls but not return values, so one test raising a
  // keyboard would otherwise leak it into every test declared after it.
  mockKeyboardShown.mockReturnValue(false);
});

afterEach(() => {
  mockUseDives.mockReset();
  // Put back, not reset, for the reason `DivesScreen.test.tsx` records for its own `useUnitSystem`
  // mock: this one's default IS the answer every pre-existing test here depends on silently, and
  // `mockReset()` would leave a later test's override leaking into whichever test runs next.
  mockUseDiveSampleShapes.mockReturnValue({ shapes: new Map(), resolved: true, error: undefined });
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

// Task 6's row sparkline: a small hand-rolled series, enough to prove the wiring reaches the
// row at all — `ProfileSparkline.test.tsx` and `DiveRow.test.tsx` already own the real fixture.
const SERIES: ProfilePoint[] = [
  { t: 0, v: 5 },
  { t: 30, v: 12 },
  { t: 60, v: 3 },
];

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

// Task 6's whole reason for calling out the wiring by name: a `samples` prop that nothing
// ever passes draws nothing, forever. This proves the map `useDiveSampleShapes()` hands back
// actually reaches the matching row.
it("passes each dive its own series from useDiveSampleShapes() through to its row's sparkline", async () => {
  stubDives(TWO_DIVES);
  mockUseDiveSampleShapes.mockReturnValue({ shapes: new Map([['a', SERIES]]), resolved: true, error: undefined });
  const t = await render(<SearchScreen />);
  await fireEvent.changeText(findField(t), 'Blue');
  expect(t.root ? t.root.queryAll((n) => n.type === 'RNSVGPath') : []).toHaveLength(1);
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
  expect(text).toContain(logbookUnreadable());
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


// ---------------------------------------------------------------------------------------
// Czech (M3h)
// ---------------------------------------------------------------------------------------

describe('in Czech', () => {
  beforeEach(() => {
    setActiveLanguage('cs');
  });
  afterEach(async () => {
    await cleanup();
    setActiveLanguage('en');
  });

  /** The three states this screen keeps apart, said in Czech: nothing typed, nothing found,
   * and a logbook that would not open. The last is `logbookUnreadable`'s, shared with four
   * other screens, and the middle one is `dives.noMatches`, shared with the Dives list. */
  it('keeps its three states apart in Czech', async () => {
    stubDives({ dives: [dive({ id: 'a', siteName: 'Vis' })], numbers: new Map() });
    const t = await render(<SearchScreen />);
    expect(textIn(t).join(' ')).toContain('Hledejte ve svých ponorech podle lokality');

    await fireEvent.changeText(findField(t), 'nic takového');
    expect(textIn(t).join(' ')).toContain('Hledání neodpovídá žádný ponor.');
    await cleanup();

    stubDives({ dives: [], numbers: new Map(), error: new Error('disk') });
    const failed = await render(<SearchScreen />);
    expect(textIn(failed).join(' ')).toContain('Deník se nepodařilo otevřít.');
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
    stubDives({ dives: [dive({ id: 'a', siteName: 'Vis' })], numbers: new Map() });
    const t = await render(<SearchScreen />);
    expect(textIn(t).join(' ')).toContain('Search your dives by site');

    await act(() => {
      setActiveLanguage('cs');
    });
    expect(textIn(t).join(' ')).toContain('Hledejte ve svých ponorech');
    expect(textIn(t).join(' ')).not.toContain('Search your dives by site');
  });
});

/**
 * M3m's second wave. The dock cleared the home indicator whether or not anything was covering
 * it, so with the keyboard up — which on this screen is *always*, the field takes focus on
 * arrival — the whole inset was spent on an indicator behind the keys, and the dock rode that
 * much higher than it should. `liftedBottomInset` (theme/styles.ts) is the rule now, shared
 * with the dive form's footer, which had the same padding for the same reason.
 */
it('stops clearing the home indicator once the keyboard is covering it', async () => {
  stubDives(TWO_DIVES);
  const paddingWhileKeyboard = async (shown: boolean) => {
    mockKeyboardShown.mockReturnValue(shown);
    const t = await render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 34 } }}
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

  const keyboardDown = await paddingWhileKeyboard(false);
  const keyboardUp = await paddingWhileKeyboard(true);
  // The dock's own gap survives either way — it is what keeps the field off the keys.
  expect(keyboardUp).toBeGreaterThan(0);
  // ...and the 34 pt of indicator clearance is exactly what stops being spent.
  expect(keyboardDown).toBe(keyboardUp! + 34);
});

/**
 * **M3n, and this screen is where the fault was worst.** `DiveRow` used to withhold a logged
 * dive's date because "its trip header already states the day" — a reason belonging to
 * `DivesScreen` alone. Search has no headers at all, so two dives at one site came back as two
 * identical rows differing only by number and time of day, with the one fact that tells them
 * apart missing from the screen entirely. That is the case a diver searches in.
 */
it('dates each result, since nothing on this screen says when a dive was', async () => {
  stubDives({
    dives: [
      dive({ id: 'a', status: 'logged', date: '2026-06-12', siteName: 'Marsa Shona', timeIn: '09:15' }),
      dive({ id: 'b', status: 'logged', date: '2026-08-20', siteName: 'Marsa Shona', timeIn: '13:40' }),
    ],
    numbers: new Map([
      ['a', 7],
      ['b', 8],
    ]),
    error: undefined,
  });
  const t = await render(<SearchScreen />);
  await fireEvent.changeText(findField(t), 'marsa');

  const text = textIn(t).join(' ');
  // Both, and different: the two dates are what separate two results at one site.
  expect(text).toContain('12 Jun 2026');
  expect(text).toContain('20 Aug 2026');
});

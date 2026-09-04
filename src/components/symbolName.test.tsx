import { render } from '@testing-library/react-native';
import { SymbolView } from 'expo-symbols';

import { JS_TAB_ITEMS, NATIVE_TAB_ITEMS, TAB_ROUTES } from '../navigation/tabs';
import { LOG_DIVE_GLYPH, SEARCH_GLYPH } from '../screens/DivesScreen';
import { CENTERS_GLYPH, EXPLORE_GLYPH, MY_DIVES_GLYPH } from '../screens/MapScreen';
import { CLOSE_CENTERS_GLYPH } from '../screens/DiveCentersScreen';
import { CLOSE_SEARCH_GLYPH } from '../screens/SearchScreen';
import { ActionCapsule } from './ActionCapsule';
import { CarriedMark } from './CarriedMark';
import { ClearFieldControl } from './ClearFieldControl';
import { EntryIcon } from './EntryIcon';
import { SearchCapsule } from './SearchCapsule';
import { symbolName } from './symbolName';

// The one thing `SearchCapsule.test.tsx` and `EntryIcon.test.tsx` structurally cannot see.
//
// Those two suites assert against the HOST node a real `SymbolView` renders down to, which is
// the right check for "this is a genuine SF Symbol and not a drawn approximation" — but
// `SymbolView.ios.tsx` overwrites `name` with `props.name.ios` before handing it to the native
// view, so by the time it reaches a host node the object the component actually passed is
// gone. A missing `web` key is therefore invisible from there, which is exactly how it stayed
// missing: every icon test was green while neither icon drew anything at all in a browser.
//
// So this file mocks `SymbolView` and reads the props the app HANDS the library. That is the
// boundary the defect lives on. It is a separate file rather than three more tests in the two
// existing suites because `jest.mock` is hoisted per module and applies to the whole file —
// mocking `expo-symbols` inside either of those would destroy the native-module resolution
// they exist to pin.
//
// It cannot, and does not pretend to, observe a browser: Jest's one platform here is iOS
// (jest-expo's stock preset), so `SymbolView.tsx` — the non-iOS implementation that reads
// `name.web` — never loads under this suite. What is asserted is the app's side of the
// contract, which is the half the app owns.
jest.mock('expo-symbols', () => ({ SymbolView: jest.fn(() => null) }));
const mockSymbolView = SymbolView as unknown as jest.Mock;

// isLiquidGlassAvailable caches its first answer module-wide (SearchCapsule.test.tsx's own
// note), and the capsule renders the same icon either way, so this suite pins the branch
// rather than leaving the shared cache to decide which one it got.
jest.mock('expo-glass-effect', () => ({
  ...jest.requireActual('expo-glass-effect'),
  isLiquidGlassAvailable: jest.fn(() => false),
}));

afterEach(() => mockSymbolView.mockClear());

/** The `name` object of the one `SymbolView` a render produced. */
function nameProp(): Record<string, string> | undefined {
  return mockSymbolView.mock.calls[0]?.[0]?.name;
}

// The rule symbolName.ts exists to state: expo-symbols' non-iOS SymbolView serves Android and
// web from one file, one Material Symbols face and one codepoint table, so the browser's glyph
// IS the Android glyph. Asserted as equality with whatever `android` was handed in, not
// against a literal, so this keeps holding for symbols nobody has added yet.
it('derives the browser’s symbol from the Android one, and leaves both other keys alone', () => {
  expect(symbolName({ ios: 'ferry.fill', android: 'directions_boat_filled' })).toEqual({
    ios: 'ferry.fill',
    android: 'directions_boat_filled',
    web: 'directions_boat_filled',
  });
});

// Call sites, not only the owner, because the owner being correct buys nothing if a component
// still builds the object itself — which is the state this repo was in, twice over, before
// symbolName.ts. DESIGN.md §4.1: "a second implementation is a defect, not a style preference."
//
// **Every `PlatformSymbol` the app ships is pinned below, and that completeness is the point
// rather than a nicety.** The hole this file exists to close is invisible by construction —
// the test environment is iOS, `SymbolView.ios.tsx` discards every key but `ios`, and the
// simulator is iOS too — so "which call sites are checked" cannot be inferred from anything;
// it can only be listed. **Fourteen symbols in six places**: the search capsule's magnifier, the
// two `entry` chips, the five capsule glyphs `DivesScreen`, `SearchScreen` and `MapScreen` hand
// to `ActionCapsule`, `navigation/tabs.ts`' four, and M1h's carried treatment — the return mark
// and the clear control's ring.
//
// It was ten in six until M2n, and the three that joined are §3's Map tab: its own tab glyph, and
// BOTH states of the layer toggle in the capsule — one control that renders a different symbol
// depending on which layer is showing, so a check of one state proves nothing about the other.
// The fourteenth is M3a's Stats tab, and the tab block below is now tied to `TAB_ROUTES` so the
// fifteenth cannot arrive without one.
//
// It was eighteen in eight until M1i, and the eight that went are not a gap: they were the two
// condition marks and `WeatherIcon`'s six skies, and the components that drew them no longer
// exist (§10 — the marks are out, and §9's shelf holds what replaces them). Coverage of what
// remains is unchanged at every call site, which is the property M1h bought and this milestone
// had to keep while deleting around it.
//
// If you add a symbol, add it here. One block below makes that failure loud rather than trusting
// this sentence — the tab-route block asserts its own table against `TAB_ROUTES`, which is what
// that sentence used to CLAIM it did and did not (M3a; see the note there). (The weather table
// did the same job through a total `Record<Weather, …>`, and went with the skies.) The rest
// cannot be derived and are listed by hand.
it('gives the search capsule’s magnifier a web name, not just an iOS and an Android one', async () => {
  await render(<SearchCapsule scheme="dark" value="" onChangeText={() => {}} />);
  const name = nameProp();
  expect(name?.web).toBe('search');
  expect(name?.web).toBe(name?.android);
});

it.each([
  ['shore', 'directions_walk'],
  ['boat', 'directions_boat_filled'],
] as const)('gives the %s chip’s icon a web name, not just an iOS and an Android one', async (entry, material) => {
  await render(<EntryIcon entry={entry} tintColor="#000000" />);
  const name = nameProp();
  expect(name?.web).toBe(material);
  expect(name?.web).toBe(name?.android);
});

// --- The two marks M1h's carried treatment added, on the same boundary ---
//
// Both replace something that was previously TEXT — the word "carried" and a mono `×` — so
// neither had any Material name to be wrong before this milestone, and neither has a test
// anywhere else that could see one: `CarriedMark.test.tsx` and `ClearFieldControl.test.tsx`
// both render through the real `SymbolView.ios.tsx`, which overwrites `name` with
// `props.name.ios` before the value reaches a host node. Every assertion in either file reads
// one string, the SF name.
//
// What a wrong or missing Material name costs here is the whole treatment rather than a
// nuance. On Android and in a browser the return mark simply would not draw, and a carried
// row would be indistinguishable from an untouched one — which is the exact state §0.6 asked
// M1h to end, restored silently on two of the three platforms. The clear control is worse: it
// would be a 48 dp box with nothing in it, an invisible control on a row that still expects
// one to be pressed.
// Two tests rather than one `it.each`, because the two components take different props and a
// table row that satisfied both would have to hand each of them the other's.
it('gives the carried return mark an Android and a web name, not just an iOS one', async () => {
  await render(<CarriedMark scheme="dark" />);
  const name = nameProp();
  expect(name?.android).toBe('keyboard_return');
  expect(name?.web).toBe('keyboard_return');
});

it('gives the clear control’s ring an Android and a web name, not just an iOS one', async () => {
  await render(<ClearFieldControl accessibilityLabel="Clear carried Buddy" onPress={() => {}} scheme="dark" />);
  const name = nameProp();
  expect(name?.android).toBe('highlight_off');
  expect(name?.web).toBe('highlight_off');
});

// --- The three capsule glyphs ---
//
// These live in the two screens rather than in `ActionCapsule` — the component owns the
// capsule's shape and material, its caller owns which glyphs go in it, which is what lets one
// capsule serve two screens (`ActionCapsule.tsx`'s header). So the literals are the screens'
// and they are exported for this, with each screen's own note saying why.
//
// Rendered through `ActionCapsule` rather than by calling `symbolName` on the constant, so
// what is pinned is the value that actually reaches the library: a screen that stopped passing
// its `symbol` through the capsule, or a capsule that stopped calling `symbolName`, is the
// defect, and asserting on the constant alone would sail past both. One action per render,
// because `nameProp()` reads the first `SymbolView` call.
//
// `isLiquidGlassAvailable` is mocked false at the top of this file, so the capsule takes its
// plain `View` branch; the glyphs are identical either way (`ActionCapsule.test.tsx` is what
// pins that, shape for shape) and this suite has no opinion about the material.
it.each([
  ['dive list’s magnifier', SEARCH_GLYPH, 'search'],
  ['dive list’s plus', LOG_DIVE_GLYPH, 'add'],
  ['search screen’s close', CLOSE_SEARCH_GLYPH, 'close'],
  // The Map tab's layer toggle (M2n), which is ONE control in two states — §3's "toggle to
  // explore all community sites" — so both glyphs are here. Each is what the capsule renders
  // while the other layer is showing, and either one missing its Material name would leave the
  // browser's and Android's capsule empty in exactly one of the two states, which is the half
  // a single-state check would sail past.
  ['map screen’s explore toggle', EXPLORE_GLYPH, 'public'],
  ['map screen’s my-dives toggle', MY_DIVES_GLYPH, 'pin_drop'],
  // The third layer (M3c), and the third state of the same one control — a glyph missing its
  // Material name would leave the browser's and Android's capsule empty in exactly one of the
  // three states, which is the half a single-state check sails past.
  ['map screen’s centres toggle', CENTERS_GLYPH, 'storefront'],
  ['centres directory’s close', CLOSE_CENTERS_GLYPH, 'close'],
] as const)('gives the %s an Android and a web name, not just an iOS one', async (label, symbol, material) => {
  await render(
    <ActionCapsule scheme="dark" actions={[{ key: 'only', symbol, label, onPress: () => {} }]} />,
  );
  const name = nameProp();
  expect(name?.android).toBe(material);
  expect(name?.web).toBe(material);
});

// --- The two tab glyphs, which are the one call site with no render to observe ---
//
// The tabs' symbols reach the library in two different shapes on two different platforms:
// `{sf, md}` for `NativeTabs.Trigger.Icon` in `(tabs)/_layout.tsx`, and `{ios, android, web}`
// for an ordinary `SymbolView` in `(tabs)/_layout.web.tsx` — the browser gets the JS tab bar,
// so the `md`/`web` split is not academic here, it is the only bar a browser draws.
//
// **Asserted against the data rather than against a render, and that is forced rather than
// chosen.** expo-router sweeps `src/app/` as the route tree, so a test file there would ship
// to a diver's phone; nothing under it can be mounted. This is the same shape as this file's
// very first test, which calls `symbolName` directly on a literal.
//
// **What that used to leave uncovered, and what changed.** While the two layouts called the
// converters themselves, dropping the call — `name={route.symbol}` — was green across the
// whole suite at **1588/1588**: measured, and the exact defect `symbolName.ts` was written
// for, since the browser's `SymbolView` reads `name.web`, finds nothing on a raw
// `PlatformSymbol`, and draws no glyph. The conversion now happens in `navigation/tabs.ts`,
// inside the tested tree, and the items it hands each layout carry **no raw symbol at all**,
// so that edit is a `tsc` error rather than a silent blank bar. `tabs.test.ts` owns that
// structural property — every route resolved, in order, with nothing raw left on it.
//
// What is read here is `NATIVE_TAB_ITEMS`/`JS_TAB_ITEMS` themselves rather than the
// converters applied to `TAB_ROUTES`, because those two lists are literally what the layouts
// map over: a resolution that dropped a route, or resolved it with the wrong glyph, is caught
// here, where re-deriving the answer from the source would only have proved the converters
// still work.
const TAB_MATERIAL_NAMES = [
  ['index', 'waves'],
  // M2n. `map` is the same word in both vocabularies, which is exactly why it is pinned rather
  // than skipped: an iOS name that happens to be a legal Material name is the case where a
  // missing conversion looks right on the only platform anyone runs.
  ['map', 'map'],
  // M3a. §3's fourth tab, and the one whose iOS and Material names diverge most (`chart.bar`
  // against `bar_chart`), which is the ordinary case this file exists for.
  ['stats', 'bar_chart'],
  ['settings', 'settings'],
] as const;

// **The half of "if you add a symbol, add it here" that was a sentence rather than a check**
// (found in M3a, while adding the fourth tab). The header above claims this block "iterates
// `TAB_ROUTES` itself"; it did not — the table below is written by hand, and `.find` on it
// simply would not look at a tab nobody had listed. A fifth tab could therefore ship with no
// Material name and no Android or browser glyph, exactly the defect this file exists to
// prevent, and every test in it would stay green.
//
// So the table is tied to the bar instead: same routes, same order. A tab added to
// `navigation/tabs.ts` is red here until somebody writes down what it draws on the two
// platforms the simulator cannot show them.
it('pins a Material name for every tab in the bar, and for no tab that is not', () => {
  expect(TAB_MATERIAL_NAMES.map(([name]) => name)).toEqual(TAB_ROUTES.map((route) => route.name));
});

it.each(TAB_MATERIAL_NAMES)('gives the %s tab an Android and a web name, not just an iOS one', (name, material) => {
  const native = NATIVE_TAB_ITEMS.find((tab) => tab.name === name);
  const js = JS_TAB_ITEMS.find((tab) => tab.name === name);
  // The routes existing is part of the assertion: `.find` on a name nobody ships returns
  // `undefined`, and every expectation below would then be checking `undefined?.android`
  // against itself. A renamed or dropped tab must fail here rather than pass vacuously.
  expect(native).toBeDefined();
  expect(js).toBeDefined();
  expect(js?.icon.android).toBe(material);
  expect(js?.icon.web).toBe(material);
  expect(native?.icon.md).toBe(material);
});

// §0.6: "*other* does not [have a symbol]" — and the fix for the web gap must not have
// quietly turned "no icon" into "an icon with an empty name", which on the browser's
// SymbolView would render its (absent) fallback and on iOS a blank box.
it('still renders no symbol at all for an entry that has none', async () => {
  await render(<EntryIcon entry="other" tintColor="#000000" />);
  expect(mockSymbolView).not.toHaveBeenCalled();
});

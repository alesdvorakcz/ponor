import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';

import { themeFor } from '../theme/resolve';
import { SearchCapsule } from './SearchCapsule';

// Same adaptation every other component test in this repo notes (DayStrip.test.tsx,
// DiveRow.test.tsx): `render` wraps its own `act()` and is async; `root` is a
// `test-renderer` `TestInstance` exposing `queryAll(predicate)`, and its tree holds host
// elements only — a composite component (e.g. `SymbolView` itself) never appears as its
// own node, only whatever host element it eventually renders down to. `root` itself
// auto-resolves through composite wrappers to the nearest host node too (confirmed by
// probing `expo-glass-effect`'s `GlassView` directly: rendering it as the tree's own root
// hands back a `root` typed `"ViewManagerAdapter_ExpoGlassEffect"`, not the `GlassView`
// function) — which is what lets the tests below read `t.root.type`/`t.root.props.style`
// straight off this component's own outermost element, exactly as DayStrip.test.tsx
// already does for its own root.
function flatStyle(node: { props: { style?: unknown } } | undefined | null) {
  return [node?.props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
}

function findInput(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => n.type === 'TextInput') : [];
  if (!node) throw new Error('SearchCapsule did not render a TextInput');
  return node;
}

// expo-symbols' `SymbolView` resolves to a native view manager named `SymbolModule` on
// every platform Jest can run this suite under (this project's jest.config.js uses the
// stock `jest-expo` preset, and `@react-native/jest-preset` hard-codes
// `haste.defaultPlatform: 'ios'` — confirmed directly, not assumed, by probing
// `Platform.OS` inside a render). `.includes` rather than an exact
// `'ViewManagerAdapter_SymbolModule'` match, so a future jest-expo adapter-naming change
// doesn't decouple this from the one fact that actually matters: the REAL native module
// name a real SymbolView resolves to, taken straight from SymbolModule.ios's own
// `requireNativeViewManager('SymbolModule')` call, not guessed.
function findSymbol(t: RenderResult) {
  const [node] = t.root ? t.root.queryAll((n) => typeof n.type === 'string' && n.type.includes('SymbolModule')) : [];
  if (!node) throw new Error('SearchCapsule did not render a SymbolView');
  return node;
}

// isLiquidGlassAvailable's real (`.ios.ts`) implementation caches its answer in a
// module-level variable the first time it's ever called, which would make the two
// branches below untestable in the same run — the second render could never see a
// different answer than whichever the first render already froze. Mocking the whole
// `expo-glass-effect` module sidesteps that cache entirely: `isLiquidGlassAvailable`
// becomes a plain jest.fn() this file drives directly, while `GlassView` itself stays
// the real export (jest.requireActual), so a glass-branch render still goes through the
// real native-view-manager resolution `t.root.type` below reads off — only the yes/no
// gate is faked, not the material it renders when the answer is yes.
jest.mock('expo-glass-effect', () => ({
  ...jest.requireActual('expo-glass-effect'),
  isLiquidGlassAvailable: jest.fn(),
}));
// Jest hoists jest.mock() above the imports above at transform time regardless of where
// it sits textually (the same fact DivesScreen.test.tsx's own top comment notes), so the
// mocked `isLiquidGlassAvailable` is already in place by the time this cast runs.
const mockIsLiquidGlassAvailable = isLiquidGlassAvailable as jest.Mock;

afterEach(() => {
  mockIsLiquidGlassAvailable.mockReset();
});

it('wires the search input to the given value and reports edits via onChangeText, rather than leaving it inert', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const onChangeText = jest.fn();
  const t = await render(<SearchCapsule scheme="dark" value="Blue" onChangeText={onChangeText} />);
  const input = findInput(t);
  expect(input.props.value).toBe('Blue');
  expect(input.props.accessibilityLabel).toBe('Search dives');
  await fireEvent.changeText(input, 'Blue Hole');
  expect(onChangeText).toHaveBeenCalledWith('Blue Hole');
});

// DESIGN.md §0.6: "an SF Symbol magnifier at its leading edge (`expo-symbols`)". Proven
// down to the real native module name reaching a real SymbolView, not merely "some icon
// renders somewhere" — a drawn/imported-image approximation would never produce a
// `SymbolModule`-named host node at all, which is exactly the silent-substitution failure
// mode the task brief calls out by name.
//
// The Android half of `name` (`{ ios: 'magnifyingglass', android: 'search' }`,
// SearchCapsule.tsx) is NOT re-proven here: this suite runs under Jest's one hard-coded
// platform (`ios`, see findSymbol's own comment above), so `SymbolView.ios.tsx` resolves
// and forwards `name.ios` to the native prop this test can see — `name.android` never
// reaches the rendered tree under any Jest platform this repo runs, whether or not it was
// ever supplied. That half is instead a compile-time guarantee: `name`'s object form
// requires a real `AndroidSymbol` key (SymbolModule.types.ts), so a typo'd or missing
// Android symbol fails `tsc`, not a runtime assertion that cannot observe it.
it('points the magnifier at a real SF Symbol, resolved through to the native layer', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const t = await render(<SearchCapsule scheme="dark" value="" onChangeText={() => {}} />);
  const symbol = findSymbol(t);
  expect(symbol.props.name).toBe('magnifyingglass');
});

// DESIGN.md §0.6: "the app's Liquid Glass material where the device has it
// (`expo-glass-effect`, guarded by `isLiquidGlassAvailable()`)". The task brief names the
// exact trap this guards against: an assertion that only checks the fallback would pass
// whether or not `isLiquidGlassAvailable()` was ever consulted. This test and the next are
// the same render with only the mock's answer flipped, each asserting the OTHER branch's
// marker is absent as well as its own present — so neither could pass against a component
// that always renders one branch regardless of the gate.
it('renders the real Liquid Glass material when the device has it', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(true);
  const t = await render(<SearchCapsule scheme="dark" value="" onChangeText={() => {}} />);
  expect(mockIsLiquidGlassAvailable).toHaveBeenCalled();
  expect(String(t.root?.type)).toContain('ExpoGlassEffect');
  expect(t.root?.type).not.toBe('View');
});

it('falls back to a plain surface capsule when Liquid Glass is unavailable — the common case on every pre-26 iPhone and all of Android', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const t = await render(<SearchCapsule scheme="dark" value="" onChangeText={() => {}} />);
  expect(mockIsLiquidGlassAvailable).toHaveBeenCalled();
  expect(t.root?.type).toBe('View');
  expect(String(t.root?.type)).not.toContain('ExpoGlassEffect');
  expect(flatStyle(t.root).some((s) => s.backgroundColor === themeFor('dark').surface)).toBe(true);
});

// DESIGN.md §0.6, verbatim: "a plain `surface` capsule everywhere else, which is the
// common case and must look deliberate rather than degraded" — spelled out further in the
// task brief as "same geometry, same symbol, same shadow, opaque ground." Proven here by
// rendering both branches and diffing their shape, rather than eyeballing each in
// isolation: a fallback that quietly dropped the shadow, or used a different radius, would
// pass either branch's own render but fail this comparison.
it('gives the fallback the identical measured shape as the glass version — same height, same full rounding, same shadow, no border, only the fill differs', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(true);
  const glass = await render(<SearchCapsule scheme="dark" value="" onChangeText={() => {}} />);
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const plain = await render(<SearchCapsule scheme="dark" value="" onChangeText={() => {}} />);

  const glassStyle = flatStyle(glass.root);
  const plainStyle = flatStyle(plain.root);
  const heightOf = (style: Record<string, unknown>[]) =>
    style.reduce((acc: number | undefined, s) => (typeof s.height === 'number' ? s.height : acc), undefined);
  const radiusOf = (style: Record<string, unknown>[]) =>
    style.reduce((acc: number | undefined, s) => (typeof s.borderRadius === 'number' ? s.borderRadius : acc), undefined);
  const shadowOpacityOf = (style: Record<string, unknown>[]) =>
    style.reduce((acc: number | undefined, s) => (typeof s.shadowOpacity === 'number' ? s.shadowOpacity : acc), undefined);

  const glassHeight = heightOf(glassStyle);
  const plainHeight = heightOf(plainStyle);
  // §0.5's 48 dp tap-target floor applies to the search field exactly as much as to any
  // button — asserted as a floor (>=), matching DayStrip.test.tsx's own 48 dp test,
  // in case a future pass grows the capsule without shrinking under it.
  expect(glassHeight).toBeGreaterThanOrEqual(48);
  expect(glassHeight).toBe(plainHeight);

  // "Fully rounded (radius = height / 2)" — DESIGN.md §0.6's own words for what
  // distinguishes a capsule from a merely-rounded rectangle. Checked against the height
  // actually read above, not a hard-coded 48/24 pair, so this keeps holding even if the
  // capsule's own height ever changes.
  expect(radiusOf(glassStyle)).toBe(glassHeight! / 2);
  expect(radiusOf(plainStyle)).toBe(plainHeight! / 2);

  // "No bar ... no border ... separated by a soft shadow, not a line."
  expect(glassStyle.some((s) => typeof s.borderWidth === 'number' && s.borderWidth > 0)).toBe(false);
  expect(plainStyle.some((s) => typeof s.borderWidth === 'number' && s.borderWidth > 0)).toBe(false);
  const glassShadow = shadowOpacityOf(glassStyle);
  const plainShadow = shadowOpacityOf(plainStyle);
  expect(glassShadow).toBeGreaterThan(0);
  expect(glassShadow).toBe(plainShadow);

  // The one deliberate difference: only the fallback needs its own opaque fill, since
  // GlassView supplies its own material natively.
  expect(plainStyle.some((s) => s.backgroundColor === themeFor('dark').surface)).toBe(true);
  expect(glassStyle.some((s) => s.backgroundColor === themeFor('dark').surface)).toBe(false);
});

// DESIGN.md §0.6: "an SF Symbol magnifier ... in near-full-strength ink, with the
// placeholder in muted ink beside it."
it('tints the magnifier in near-full ink and the placeholder text in muted ink', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const t = await render(<SearchCapsule scheme="dark" value="" onChangeText={() => {}} />);
  expect(findSymbol(t).props.tintColor).toBe(themeFor('dark').fg);
  expect(findInput(t).props.placeholderTextColor).toBe(themeFor('dark').fgMuted);
});

// Every colour this component shows must trace back to makeStyles(scheme)/themeFor(scheme)
// rather than a literal baked in once — the same proof DayStrip.test.tsx's own "recolours
// for the light scheme" test applies to that component. The fallback branch is the one
// exercised here because it is the only one of the two with a theme-coloured fill at all
// (the glass branch's own test above already pins its fill as absent, in both schemes,
// since GlassView supplies its own material).
it('recolours the fallback capsule for the light scheme rather than carrying a fixed colour', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const t = await render(<SearchCapsule scheme="light" value="" onChangeText={() => {}} />);
  expect(flatStyle(t.root).some((s) => s.backgroundColor === themeFor('light').surface)).toBe(true);
  expect(flatStyle(t.root).some((s) => s.backgroundColor === themeFor('dark').surface)).toBe(false);
  expect(findSymbol(t).props.tintColor).toBe(themeFor('light').fg);
});

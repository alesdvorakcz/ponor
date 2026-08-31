import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';

import { themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import { ActionCapsule, type CapsuleAction } from './ActionCapsule';

// Same adaptation every other component test in this repo notes (SearchCapsule.test.tsx,
// DayStrip.test.tsx): `render` wraps its own `act()` and is async; `root` is a
// `test-renderer` `TestInstance` exposing `queryAll(predicate)`, and its tree holds host
// elements only, resolving through composite wrappers to the nearest host node.
function flatStyle(node: { props: { style?: unknown } } | undefined | null) {
  return [node?.props.style].flat(5).filter(Boolean) as Record<string, unknown>[];
}

// The same `SymbolModule` resolution SearchCapsule.test.tsx documents at length: expo-symbols'
// SymbolView renders down to a native view manager named `SymbolModule` under Jest's one
// hard-coded platform (`ios`, from `@react-native/jest-preset`'s `haste.defaultPlatform`), so
// a drawn or imported approximation would produce no such node at all. `.includes` rather
// than an exact adapter name, for the reason recorded there.
function findSymbols(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => typeof n.type === 'string' && n.type.includes('SymbolModule')) : [];
}

function findButton(t: RenderResult, label: string) {
  const [node] = t.root ? t.root.queryAll((n) => n.props?.accessibilityLabel === label) : [];
  if (!node) throw new Error(`ActionCapsule did not render a "${label}" control`);
  return node;
}

// isLiquidGlassAvailable's real (`.ios.ts`) implementation caches its answer the first time
// it is called, which would make the two branches below untestable in one run. Mocking the
// module leaves `GlassView` itself real (jest.requireActual) so the glass branch still goes
// through real native-view-manager resolution — only the yes/no gate is faked. Verbatim the
// arrangement SearchCapsule.test.tsx uses, and for the identical reason.
jest.mock('expo-glass-effect', () => ({
  ...jest.requireActual('expo-glass-effect'),
  isLiquidGlassAvailable: jest.fn(),
}));
const mockIsLiquidGlassAvailable = isLiquidGlassAvailable as jest.Mock;

afterEach(() => {
  mockIsLiquidGlassAvailable.mockReset();
});

const search: CapsuleAction = {
  key: 'search',
  symbol: { ios: 'magnifyingglass', android: 'search' },
  label: 'Search dives',
  onPress: () => {},
};
const logDive: CapsuleAction = {
  key: 'log-dive',
  symbol: { ios: 'plus', android: 'add' },
  label: 'Log a dive',
  onPress: () => {},
};

it('renders one button per action, each announcing itself by name', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const t = await render(<ActionCapsule scheme="dark" actions={[search, logDive]} />);
  const buttons = t.root ? t.root.queryAll((n) => n.props?.accessibilityRole === 'button') : [];
  expect(buttons).toHaveLength(2);
  expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(['Search dives', 'Log a dive']);
});

it('reports a press on the glyph the diver actually pressed, not on the capsule as a whole', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const onSearch = jest.fn();
  const onLog = jest.fn();
  const t = await render(
    <ActionCapsule scheme="dark" actions={[{ ...search, onPress: onSearch }, { ...logDive, onPress: onLog }]} />,
  );
  await fireEvent.press(findButton(t, 'Log a dive'));
  expect(onLog).toHaveBeenCalledTimes(1);
  expect(onSearch).not.toHaveBeenCalled();
});

// DESIGN.md §3's note: "magnifier and `+` as **equal monochrome glyphs**". Proven down to
// the real native module name reaching a real SymbolView, exactly as SearchCapsule.test.tsx
// proves its own magnifier — a drawn approximation would never produce a `SymbolModule`
// host node. The Android/web halves of each `name` are a compile-time guarantee rather than
// a runtime one, for the reason that file records: Jest's one platform is iOS, so
// `name.android` never reaches a rendered tree here whether or not it was supplied.
it('draws each glyph as a real SF Symbol, resolved through to the native layer', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const t = await render(<ActionCapsule scheme="dark" actions={[search, logDive]} />);
  expect(findSymbols(t).map((s) => s.props.name)).toEqual(['magnifyingglass', 'plus']);
});

// §0.1: "colour encodes depth and nothing else — every control is monochrome", and §10
// forbids an accent on the `+` by name. Equal means equal: both glyphs take the SAME ink,
// so a `+` quietly promoted with a different tint would fail here even though each glyph on
// its own would still look like a legitimate theme colour.
it('tints every glyph in the same monochrome ink, with no accent on the +', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const t = await render(<ActionCapsule scheme="dark" actions={[search, logDive]} />);
  const tints = findSymbols(t).map((s) => s.props.tintColor);
  expect(tints).toEqual([themeFor('dark').fg, themeFor('dark').fg]);
});

it('recolours for the light scheme rather than carrying a fixed colour', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const t = await render(<ActionCapsule scheme="light" actions={[search, logDive]} />);
  expect(findSymbols(t).every((s) => s.props.tintColor === themeFor('light').fg)).toBe(true);
  expect(flatStyle(t.root).some((s) => s.backgroundColor === themeFor('light').surface)).toBe(true);
  expect(flatStyle(t.root).some((s) => s.backgroundColor === themeFor('dark').surface)).toBe(false);
});

// The capsule's width is its glyphs' (theme/styles.ts's `actionCapsuleShape` carries no
// `flex` and no `width`), which is what makes §3's expected third glyph an addition rather
// than a re-measure. A capsule that hard-coded room for two would still pass every
// assertion above.
it('grows with its actions rather than assuming there are two of them', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const two = await render(<ActionCapsule scheme="dark" actions={[search, logDive]} />);
  const three = await render(
    <ActionCapsule scheme="dark" actions={[search, logDive, { ...search, key: 'third', label: 'Third' }]} />,
  );
  expect(findSymbols(two)).toHaveLength(2);
  expect(findSymbols(three)).toHaveLength(3);
  expect(flatStyle(two.root).some((s) => typeof s.width === 'number')).toBe(false);
});

// A hairline BETWEEN glyphs, never against the capsule's own edge — n glyphs, n-1 dividers,
// so one glyph draws none at all. Counted rather than merely "some divider exists", since a
// leading or trailing rule reads as a cut through the capsule rather than a seam.
it('separates glyphs with one hairline between each pair, and none at the ends', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const dividerStyle = makeStyles('dark').capsuleDivider;
  const dividersIn = (t: RenderResult) =>
    t.root ? t.root.queryAll((n) => flatStyle(n).includes(dividerStyle as Record<string, unknown>)) : [];

  expect(dividersIn(await render(<ActionCapsule scheme="dark" actions={[search]} />))).toHaveLength(0);
  expect(dividersIn(await render(<ActionCapsule scheme="dark" actions={[search, logDive]} />))).toHaveLength(1);
});

// DESIGN.md §0.6's rule for the search capsule, which this one shares: real Liquid Glass
// where the OS has it, and "a plain `surface` capsule everywhere else, which is the common
// case and must look deliberate rather than degraded". Both branches are asserted against
// each other rather than each in isolation — an assertion that only checked the fallback
// would pass whether or not `isLiquidGlassAvailable()` was ever consulted.
it('renders the real Liquid Glass material when the device has it, and an identically shaped opaque capsule when it does not', async () => {
  mockIsLiquidGlassAvailable.mockReturnValue(true);
  const glass = await render(<ActionCapsule scheme="dark" actions={[search, logDive]} />);
  mockIsLiquidGlassAvailable.mockReturnValue(false);
  const plain = await render(<ActionCapsule scheme="dark" actions={[search, logDive]} />);

  expect(mockIsLiquidGlassAvailable).toHaveBeenCalled();
  expect(String(glass.root?.type)).toContain('ExpoGlassEffect');
  expect(plain.root?.type).toBe('View');

  const pick = (style: Record<string, unknown>[], key: string) =>
    style.reduce((acc: unknown, s) => (s[key] !== undefined ? s[key] : acc), undefined);
  const glassStyle = flatStyle(glass.root);
  const plainStyle = flatStyle(plain.root);

  // Same height, same full rounding (radius = height / 2 — §0.6's own definition of a
  // capsule), same shadow. Only the fill differs.
  expect(pick(glassStyle, 'height')).toBe(48);
  expect(pick(plainStyle, 'height')).toBe(pick(glassStyle, 'height'));
  expect(pick(glassStyle, 'borderRadius')).toBe((pick(glassStyle, 'height') as number) / 2);
  expect(pick(plainStyle, 'borderRadius')).toBe(pick(glassStyle, 'borderRadius'));
  expect(pick(plainStyle, 'shadowOpacity')).toBe(pick(glassStyle, 'shadowOpacity'));
  expect(pick(plainStyle, 'backgroundColor')).toBe(themeFor('dark').surface);
  expect(pick(glassStyle, 'backgroundColor')).toBeUndefined();
});

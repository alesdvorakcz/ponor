import { render } from '@testing-library/react-native';
import { SymbolView } from 'expo-symbols';

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

// Both call sites, because the owner being correct buys nothing if a component still builds
// the object itself — which is the state this repo was in, twice over, before symbolName.ts.
// DESIGN.md §4.1: "a second implementation is a defect, not a style preference."
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

// §0.6: "*other* does not [have a symbol]" — and the fix for the web gap must not have
// quietly turned "no icon" into "an icon with an empty name", which on the browser's
// SymbolView would render its (absent) fallback and on iOS a blank box.
it('still renders no symbol at all for an entry that has none', async () => {
  await render(<EntryIcon entry="other" tintColor="#000000" />);
  expect(mockSymbolView).not.toHaveBeenCalled();
});

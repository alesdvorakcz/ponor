import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { render } from '@testing-library/react-native';
import { SymbolView } from 'expo-symbols';
import { type ReactElement } from 'react';
import * as ts from 'typescript';

import { jsTabItems, nativeTabItems, TAB_ROUTES } from '../navigation/tabs';
import { DELETE_DIVE_GLYPH } from '../screens/DiveDetailScreen';
import { LOG_DIVE_GLYPH, SEARCH_GLYPH } from '../screens/DivesScreen';
import { CLOSE_CENTERS_GLYPH } from '../screens/DiveCentersScreen';
import { CLOSE_SITES_GLYPH } from '../screens/DiveSitesScreen';
import { CURRENT_POSITION_GLYPH } from '../screens/NewPlaceScreen';
import { CREATE_PLACE_GLYPH, PICKED_PLACE_GLYPH, PICKER_SEARCH_GLYPH } from '../screens/PlacePickerScreen';
import { CLOSE_SEARCH_GLYPH } from '../screens/SearchScreen';
import { makeStyles } from '../theme/styles';
import { ACCOUNT_PERK_GLYPHS } from './AccountPerks';
import { ActionCapsule } from './ActionCapsule';
import { CENTERS_GLYPH, DiveMap, EXPLORE_GLYPH, MY_DIVES_GLYPH } from './DiveMap';
import { CARRIED_MARK_SYMBOL, CarriedMark } from './CarriedMark';
import { CLEAR_FIELD_SYMBOL, ClearFieldControl } from './ClearFieldControl';
import { MapCard, SHOW_ON_MAP_GLYPH } from './MapCard';
import { SEARCH_CAPSULE_GLYPH, SearchCapsule } from './SearchCapsule';
import { symbolName, type PlatformSymbol } from './symbolName';

// The one thing the suites that render a real `SymbolView` structurally cannot see
// (`SearchCapsule.test.tsx`, `CarriedMark.test.tsx`, `ClearFieldControl.test.tsx`).
//
// Those suites assert against the HOST node a real `SymbolView` renders down to, which is
// the right check for "this is a genuine SF Symbol and not a drawn approximation" — but
// `SymbolView.ios.tsx` overwrites `name` with `props.name.ios` before handing it to the native
// view, so by the time it reaches a host node the object the component actually passed is
// gone. A missing `web` key is therefore invisible from there, which is exactly how it stayed
// missing: every icon test was green while the app's first two icons drew nothing at all in a
// browser.
//
// So this file mocks `SymbolView` and reads the props the app HANDS the library. That is the
// boundary the defect lives on. It is a separate file rather than more tests in those suites
// because `jest.mock` is hoisted per module and applies to the whole file — mocking
// `expo-symbols` inside any of them would destroy the native-module resolution they exist to
// pin.
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
// **Every `PlatformSymbol` the app ships is pinned below, and the census at the end of this
// file is what makes that sentence a check rather than a claim** (#49). The hole this file
// closes is invisible by construction — the test environment is iOS, `SymbolView.ios.tsx`
// discards every key but `ios`, and the simulator is iOS too — so nothing else notices a symbol
// nobody pinned. This note used to list the places by hand, with running totals, and both
// drifted: the *Show on map* card's map and the record sheet's trash shipped unpinned while the
// note said every symbol was pinned, and its totals disagreed with its own blocks.
//
// So the note keeps no list and no count. Every pin is a row in one of four tables, and the
// tests iterate those rows: symbols drawn by rendering their component, symbols handed to the
// action capsule, symbols pinned as the constants their screens export, and the tab bar's. The
// census reads the app's source for every symbol written in it and requires each one to be held
// by a row, as the very object the app draws. It also requires every `<SymbolView>` the app
// renders to take its `name` from `symbolName`. A symbol added anywhere is red there until its
// row is written, whether it arrives with a call site of its own or is handed to one that
// already exists (another capsule action, another picker glyph).

// --- Symbols pinned by rendering the component that draws them ---
//
// Rendered rather than read off the constant, so what is pinned is the value that actually
// reaches the library: a component that stopped calling `symbolName`, or drew a different
// symbol from the one it exports, is the defect, and asserting on the constant alone would sail
// past both. Each row hands its own element, because the components take different props.
const RENDERED_GLYPHS: readonly (readonly [
  label: string,
  symbol: PlatformSymbol,
  material: string,
  draw: () => ReactElement,
])[] = [
  ['search capsule’s magnifier', SEARCH_CAPSULE_GLYPH, 'search', () => <SearchCapsule scheme="dark" value="" onChangeText={() => {}} />],
  // M1h's carried treatment. Both marks replace something that was TEXT — the word "carried"
  // and a mono `×` — and a wrong Material name costs the whole treatment rather than a nuance.
  // On Android and in a browser the return mark would not draw, and a carried row would be
  // indistinguishable from an untouched one, which is the exact state §0.6 asked M1h to end.
  // The clear control would be a 48 dp box with nothing in it, an invisible control on a row
  // that still expects one to be pressed.
  ['carried return mark', CARRIED_MARK_SYMBOL, 'keyboard_return', () => <CarriedMark scheme="dark" />],
  [
    'clear control’s ring',
    CLEAR_FIELD_SYMBOL,
    'highlight_off',
    () => <ClearFieldControl accessibilityLabel="Clear carried Buddy" onPress={() => {}} scheme="dark" />,
  ],
  // M3e. The centres glyph is drawn twice on the Map: in the filter capsule, and **inside a dive
  // centre's mark**, which is what lets the map do without a legend at all. The second drawing
  // is a separate `symbolName` call in `DiveMap`, so the capsule's row below says nothing about
  // it. A centre mark is the only kind that carries a symbol — a place carries a numeral and a
  // community site carries nothing — so one mark is the whole render this needs
  // (`react-native-maps` resolves through `__mocks__/react-native-maps.js`).
  [
    'centre’s map mark',
    CENTERS_GLYPH,
    'storefront',
    () => (
      <DiveMap
        scheme="dark"
        region={{ latitude: 43, longitude: 16, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
        onRegionSettled={() => {}}
        marks={[{ kind: 'centers', key: 'c1', label: 'Ponorka, dive centre', point: { latitude: 43, longitude: 16 } }]}
        selected={null}
        onSelect={() => {}}
        showsUserLocation={false}
      />
    ),
  ],
  // Issue #3's *Show on map* card, on the dive detail and on a site's and a centre's page.
  // Shipped unpinned until #49.
  [
    '*Show on map* card’s glyph',
    SHOW_ON_MAP_GLYPH,
    'map',
    () => <MapCard styles={makeStyles('dark')} scheme="dark" coordinates="43.0000, 16.0000" onPress={() => {}} />,
  ],
];

it.each(RENDERED_GLYPHS)(
  'gives the %s an Android and a web name, not just an iOS one',
  async (_label, symbol, material, draw) => {
    await render(draw());
    // The iOS half too, so a component that drew a symbol other than the one it exports is
    // caught here rather than passing on a Material name the two happen to share.
    expect(nameProp()).toEqual({ ios: symbol.ios, android: material, web: material });
  },
);

// --- Symbols pinned in the action capsule ---
//
// These live in the screens rather than in `ActionCapsule` — the component owns the capsule's
// shape and material, its caller owns which glyphs go in it, which is what lets one capsule
// serve several screens (`ActionCapsule.tsx`'s header). So the literals are the screens' and
// they are exported for this, with each screen's own note saying why.
//
// Rendered through `ActionCapsule` rather than by calling `symbolName` on the constant, so
// what is pinned is the value that actually reaches the library. One action per render,
// because `nameProp()` reads the first `SymbolView` call.
//
// `isLiquidGlassAvailable` is mocked false at the top of this file, so the capsule takes its
// plain `View` branch; the glyphs are identical either way (`ActionCapsule.test.tsx` is what
// pins that, shape for shape) and this suite has no opinion about the material.
const CAPSULE_GLYPHS = [
  ['dive list’s magnifier', SEARCH_GLYPH, 'search'],
  ['dive list’s plus', LOG_DIVE_GLYPH, 'add'],
  ['search screen’s close', CLOSE_SEARCH_GLYPH, 'close'],
  // The Map tab's three filter switches (M2n, M3c, M3e), which since the layers became a
  // filter are all three drawn at once rather than being three states of one control. They live
  // in `DiveMap.tsx` rather than on the screen, because the centres glyph is also drawn INSIDE a
  // centre's mark and the two must be one symbol — `MAP_KIND_GLYPH` is that tie, and this checks
  // the three values it holds. One of them missing its Material name would leave the browser's
  // and Android's capsule with a hole in it where a switch should be.
  ['map screen’s community switch', EXPLORE_GLYPH, 'public'],
  ['map screen’s my-dives switch', MY_DIVES_GLYPH, 'pin_drop'],
  ['map screen’s centres switch', CENTERS_GLYPH, 'storefront'],
  ['centres directory’s close', CLOSE_CENTERS_GLYPH, 'close'],
  ['sites directory’s close', CLOSE_SITES_GLYPH, 'close'],
] as const;

it.each(CAPSULE_GLYPHS)('gives the %s an Android and a web name, not just an iOS one', async (label, symbol, material) => {
  await render(<ActionCapsule scheme="dark" actions={[{ key: 'only', symbol, label, onPress: () => {} }]} />);
  // The whole name, as the rendered rows above check it.
  expect(nameProp()).toEqual({ ios: symbol.ios, android: material, web: material });
});

// --- Symbols pinned as the constants their screens export ---
//
// Drawn by screens whose render means mocking their catalogue, logbook and session reads, which
// their own suites already do and this file deliberately does not. So a row here checks one
// thing, the constant's Material name. The rest is held elsewhere: this file's first test pins
// that `symbolName` makes the web name the Android one, and the census below that the screen
// passes its symbol to a `SymbolView` through `symbolName`, and that any other symbol the screen
// drew instead would be a literal no row holds.
const NAMED_GLYPHS = [
  // Issue #19's site and centre picker. A missing Material name would leave the browser's and
  // Android's picker with no magnifier, no check on the chosen row and no `+` on *Create*.
  ['picker’s magnifier', PICKER_SEARCH_GLYPH, 'search'],
  ['picker’s chosen-row check', PICKED_PLACE_GLYPH, 'check'],
  ['picker’s create plus', CREATE_PLACE_GLYPH, 'add'],
  // The *New dive site* page's *Use current position* card.
  ['new place’s current-position arrow', CURRENT_POSITION_GLYPH, 'near_me'],
  // What an account adds (issue #24) — the first-run card, Settings' card and the account
  // screen draw these beside their words. One missing would leave a word with a hole beside it
  // on Android and in a browser.
  ['account perk backup', ACCOUNT_PERK_GLYPHS[0], 'backup'],
  ['account perk devices', ACCOUNT_PERK_GLYPHS[1], 'devices'],
  ['account perk community', ACCOUNT_PERK_GLYPHS[2], 'map'],
  // Issue #3's record sheet, the dive detail's one destructive act. Shipped unpinned until #49.
  ['record sheet’s delete', DELETE_DIVE_GLYPH, 'delete'],
] as const;

it.each(NAMED_GLYPHS)('gives the %s an Android and a web name, not just an iOS one', (_label, symbol, material) => {
  expect(symbol.android).toBe(material);
});

// --- The tab glyphs, checked on the data both bars are handed ---
//
// The tabs' symbols reach the library in two different shapes on two different platforms:
// `{sf, md}` for `NativeTabs.Trigger.Icon` in `(tabs)/_layout.tsx`, and `{ios, android, web}`
// for the `SymbolView` inside `components/TabBarGlyph.tsx`, which `(tabs)/_layout.web.tsx`
// renders — the browser gets the JS tab bar, so the `md`/`web` split is not academic here, it
// is the only bar a browser draws.
//
// **Asserted against the data rather than against a render.** For the native half that is
// forced: expo-router sweeps `src/app/` as the route tree, so a test file there would ship to
// a diver's phone, and `NativeTabs.Trigger.Icon` in `_layout.tsx` cannot be mounted. The
// browser half is rendered since issue #2 moved its glyph into `TabBarGlyph` — that file's own
// test mounts it and checks its ink and size — so here the names are read off the data by
// choice, the same shape as this file's very first test, which calls `symbolName` directly on
// a literal.
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
// What is read here is `nativeTabItems()`/`jsTabItems()` themselves rather than the
// converters applied to `TAB_ROUTES`, because those two lists are literally what the layouts
// map over: a resolution that dropped a route, or resolved it with the wrong glyph, is caught
// here, where re-deriving the answer from the source would only have proved the converters
// still work.
//
// **Dives and Settings are in the table with `null`** (issue #2): they draw Ponor's own glyphs —
// the mark and the canvas's sliders — on every platform, so they have no Material name to pin.
// They stay listed, because the check below that ties this table to the bar is what would
// otherwise let a tab slip past unpinned. `tabs.test.ts` pins the glyphs themselves.
const TAB_MATERIAL_NAMES = [
  ['index', null],
  // M2n. `map` is the same word in both vocabularies, which is exactly why it is pinned rather
  // than skipped: an iOS name that happens to be a legal Material name is the case where a
  // missing conversion looks right on the only platform anyone runs.
  ['map', 'map'],
  // M3a. §3's fourth tab, and the one whose iOS and Material names diverge most
  // (`chart.bar.fill` against `bar_chart`), which is the ordinary case this file exists for.
  ['stats', 'bar_chart'],
  // Issue #2: the canvas's own two sliders, an image like the mark — so no Material name either.
  ['settings', null],
] as const;

// **A census that was a sentence rather than a check** (found in M3a, while adding the fourth
// tab). This file's note then claimed this block "iterates `TAB_ROUTES` itself"; it did not —
// the table above is written by hand, and `.find` on it simply would not look at a tab nobody
// had listed. A fifth tab could therefore have shipped with no Material name and no Android or
// browser glyph, exactly the defect this file exists to prevent, and every test in it would
// have stayed green.
//
// So the table is tied to the bar instead: same routes, same order. A tab added to
// `navigation/tabs.ts` is red here until somebody writes down what it draws on the two
// platforms the simulator cannot show them.
it('lists every tab in the bar, and no tab that is not, with its Material name or null for Ponor’s own glyphs', () => {
  expect(TAB_MATERIAL_NAMES.map(([name]) => name)).toEqual(TAB_ROUTES.map((route) => route.name));
});

it.each(TAB_MATERIAL_NAMES.filter(([, material]) => material !== null))(
  'gives the %s tab an Android and a web name, not just an iOS one',
  (name, material) => {
    const native = nativeTabItems().find((tab) => tab.name === name);
    const js = jsTabItems().find((tab) => tab.name === name);
    // The routes existing is part of the assertion: `.find` on a name nobody ships returns
    // `undefined`, and every expectation below would then be checking `undefined?.android`
    // against itself. A renamed or dropped tab must fail here rather than pass vacuously —
    // and so must a symbol tab that turned into an image, which has no name to check.
    if (!native || !js || !('md' in native.icon) || !('name' in js.icon)) {
      throw new Error(`the ${name} tab should be in both bars, drawn by a symbol`);
    }
    expect(js.icon.name.android).toBe(material);
    expect(js.icon.name.web).toBe(material);
    expect(native.icon.md).toBe(material);
  },
);

it('draws the tabs with no Material name as Ponor’s own glyphs, not as blank symbols', () => {
  for (const [name] of TAB_MATERIAL_NAMES.filter(([, material]) => material === null)) {
    const native = nativeTabItems().find((tab) => tab.name === name);
    const js = jsTabItems().find((tab) => tab.name === name);
    expect(native?.icon).toHaveProperty('xcasset');
    expect(native?.icon).toHaveProperty('drawable');
    expect(js?.icon).toHaveProperty('image');
  }
});

// --- The census (#49) ---
//
// What makes "every symbol the app ships is pinned" a check (the note above says why it has to
// be one). It reads the app's source rather than importing it, with TypeScript's own parser, so
// a symbol quoted in a comment or a string is not taken for one. What it reads is every
// `.ts`/`.tsx` under `src/` except the tests and three folders only they use: `src/testing/` and
// any `__fixtures__` or `__mocks__` folder. A fixture may well hold an `ios` and an `android`
// that are not symbols (two OS versions, say), and none of it ships. A test-only file outside
// those folders is still read (`domain/diveFixture.ts` is one, and holds no symbol). That errs
// the safe way: a pair in such a file would turn this red until moved, never let a symbol by.
//
// **What it can see, and what it cannot.** A symbol is found when it is written the way every
// symbol in the app is written today: an object literal whose `ios` and `android` are both
// string literals, keys quoted or not. One built any other way (spread from another, computed,
// read from data) is not found, and neither is a `SymbolView` rendered other than as JSX under
// that name. Neither exists. Either would need this census taught about it, not excused from it.
//
// **Platform files are the app too.** `DiveMap.web.tsx` and its kind are scanned, and a symbol
// written only in one must be held by a row like any other. Jest runs as iOS, so an import of
// `./DiveMap` here gets the native file; a row holds a web-only symbol by importing the platform
// file by its full name (`./DiveMap.web`), as `theme/fonts.test.ts` does with `loadFonts.web`.

const SOURCE_ROOT = join(__dirname, '..');

/** Folders that only the tests use, at any depth under `src/`. */
const TEST_ONLY_FOLDERS: ReadonlySet<string> = new Set(['testing', '__fixtures__', '__mocks__']);

/** Every `.ts`/`.tsx` under `src/` but the tests and the folders above (see the note for the rest). */
const appSources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return TEST_ONLY_FOLDERS.has(entry.name) ? [] : appSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

const pairOf = (symbol: { ios: string; android: string }): string => `${symbol.ios} · ${symbol.android}`;

/**
 * The text of a `key: 'string'` property on an object literal, if it has one. The key may be
 * quoted (`'ios':`) and the value a template with no substitutions (`` `delete` ``): both
 * type-check as a `PlatformSymbol`, so both must be found.
 */
function stringProperty(literal: ts.ObjectLiteralExpression, key: string): string | undefined {
  for (const property of literal.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === key &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return undefined;
}

/** A JSX element's `name` attribute, if it has one. */
function nameAttribute(element: ts.JsxOpeningLikeElement): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === 'name',
  );
}

/** Whether a `name` attribute is `name={symbolName(…)}`. */
function isResolved(attribute: ts.JsxAttribute | undefined, source: ts.SourceFile): boolean {
  const value = attribute?.initializer;
  return (
    value !== undefined &&
    ts.isJsxExpression(value) &&
    value.expression !== undefined &&
    ts.isCallExpression(value.expression) &&
    value.expression.expression.getText(source) === 'symbolName'
  );
}

interface Census {
  /** Every symbol written in the app, with where: `ios · android` → `file:line` each time. */
  symbols: ReadonlyMap<string, readonly string[]>;
  /** Every `SymbolView` whose `name` is not a `symbolName(…)` call, as `file: name=…`. */
  unresolvedNames: readonly string[];
}

function takeCensus(): Census {
  const symbols = new Map<string, string[]>();
  const unresolvedNames: string[] = [];
  for (const file of appSources(SOURCE_ROOT)) {
    // With `/` whatever the OS, so the exception pinned below reads the same on every machine.
    const path = relative(SOURCE_ROOT, file).split(sep).join('/');
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const ios = stringProperty(node, 'ios');
        const android = stringProperty(node, 'android');
        if (ios !== undefined && android !== undefined) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          const pair = pairOf({ ios, android });
          symbols.set(pair, [...(symbols.get(pair) ?? []), `${path}:${line}`]);
        }
      }
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'SymbolView') {
        const name = nameAttribute(node);
        if (!isResolved(name, source)) unresolvedNames.push(`${path}: ${name?.getText(source) ?? 'no name'}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { symbols, unresolvedNames };
}

/**
 * Every symbol a row above holds, as the object itself. A set, because one object can be held
 * twice (the centres glyph is pinned in the capsule and in its map mark) and is still one symbol
 * written once.
 */
const PINNED: ReadonlySet<PlatformSymbol> = new Set<PlatformSymbol>([
  ...RENDERED_GLYPHS.map(([, symbol]) => symbol),
  ...CAPSULE_GLYPHS.map(([, symbol]) => symbol),
  ...NAMED_GLYPHS.map(([, symbol]) => symbol),
  // The tab table is tied to `TAB_ROUTES` and pins every tab drawn by a symbol, so the routes'
  // own symbols are what it holds.
  ...TAB_ROUTES.flatMap(({ glyph }) => ('symbol' in glyph ? [glyph.symbol] : [])),
]);

describe('the census of the app’s source', () => {
  let census: Census;
  beforeAll(() => {
    census = takeCensus();
  });

  // Compared per symbol, by count, because the same symbol is written in several places (the
  // magnifier three times) and each of them is its own object a row has to hold. A mismatch
  // names every place the symbol is written, since which of them is the unpinned one is not
  // something a count can tell.
  it('finds every symbol written in the app held by a row above, and every row’s symbol written in the app', () => {
    const pinned = new Map<string, number>();
    for (const symbol of PINNED) pinned.set(pairOf(symbol), (pinned.get(pairOf(symbol)) ?? 0) + 1);
    const mismatches = [...new Set([...census.symbols.keys(), ...pinned.keys()])].sort().flatMap((pair) => {
      const written = census.symbols.get(pair) ?? [];
      const held = pinned.get(pair) ?? 0;
      return written.length === held ? [] : [`${pair}: written ${written.length} (${written.join(', ')}), held ${held}`];
    });
    expect(mismatches).toEqual([]);
  });

  // `SymbolView`'s `name` also accepts a bare SF name or an object with no `web` key, and both
  // type-check, so this is the only thing that would notice a call site drawing nothing off iOS.
  // `TabBarGlyph` is the one exception, and not a hole: it is handed a name `navigation/tabs.ts`
  // already resolved through `symbolName` (`JsTabIcon`'s `name` is typed as what `symbolName`
  // returns), and the tab block above pins it.
  it('finds every SymbolView in the app taking its name from symbolName, bar the tab bar’s pre-resolved one', () => {
    expect(census.unresolvedNames).toEqual(['components/TabBarGlyph.tsx: name={icon.name}']);
  });
});

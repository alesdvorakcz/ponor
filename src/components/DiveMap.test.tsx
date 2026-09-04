import { render, type RenderResult } from '@testing-library/react-native';

import { type MapMark, type MapMarkRef } from './DiveMap';
import { CENTERS_GLYPH, DiveMap, MAP_KIND_GLYPH, MAP_MARK_KINDS } from './DiveMap';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { depthScale } from '../theme/tokens';
import { makeStyles } from '../theme/styles';
import { themeFor } from '../theme/resolve';

/**
 * **What this suite claims, and — more usefully — what it does not.**
 *
 * `react-native-maps` is a native module on every axis (`requireNativeComponent`, plus codegen
 * calls at module scope), so it is replaced by `__mocks__/react-native-maps.js` here. **A mocked
 * map asserts almost nothing about a map.** It draws no tiles, measures no view, resolves no
 * layout and produces no gesture, so every question a reader might assume a green suite has
 * answered is still open after it. M3c is the proof rather than the warning: M2n shipped this
 * screen with twenty-four mutations all killed, and the simulator then found a mark that could
 * not be pressed at all and marks that were never on their own coordinates.
 *
 * **What is checked below is the app's own side of the boundary** — the props Ponor hands the
 * library, which is code this repo owns and can get wrong:
 *
 *  · one mark per place, at the coordinate the domain computed;
 *  · that each of the three kinds draws its own interior — a count, a `storefront` glyph, or
 *    nothing — and that the glyph is the filter's own symbol, through `symbolName`;
 *  · that pressing a mark reports that mark, kind and all;
 *  · that the selected mark inverts and no other, **including a mark of another kind carrying
 *    the same key**, which is a collision the key space allowed the day the layers became a
 *    filter;
 *  · that the diver's position is drawn only when the caller says the permission is granted;
 *  · that **no paint reaches a `View` from outside the stylesheet**, which is §0.1's guard for
 *    this screen and the reason `unexpectedGraphics` is swept here at all.
 *
 * **What only the simulator can settle**, and what the report for this task therefore had to
 * cover by looking: whether the three interiors read as three kinds of thing at 26 pt over
 * Apple's cartography in both themes, whether a `storefront` at 14 pt is a shop or a smudge,
 * whether the region actually frames the pins, whether a mark is pressable at all, and whether
 * the map renders.
 *
 * The press below calls the `onPress` prop rather than going through `fireEvent`. That is
 * deliberate rather than a shortcut: on a device the press arrives from `MKMapView` selecting an
 * annotation, so a synthesised touch on a stand-in `View` would be a gesture no real user makes
 * and would prove nothing extra. The claim this carries is exactly "the handler we hand each
 * mark reports that mark", which is the part we wrote.
 */

const REGION = { latitude: 43.5, longitude: 16.4, latitudeDelta: 0.5, longitudeDelta: 0.5 };

const MARKS: MapMark[] = [
  { kind: 'mine', key: 'site:s1', label: 'Blue Hole, 4 dives', point: { latitude: 43.5, longitude: 16.4 }, badge: '4' },
  { kind: 'mine', key: 'site:s2', label: 'Shark Point, 1 dive', point: { latitude: 43.6, longitude: 16.5 }, badge: '1' },
];

const SITE: MapMark = {
  kind: 'community',
  key: 'c1',
  label: 'Vis, dive site',
  point: { latitude: 43, longitude: 16 },
};

const CENTRE: MapMark = {
  kind: 'centers',
  key: 'c1',
  label: 'Ponorka, dive centre',
  point: { latitude: 43.2, longitude: 16.2 },
};

function draw(over: Partial<Parameters<typeof DiveMap>[0]> = {}) {
  return render(
    <DiveMap
      scheme="light"
      region={REGION}
      marks={MARKS}
      selected={null}
      onSelect={() => {}}
      showsUserLocation={false}
      {...over}
    />,
  );
}

function markers(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => n.props?.coordinate !== undefined) : [];
}

/**
 * The map itself, which is **the rendered subject's own root** — and `queryAll` walks
 * descendants only, so a search that did not include `t.root` would find nothing here and every
 * assertion about the props the library is handed would have to be written some other way.
 * `unexpectedGraphics` records the same hole from the other end (a component whose outermost
 * `View` carried a literal was the one element that guard could never see), which is what makes
 * this worth spelling out rather than quietly working around.
 */
function mapView(t: RenderResult) {
  const nodes = t.root ? [t.root, ...t.root.queryAll(() => true)] : [];
  const node = nodes.find((n) => n.props?.initialRegion !== undefined);
  if (node === undefined) throw new Error('DiveMap rendered no map');
  return node;
}

/**
 * The host node a real `SymbolView` renders down to — `ActionCapsule.test.tsx`'s own finder,
 * copied on that file's stated reasoning rather than by habit: a genuine SF Symbol produces a
 * native `SymbolModule` view and a drawn or imported approximation produces no such node at all.
 * What it CANNOT see is the `name` OBJECT the app handed the library, because `SymbolView.ios`
 * overwrites `name` with `name.ios` first — `symbolName.test.tsx` owns that half and renders this
 * component to get it.
 */
function findSymbols(t: RenderResult) {
  return t.root ? t.root.queryAll((n) => typeof n.type === 'string' && n.type.includes('SymbolModule')) : [];
}

function stylesOf(node: { props?: { style?: unknown } }): unknown[] {
  return [node.props?.style].flat(5).filter(Boolean);
}

function textIn(node: { queryAll: (p: (n: { type: unknown; children: unknown[] }) => boolean) => { children: unknown[] }[] }) {
  return node
    .queryAll((n) => n.type === 'Text')
    .flatMap((n) => n.children)
    .filter((c): c is string => typeof c === 'string');
}

it('draws one mark per place, at the coordinate it was given', async () => {
  const t = await draw();
  expect(markers(t)).toHaveLength(2);
  expect(markers(t).map((m) => m.props.coordinate)).toEqual([
    { latitude: 43.5, longitude: 16.4 },
    { latitude: 43.6, longitude: 16.5 },
  ]);
  expect(mapView(t).props.initialRegion).toBe(REGION);
  /**
   * **And each one sits on that coordinate by its middle** (M3c). A map annotation's position
   * otherwise depends on how big its mark is: taking the old transparent 48 dp wrapper off
   * shifted every mark on screen by about half the difference, which is a mark drawn beside the
   * place rather than on it. A mocked map can say nothing about pixels, but it can say the
   * anchor was asked for — and that is the half that would go missing if someone dropped the
   * prop while tidying.
   */
  expect(markers(t).map((m) => m.props.anchor)).toEqual([
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
  ]);
});

// §3: "badge = count per site". Always the count, including `1` — a bare mark for a single dive
// would make the ABSENCE of a number mean "one", which is a legend (§0.6/§10 have twice ruled
// that a symbol needing one has failed) and which is now the meaning "a community site" carries.
it('badges every mark with its own count, one included', async () => {
  expect(markers(await draw()).map((m) => textIn(m))).toEqual([['4'], ['1']]);
});

/**
 * **The three interiors, which are the whole mark vocabulary** (M3e).
 *
 * §0.1 leaves no hue and M3c spent plain shape by building it and looking, so what tells the
 * three kinds apart is what is inside one identical 26 pt disc: a numeral, a `storefront` glyph,
 * or nothing. Asserted as a table over all three at once rather than one kind at a time, because
 * every one of these claims is really about the OTHERS — "a site draws no glyph" is only worth
 * anything beside "a centre does".
 */
it.each([
  ['a place of the diver’s own', MARKS[0]!, { text: ['4'], glyphs: 1 }],
  ['a community site', SITE, { text: [], glyphs: 0 }],
  ['a dive centre', CENTRE, { text: [], glyphs: 1 }],
] as const)('draws %s in its own interior and no other kind’s', async (_label, mark, expected) => {
  const t = await draw({ marks: [mark] });
  const node = markers(t)[0];
  expect(node).toBeDefined();
  expect(textIn(node!)).toEqual([...expected.text]);
  // The numeral and the glyph are counted together — one is a `Text`, one is a native symbol
  // view — so "a badge carries no glyph", "a centre carries no numeral" and "a site carries
  // neither" are one assertion over all three rather than three shapes of check that could each
  // be wrong on its own.
  const glyphs = node!.queryAll((n) => typeof n.type === 'string' && n.type.includes('SymbolModule'));
  expect(textIn(node!).length + glyphs.length).toBe(expected.glyphs);
});

/**
 * **A community site is drawn with the same disc a centre is, and the disc is the same one M3c
 * measured to be pressable at all.** Both catalogue kinds share `mapMarkDot`; what differs is
 * only what is inside it, which is what makes an overlap between them read as two marks rather
 * than as one stacked card (M3c's measurement of the shape alternative).
 */
it.each([SITE, CENTRE] as const)('gives every catalogue mark the same disc', async (mark) => {
  const styles = makeStyles('light');
  const t = await draw({ marks: [mark] });
  const node = markers(t)[0];
  expect(node).toBeDefined();
  expect(node!.queryAll((n) => stylesOf(n).includes(styles.mapMarkDot))).toHaveLength(1);
});

/**
 * **The centre's glyph is the filter's own glyph, and it goes through `symbolName`.**
 *
 * That tie is the whole reason this map needs no legend (§0.6 has twice ruled that a symbol
 * needing one has already failed): the control that switches centres on shows the same symbol as
 * the marks it switches on. Asserted against `MAP_KIND_GLYPH` rather than against the string
 * `storefront`, so the day the centre glyph is restyled the mark follows it or this fails.
 *
 * `symbolName` matters for a reason `symbolName.ts` records at length: the non-iOS `SymbolView`
 * reads `name.web`, and a raw `PlatformSymbol` has no such key — a mark drawing nothing at all
 * in the browser and on Android.
 */
it('draws a centre in the filter’s own glyph', async () => {
  const t = await draw({ marks: [CENTRE] });
  expect(findSymbols(t).map((s) => s.props.name)).toEqual([CENTERS_GLYPH.ios]);
  // The tie itself, which is what stops the control and the mark drifting into two symbols.
  expect(MAP_KIND_GLYPH.centers).toBe(CENTERS_GLYPH);
});

it('reports the mark that was pressed, kind and all', async () => {
  const onSelect = jest.fn();
  const t = await draw({ marks: [...MARKS, SITE], onSelect });
  const site = markers(t)[2];
  expect(site).toBeDefined();
  (site!.props.onPress as () => void)();
  expect(onSelect).toHaveBeenCalledWith(SITE);
});

// §0.6's option-chip rule read on a map: "`surface` behind an unselected chip, `action` ink
// behind the selected one". Both halves asserted, because "the selected one is inverted" alone
// would pass for a component that inverted every mark.
it('inverts the selected mark and leaves every other mark alone', async () => {
  const styles = makeStyles('dark');
  const t = await draw({ scheme: 'dark', selected: { kind: 'mine', key: 'site:s2' } });
  const inverted = markers(t).map((m) =>
    m.queryAll((n) => stylesOf(n).includes(styles.mapMarkBadgeSelected)).length,
  );
  expect(inverted).toEqual([0, 1]);
  const label = markers(t).map((m) =>
    m.queryAll((n) => stylesOf(n).includes(styles.mapMarkBadgeLabelSelected)).length,
  );
  expect(label).toEqual([0, 1]);
});

/**
 * **A selection names a kind as well as a key, and that is not tidiness** (M3e).
 *
 * The three kinds draw together now, and their keys come from two different vocabularies: a
 * place key is `site:<id>` / `name:<fold>` / `dive:<id>`, a catalogue mark's key is the row's own
 * id, and `dive_sites` and `dive_centers` are two tables whose ids are drawn from one generator
 * but are not one namespace. A site and a centre carrying the same key is therefore reachable —
 * it is the fixture below — and a comparison on the key alone would open the wrong sheet.
 */
it('inverts only the mark whose kind AND key were selected', async () => {
  const styles = makeStyles('light');
  const t = await draw({ marks: [SITE, CENTRE], selected: { kind: 'centers', key: 'c1' } });
  expect(SITE.key).toBe(CENTRE.key);
  const inverted = markers(t).map((m) => m.queryAll((n) => stylesOf(n).includes(styles.mapMarkDotSelected)).length);
  expect(inverted).toEqual([0, 1]);
});

// **The dot's own half of that rule, which the badge test above cannot carry** (measured: the
// selected style was removed from the dot alone and every other assertion in this file stayed
// green). A community mark selects exactly as a badged one does — one vocabulary across all
// three kinds — and a selection a diver could not see would be a sheet with no visible source.
it.each([
  [null, 0],
  [{ kind: 'community', key: 'c1' } as MapMarkRef, 1],
] as const)('inverts a community dot when, and only when, it is the selected one', async (selected, expected) => {
  const styles = makeStyles('light');
  const t = await draw({ marks: [SITE], selected });
  const mark = markers(t)[0];
  expect(mark).toBeDefined();
  expect(mark!.queryAll((n) => stylesOf(n).includes(styles.mapMarkDotSelected))).toHaveLength(expected);
});

/** And the glyph inside a selected centre inverts with its disc — a `storefront` left in `fg`
 * on an `action` ground is ink on its own colour, which is a mark that vanishes at the moment a
 * diver presses it. The badge's numeral has had this covered since M2n; the glyph is new. */
it.each([
  [null, 'fg'],
  [{ kind: 'centers', key: 'c1' } as MapMarkRef, 'actionFg'],
] as const)('inverts a centre’s glyph with its disc', async (selected, token) => {
  const theme = themeFor('dark');
  const t = await draw({ scheme: 'dark', marks: [CENTRE], selected });
  expect(findSymbols(t).map((s) => s.props.tintColor)).toEqual([theme[token]]);
  expect(theme.fg).not.toBe(theme.actionFg);
});

// **The permission rule, from the one side a test can see it.** §3 spends a whole Settings row
// on iOS asking once ever, so this screen must never be what asks; the component takes the
// answer as a prop and the screen reads it without prompting (`MapScreen.test.tsx` owns that
// half). What is pinned here is that the prop is passed through rather than defaulted to `true`
// somewhere along the way — the library's own docs say this prop can raise the system sheet.
it.each([true, false])('shows the diver’s own position only when told it may (%s)', async (granted) => {
  expect(mapView(await draw({ showsUserLocation: granted })).props.showsUserLocation).toBe(granted);
});

// Apple's own points of interest are a second, denser set of marks in a palette that is not
// ours, drawn underneath the marks that are. The prop's name is plural in this library and has
// no singular sibling, so the spelling is part of the assertion.
it('turns off the map’s own points of interest', async () => {
  expect(mapView(await draw()).props.showsPointsOfInterests).toBe(false);
});

// The map takes the scheme the app resolved rather than reading the OS itself, so the two can
// never disagree — left unset the library defaults to `'system'`.
it.each(['light', 'dark'] as const)('hands the map the scheme the app resolved (%s)', async (scheme) => {
  expect(mapView(await draw({ scheme })).props.userInterfaceStyle).toBe(scheme);
});

/**
 * **Which mark wins when two land on one pixel — the defect the simulator found** (M3e).
 *
 * A dive at a catalogue site the diver never paired to it draws a badge and a dot on one
 * coordinate, and the dot went over the badge: the count vanished and the place read as somewhere
 * the diver had never been. §2 of this task's brief is that collision, and this is the half of the
 * answer that survives the case identity cannot absorb.
 *
 * **Asserted as an ORDER rather than as three numbers**, because the rule is "the mark that says
 * the most is on top" and the numbers are an implementation of it. A mocked map has no z-order at
 * all — it draws nothing — so what is carried here is only that the library was asked; that the
 * asking works is what the simulator settled.
 */
it('lifts the mark that says the most above the mark that says the least', async () => {
  const t = await draw({ marks: [MARKS[0]!, SITE, CENTRE] });
  const [place, site, centre] = markers(t).map((m) => Number(m.props.zIndex));
  expect(site).toBeLessThan(centre!);
  expect(centre).toBeLessThan(place!);
});

// ...and **selecting a mark does not move it**, which is a measurement rather than a preference:
// lifting the chosen mark was written, and on the simulator `MKMapView` did not re-sort an
// annotation view it already held (see `MARK_Z`). A prop with no effect is worse than none, so
// this pins the order as a fact about the KIND alone — a lift added back here would be red until
// somebody can show it working.
it('leaves the order alone when a mark is selected', async () => {
  const marks = [MARKS[0]!, SITE];
  const at = async (selected: MapMarkRef | null) =>
    markers(await draw({ marks, selected })).map((m) => Number(m.props.zIndex));
  expect(await at({ kind: 'community', key: SITE.key })).toEqual(await at(null));
});

/**
 * **Two marks of different kinds carrying one key are two children, not one** (M3e).
 *
 * The keys come from two vocabularies that were never one namespace — a place key, and a row id
 * from `dive_sites` or from `dive_centers` — so a site and a centre sharing a key is reachable,
 * and the annotation's React key is composed of the kind and the key for exactly that.
 *
 * **Measured, and the check had to be written a second way to be able to fail.** Dropping the
 * kind from that key left every other assertion in this file green: React renders both children
 * anyway and merely warns, so counting markers proves nothing. What it really costs is
 * reconciliation — two children React believes are one, on a list whose contents change every
 * time the diver touches a filter — and the warning is the only observable trace of it, so the
 * warning is what this asserts.
 */
it('gives two marks of different kinds two identities, however they are keyed', async () => {
  const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(SITE.key).toBe(CENTRE.key);
    const t = await draw({ marks: [SITE, CENTRE] });
    expect(markers(t)).toHaveLength(2);
    expect(warn.mock.calls.map((call) => String(call[0])).join(' ')).not.toContain('same key');
  } finally {
    warn.mockRestore();
  }
});

// The kinds are one list, and the filter on the screen is derived from it — so this is what
// makes "a fourth kind appears in the filter on its own" a fact rather than a comment.
it('names its three kinds once', () => {
  expect([...MAP_MARK_KINDS]).toEqual(['mine', 'community', 'centers']);
  expect(Object.keys(MAP_KIND_GLYPH)).toEqual([...MAP_MARK_KINDS]);
});

/**
 * **§0.1's guard for this screen, and the reason it is worth sweeping a map at all.**
 *
 * `unexpectedGraphics` reports any `View` painted with something `makeStyles(scheme)` did not
 * hand out — with one exemption for paint that IS a depth colour, added for the first-run
 * legend. That exemption is exactly what makes this sweep meaningful here rather than
 * ceremonial: a pin taking its dive's band colour would be admitted by the guard as legitimate
 * depth paint, so the sweep alone cannot say the marks are monochrome. The second expectation
 * below is what does — no style on this tree is any of the twelve palette values, and since M3e
 * that has to hold for the centre's glyph too, whose ink is a prop rather than a style and would
 * therefore have sailed past a check that only read `style`.
 *
 * Swept in both schemes, because a light-scheme sweep against a dark render reports everything
 * and a dark-scheme mistake would hide behind a light-scheme pass.
 */
it.each(['light', 'dark'] as const)('paints the marks from the sheet, and never from the depth scale (%s)', async (scheme) => {
  const t = await draw({
    scheme,
    marks: [...MARKS, SITE, CENTRE],
    selected: { kind: 'mine', key: 'site:s1' },
    showsUserLocation: true,
  });
  expect(unexpectedGraphics(t, scheme)).toEqual([]);

  const palette: readonly string[] = [...depthScale.light, ...depthScale.dark];
  const coloured = (t.root ? t.root.queryAll(() => true) : []).filter((n) =>
    stylesOf(n).some((entry) =>
      Object.values(entry as Record<string, unknown>).some(
        (value) => typeof value === 'string' && palette.includes(value),
      ),
    ),
  );
  expect(coloured).toEqual([]);
  const tinted = findSymbols(t).filter((n) => palette.includes(String(n.props.tintColor)));
  expect(tinted).toEqual([]);
  // ...and there really was a glyph on this tree to have been mis-tinted, or the line above is
  // a sweep over nothing.
  expect(findSymbols(t)).toHaveLength(1);
});

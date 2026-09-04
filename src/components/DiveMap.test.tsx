import { render, type RenderResult } from '@testing-library/react-native';

import { type MapMark } from './DiveMap';
import { DiveMap } from './DiveMap';
import { unexpectedGraphics } from '../testing/unexpectedGraphics';
import { depthScale } from '../theme/tokens';
import { makeStyles } from '../theme/styles';

/**
 * **What this suite claims, and — more usefully — what it does not.**
 *
 * `react-native-maps` is a native module on every axis (`requireNativeComponent`, plus codegen
 * calls at module scope), so it is replaced by `__mocks__/react-native-maps.js` here. **A mocked
 * map asserts almost nothing about a map.** It draws no tiles, measures no view, resolves no
 * layout and produces no gesture, so every question a reader might assume a green suite has
 * answered is still open after it.
 *
 * **What is checked below is the app's own side of the boundary** — the props Ponor hands the
 * library, which is code this repo owns and can get wrong:
 *
 *  · one mark per place, at the coordinate the domain computed;
 *  · what the badge says, and that a community mark carries none;
 *  · that pressing a mark reports that mark's key;
 *  · that the selected mark inverts and no other mark does;
 *  · that the diver's position is drawn only when the caller says the permission is granted;
 *  · that **no paint reaches a `View` from outside the stylesheet**, which is §0.1's guard for
 *    this screen and the reason `unexpectedGraphics` is swept here at all.
 *
 * **What only the simulator can settle**, and what the report for this task therefore had to
 * cover by looking: whether a mark is legible over water and over terrain in both themes,
 * whether the region actually frames the pins, whether a mark's 48 dp target is really 48 dp
 * under a thumb, and whether the map renders at all.
 *
 * The press below calls the `onPress` prop rather than going through `fireEvent`. That is
 * deliberate rather than a shortcut: on a device the press arrives from `MKMapView` selecting an
 * annotation, so a synthesised touch on a stand-in `View` would be a gesture no real user makes
 * and would prove nothing extra. The claim this carries is exactly "the handler we hand each
 * mark reports that mark's key", which is the part we wrote.
 */

const REGION = { latitude: 43.5, longitude: 16.4, latitudeDelta: 0.5, longitudeDelta: 0.5 };

const MARKS: MapMark[] = [
  { key: 'site:s1', label: 'Blue Hole', point: { latitude: 43.5, longitude: 16.4 }, badge: '4' },
  { key: 'site:s2', label: 'Shark Point', point: { latitude: 43.6, longitude: 16.5 }, badge: '1' },
];

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
  const t = await render(
    <DiveMap
      scheme="light"
      region={REGION}
      marks={MARKS}
      selectedKey={null}
      onSelect={() => {}}
      showsUserLocation={false}
    />,
  );
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
// that a symbol needing one has failed).
it('badges every mark with its own count, one included', async () => {
  const t = await render(
    <DiveMap scheme="light" region={REGION} marks={MARKS} selectedKey={null} onSelect={() => {}} showsUserLocation={false} />,
  );
  expect(markers(t).map((m) => textIn(m))).toEqual([['4'], ['1']]);
});

// A community site has no count of the diver's dives, so it shows none — a badge reading `0`
// would be a number about the wrong thing.
it('draws a community mark as a dot with nothing written in it', async () => {
  const styles = makeStyles('light');
  const t = await render(
    <DiveMap
      scheme="light"
      region={REGION}
      marks={[{ key: 'c1', label: 'Vis', point: { latitude: 43, longitude: 16 }, badge: null }]}
      selectedKey={null}
      onSelect={() => {}}
      showsUserLocation={false}
    />,
  );
  const mark = markers(t)[0];
  expect(mark).toBeDefined();
  expect(textIn(mark!)).toEqual([]);
  const dots = mark!.queryAll((n) => stylesOf(n).includes(styles.mapMarkDot));
  expect(dots).toHaveLength(1);
});

it('reports the key of the mark that was pressed', async () => {
  const onSelect = jest.fn();
  const t = await render(
    <DiveMap scheme="light" region={REGION} marks={MARKS} selectedKey={null} onSelect={onSelect} showsUserLocation={false} />,
  );
  const second = markers(t)[1];
  expect(second).toBeDefined();
  (second!.props.onPress as () => void)();
  expect(onSelect).toHaveBeenCalledWith('site:s2');
});

// §0.6's option-chip rule read on a map: "`surface` behind an unselected chip, `action` ink
// behind the selected one". Both halves asserted, because "the selected one is inverted" alone
// would pass for a component that inverted every mark.
it('inverts the selected mark and leaves every other mark alone', async () => {
  const styles = makeStyles('dark');
  const t = await render(
    <DiveMap scheme="dark" region={REGION} marks={MARKS} selectedKey="site:s2" onSelect={() => {}} showsUserLocation={false} />,
  );
  const inverted = markers(t).map((m) =>
    m.queryAll((n) => stylesOf(n).includes(styles.mapMarkBadgeSelected)).length,
  );
  expect(inverted).toEqual([0, 1]);
  const label = markers(t).map((m) =>
    m.queryAll((n) => stylesOf(n).includes(styles.mapMarkBadgeLabelSelected)).length,
  );
  expect(label).toEqual([0, 1]);
});

// **The dot's own half of that rule, which the badge test above cannot carry** (measured: the
// selected style was removed from the dot alone and every other assertion in this file stayed
// green). A community mark selects exactly as a badged one does — one vocabulary across both
// layers — and a selection a diver could not see would be a sheet with no visible source.
it.each([
  [null, 'c1'],
  ['c1', 'c1'],
] as const)('inverts a community dot when, and only when, it is the selected one', async (selectedKey, key) => {
  const styles = makeStyles('light');
  const t = await render(
    <DiveMap
      scheme="light"
      region={REGION}
      marks={[{ key, label: 'Vis', point: { latitude: 43, longitude: 16 }, badge: null }]}
      selectedKey={selectedKey}
      onSelect={() => {}}
      showsUserLocation={false}
    />,
  );
  const mark = markers(t)[0];
  expect(mark).toBeDefined();
  const inverted = mark!.queryAll((n) => stylesOf(n).includes(styles.mapMarkDotSelected)).length;
  expect(inverted).toBe(selectedKey === null ? 0 : 1);
});

// **The permission rule, from the one side a test can see it.** §3 spends a whole Settings row
// on iOS asking once ever, so this screen must never be what asks; the component takes the
// answer as a prop and the screen reads it without prompting (`MapScreen.test.tsx` owns that
// half). What is pinned here is that the prop is passed through rather than defaulted to `true`
// somewhere along the way — the library's own docs say this prop can raise the system sheet.
it.each([true, false])('shows the diver’s own position only when told it may (%s)', async (granted) => {
  const t = await render(
    <DiveMap scheme="light" region={REGION} marks={MARKS} selectedKey={null} onSelect={() => {}} showsUserLocation={granted} />,
  );
  expect(mapView(t).props.showsUserLocation).toBe(granted);
});

// Apple's own points of interest are a second, denser set of marks in a palette that is not
// ours, drawn underneath the marks that are. The prop's name is plural in this library and has
// no singular sibling, so the spelling is part of the assertion.
it('turns off the map’s own points of interest', async () => {
  const t = await render(
    <DiveMap scheme="light" region={REGION} marks={MARKS} selectedKey={null} onSelect={() => {}} showsUserLocation={false} />,
  );
  expect(mapView(t).props.showsPointsOfInterests).toBe(false);
});

// The map takes the scheme the app resolved rather than reading the OS itself, so the two can
// never disagree — left unset the library defaults to `'system'`.
it.each(['light', 'dark'] as const)('hands the map the scheme the app resolved (%s)', async (scheme) => {
  const t = await render(
    <DiveMap scheme={scheme} region={REGION} marks={MARKS} selectedKey={null} onSelect={() => {}} showsUserLocation={false} />,
  );
  expect(mapView(t).props.userInterfaceStyle).toBe(scheme);
});

/**
 * **§0.1's guard for this screen, and the reason it is worth sweeping a map at all.**
 *
 * `unexpectedGraphics` reports any `View` painted with something `makeStyles(scheme)` did not
 * hand out — with one exemption for paint that IS a depth colour, added for the first-run
 * legend. That exemption is exactly what makes this sweep meaningful here rather than
 * ceremonial: a pin taking its dive's band colour would be admitted by the guard as legitimate
 * depth paint, so the sweep alone cannot say the marks are monochrome. The second expectation
 * below is what does — no style on this tree is any of the twelve palette values.
 *
 * Swept in both schemes, because a light-scheme sweep against a dark render reports everything
 * and a dark-scheme mistake would hide behind a light-scheme pass.
 */
it.each(['light', 'dark'] as const)('paints the marks from the sheet, and never from the depth scale (%s)', async (scheme) => {
  const t = await render(
    <DiveMap scheme={scheme} region={REGION} marks={MARKS} selectedKey="site:s1" onSelect={() => {}} showsUserLocation />,
  );
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
});

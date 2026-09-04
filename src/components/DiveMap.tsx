import MapView, { Marker } from 'react-native-maps';
import { Text, View } from 'react-native';

import { type MapPoint, type MapRegion } from '../domain/mapSites';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/** One mark on the map. `badge` is the dive count for a place of the diver's own, and `null`
 * for a community site — see `DiveMap` below on why those are two shapes and not one. */
export interface MapMark {
  key: string;
  /** What a screen reader announces, and what the sheet beneath is titled. A mark carries no
   * visible name — a bay with nine sites in it would be nine overlapping labels — so this is
   * the only thing that names it, exactly as `CapsuleAction.label` is for a bare glyph. */
  label: string;
  point: MapPoint;
  badge: string | null;
}

export interface DiveMapProps {
  scheme: ColorScheme;
  /** Where the map opens. Computed by `regionFor` (domain/mapSites.ts) from the marks
   * themselves, never guessed here — see that function for why it is a region and not a
   * `fitToCoordinates` call on a ref. */
  region: MapRegion;
  marks: readonly MapMark[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /**
   * Whether to draw the diver's own position.
   *
   * **The caller decides, and it must decide from a READ rather than an ask** (`platform/
   * locationPermission.ts`, §4.1's owner, which keeps `locationPermission` — the read — apart
   * from `requestLocationPermission` — the ask). DESIGN.md §3 and M2m spend a whole Settings
   * row on the fact that iOS raises its permission sheet once ever; a map that prompted merely
   * by being opened would spend that one sheet on a screen nobody tapped a location control on.
   * Showing the blue dot is a nicety, and a nicety never gets to ask.
   */
  showsUserLocation: boolean;
}

/**
 * **The map surface** (DESIGN.md §3's Map tab) — Apple's cartography with Ponor's marks on it,
 * and nothing else.
 *
 * ── The one design question this screen had that no other screen has ──────────────────────
 *
 * §0.1 spends every hue in the app on depth. **A map is made of colour**, and the marks on it
 * are ours. So: does a dive's pin take its depth band's colour? It would be the one place where
 * §0.1's rule and the map's own nature agree — a pin's hue would mean exactly what a depth
 * figure's hue means everywhere else.
 *
 * **It does not, and three separate reasons each settle it on their own.**
 *
 * 1. **Every mark here is a set, and §0.6 already ruled on a set.** §3's unit on this screen is
 *    the *site*, badged with a count — so the common mark stands for four dives at four depths.
 *    The Dives header's `deepest 41.2 m` takes no band colour for exactly this reason: *"any
 *    one band would be a claim about a set that no band is true of"*. Colouring only the marks
 *    that happen to hold one dive would be worse than either answer, because hue would then
 *    encode **how many dives are here**, which is not depth and is not anything.
 * 2. **§0.1's guarantee is redundancy, and a map has nowhere to put the number.** *"Depth is
 *    always redundantly encoded by the number itself, so the scale never carries meaning on
 *    its own: colour-blind safe, and legible in glare."* Every coloured thing in Ponor sits
 *    beside its own figure. A coloured pin at map scale would be the first place in the app
 *    where hue carries information alone — the property §0.1 exists to guarantee the app never
 *    has, given up on the one screen a diver uses in the sun on a deck.
 * 3. **Two of the six bands are the colour of the sea.** Band 5 and band 6 are `#2E9BE0` and
 *    `#6673E4` in dark, `#0B76B8` and `#3A49C0` in light, and most dive sites are pins on
 *    water. That was looked at rather than reasoned about; the report for this task has what
 *    the screenshots showed.
 *
 * A fourth option was considered and rejected rather than missed: **colour a site only when all
 * its dives fall in one band**, which is the "claim that is true of the set" version. It makes
 * the *absence* of colour mean "mixed depths" — a second meaning for plain ink, indistinguishable
 * from the monochrome the rest of the app is drawn in — and a site's colour would silently drain
 * away the day a diver went 2 m deeper there. Recorded because §10's convention is that a
 * rejected option is named, not because it was close.
 *
 * **So the depth palette is on this screen exactly where it is on every other one: beside a
 * number.** Tap a site and its dives are `DiveRow`s, each with its own depth in its own band.
 * The marks are the app's existing two-state ink — `surface` behind an unselected mark, `action`
 * ink behind the selected one, which is §0.6's own option-chip rule ("the chosen thing is the
 * inverted thing") applied to a map. Nothing new was invented for this screen.
 *
 * ── What this component's tests can and cannot claim ──────────────────────────────────────
 *
 * `react-native-maps` is mocked under Jest (`__mocks__/react-native-maps.js`) and **a mocked map
 * asserts almost nothing**. What the suite beside this file really carries is the app's side of
 * the boundary: which coordinate each mark is given, what its badge says, that pressing one
 * reports the right key, that the selected mark inverts, and that no paint outside the sheet
 * reaches a `View`. What it cannot carry, and what the simulator pass is for: that the marks are
 * legible over water and terrain in both themes, that the region actually frames the pins, that
 * a mark's 48 dp target (§0.5) is really 48 dp on a device, and that the map renders at all.
 *
 * **The browser gets `DiveMap.web.tsx` instead**, and that is not a nicety either: importing
 * this module in a web bundle is a hard crash. `react-native-maps`' `index.ts` pulls in
 * `MapMarkerNativeComponent`, which calls `codegenNativeCommands` at module scope, and
 * `react-native-web` exports no such function — so the failure is a `TypeError` while the module
 * is being evaluated, not a component that renders nothing. DESIGN.md §9 already records the
 * gap ("`react-native-maps` has no web support, so M2's Map tab will not render there"); the
 * `.web` sibling is what turns it from a crash into a sentence.
 */
export function DiveMap({ scheme, region, marks, selectedKey, onSelect, showsUserLocation }: DiveMapProps) {
  const styles = makeStyles(scheme);
  return (
    <MapView
      style={styles.mapSurface}
      initialRegion={region}
      // **The map follows the theme the app resolved, not the one it would resolve itself.**
      // Left unset this defaults to `'system'`, which reads the OS directly — the same answer
      // today, and one that would drift the moment anything in Ponor lets a diver pick a scheme.
      // `resolveScheme` is the app's one reading of light-or-dark and this is that reading
      // applied to the one surface that would otherwise have its own.
      userInterfaceStyle={scheme}
      // §3's Map tab is about the diver's own dives and the community's sites. Apple's own
      // points of interest are a second, denser set of marks in a palette that is not ours,
      // sitting under the marks that are — so they are off, for the same reason §0.1 keeps
      // everything else on screen monochrome.
      //
      // **`showsPointsOfInterests`, plural**, which is the library's own spelling and not a
      // typo here: `MapViewProps` declares `showsPointsOfInterests` and has no singular
      // sibling. Written singular it is simply not a prop of this component — `tsc` catches
      // that, which is the only reason to say so, since the same slip in a plain JSX file
      // would have left the POIs on and nothing would have reported it.
      showsPointsOfInterests={false}
      // **Never asked for, only reported** — see the prop's own docblock above. The library's
      // own documentation for this prop says it "will cause iOS to ask for location
      // permissions"; modern MapKit does not, and it does not matter which is right, because
      // the caller only ever passes `true` when the standing permission has already been READ
      // as granted. There is no state in which this prop is set and a sheet could still appear.
      showsUserLocation={showsUserLocation}
      // The compass appears while the map is rotated and is the platform's own control, in the
      // platform's own material — the same category as the pull-to-refresh spinner §0.6 allows
      // and the destructive dialog §10 keeps: chrome the app does not draw.
      showsCompass
    >
      {marks.map((mark) => {
        const selected = mark.key === selectedKey;
        return (
          <Marker
            key={mark.key}
            coordinate={mark.point}
            onPress={() => onSelect(mark.key)}
            // The mark is drawn by this app, so the platform's own red teardrop — a hue nobody
            // here chose, sitting inside the depth scale's own range — is replaced rather than
            // tinted. A `Marker` with children renders them instead of its default pin.
            //
            // **`tracksViewChanges` is left at its default `true` on purpose.** Setting it false
            // is the standard cure for hundreds of custom markers, and it also freezes the
            // snapshot: a mark would keep the ink it had when it was first drawn and would not
            // invert when selected. A personal logbook is tens of sites (§4's own reason for
            // computing the clustering rather than adding a library), so the cost is not one
            // this screen pays and the correctness is.
            accessibilityRole="button"
            accessibilityLabel={mark.label}
          >
            {/* §0.5's 48 dp floor as a real box rather than `hitSlop`, exactly as
                `capsuleGlyph` (theme/styles.ts) does for a capsule's glyph: the visible mark is
                small so a map of nine sites is readable, and the thing a wet thumb has to hit
                is not. */}
            <View style={styles.mapMarkTarget}>
              {mark.badge === null ? (
                // **A community site has no number to show, so it shows none.** §3 badges a
                // count "per site" of *your* dives; a catalogue site the diver has never been
                // to has no count, and a badge reading `0` — or worse, a mark carrying the
                // site's name at map scale — would be saying something the layer does not know.
                // The two layers never draw at once (the capsule is a toggle, not a filter),
                // so a dot and a badge are never on screen together to be told apart.
                <View style={[styles.mapMarkDot, selected && styles.mapMarkDotSelected]} />
              ) : (
                <View style={[styles.mapMarkBadge, selected && styles.mapMarkBadgeSelected]}>
                  <Text style={[styles.mapMarkBadgeLabel, selected && styles.mapMarkBadgeLabelSelected]}>
                    {mark.badge}
                  </Text>
                </View>
              )}
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
}

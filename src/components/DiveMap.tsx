import { SymbolView } from 'expo-symbols';
import MapView, { Marker } from 'react-native-maps';
import { Text, View } from 'react-native';

import { type MapPoint, type MapRegion } from '../domain/mapSites';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { themeFor } from '../theme/resolve';
import { symbolName, type PlatformSymbol } from './symbolName';

/**
 * **The three kinds of thing this map draws**, as a list with the type derived from it rather
 * than written twice (§4.1's "derive, or tie at compile time").
 *
 * It lives here rather than on the screen because a *kind* is a mark vocabulary and this file
 * owns what a mark is; `MapScreen`'s filter is derived from this list, so a fourth kind would be
 * one entry here and would appear in the filter on its own.
 */
export const MAP_MARK_KINDS = ['mine', 'community', 'centers'] as const;
export type MapMarkKind = (typeof MAP_MARK_KINDS)[number];

/**
 * **One glyph per kind — the filter's, and the centre mark's** (M3e).
 *
 * The three were `MapScreen`'s until the layers became a filter, and they moved here for the
 * reason that made the filter possible at all: a centre's mark carries `centers`' glyph, so the
 * control that switches centres on and the mark it switches on **must** be the same symbol.
 * Written twice they would agree today and drift the day either is restyled, and the drift would
 * take the map's only legend with it (§4.1's "derive, or tie"). Keyed by `MapMarkKind`, so a
 * fourth kind fails the build here rather than arriving as a blank capsule glyph.
 *
 * Exported individually as well because `symbolName.test.tsx` checks each Android half against a
 * real Material name — see `DivesScreen`'s two for why no suite that renders a whole screen can.
 */
export const MY_DIVES_GLYPH = { ios: 'mappin.and.ellipse', android: 'pin_drop' } as const;
export const EXPLORE_GLYPH = { ios: 'globe', android: 'public' } as const;
export const CENTERS_GLYPH = { ios: 'storefront', android: 'storefront' } as const;

export const MAP_KIND_GLYPH: Record<MapMarkKind, PlatformSymbol> = {
  mine: MY_DIVES_GLYPH,
  community: EXPLORE_GLYPH,
  centers: CENTERS_GLYPH,
};

/** What names one mark, everywhere it is spoken about. Two fields rather than one string,
 * because the three kinds share a key space now that they are drawn together — a catalogue
 * site's row id and a place key are different vocabularies and a bare string could not say
 * which one a selection came from. */
export interface MapMarkRef {
  kind: MapMarkKind;
  key: string;
}

/**
 * One mark on the map.
 *
 * **A discriminated union, so a mark's interior cannot disagree with what it is** — only the
 * diver's own place carries a count, and `badge` exists on no other member rather than being a
 * nullable field every kind has to remember to leave null.
 */
export type MapMark = MapMarkRef & {
  /** What a screen reader announces, and what the sheet beneath is titled. A mark carries no
   * visible name — a bay with nine sites in it would be nine overlapping labels — so this is
   * the only thing that names it, exactly as `CapsuleAction.label` is for a bare glyph. Since
   * M3e it also has to name the **kind**, because three kinds are on one map at once and the
   * glyph that tells them apart by eye tells a screen reader nothing (`format/display.ts` owns
   * the words). */
  label: string;
  point: MapPoint;
} & ({ kind: 'mine'; badge: string } | { kind: 'community' } | { kind: 'centers' });

export interface DiveMapProps {
  scheme: ColorScheme;
  /** Where the map opens. Computed by `regionFor` (domain/mapSites.ts) from the marks
   * themselves, never guessed here — see that function for why it is a region and not a
   * `fitToCoordinates` call on a ref. */
  region: MapRegion;
  marks: readonly MapMark[];
  selected: MapMarkRef | null;
  onSelect: (mark: MapMark) => void;
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
 *
 * ── What a mark is, and what it is not (M3c) ──────────────────────────────────────────────
 *
 * Each mark used to sit inside a transparent 48 dp box, on `capsuleGlyph`'s pattern, so §0.5's
 * tap floor could be met without drawing a mark that size. **On a device that buys nothing**: an
 * `MKAnnotationView` is hit-tested over the mark it actually draws, so the 14 pt community dot
 * could not be pressed at all — found by being the first task with a catalogue row positioned to
 * tap, and confirmed by growing the dot until it answered. So the box is gone, both marks are
 * 26 pt (`mapMarkBadge`/`mapMarkDot`), and the size of the mark IS the target. A mocked map could
 * never have said so: it measures no view and produces no gesture.
 *
 * ── Three kinds on one map, and the one lever left to tell them apart (M3e) ────────────────
 *
 * §3's layers became a filter, so a diver can have their dives, the community's sites and the
 * community's centres drawn at once. **§0.1 leaves no hue to separate them and M3c has already
 * spent plain shape**: it built a disc beside a square, looked at both themes, and found that at
 * map scale a square reads as the same mark drawn slightly wrong, and that two overlapping
 * squares read as one stacked card. What §3 leaves is *ink weight or an inner glyph*.
 *
 * **So: one disc, one ink, three interiors.** The shape never varies, which turns M3c's second
 * finding into an asset — with a single shape an overlap is self-evidently two marks — and the
 * interior says what the mark is:
 *
 *  · **your dives** carry a NUMERAL, which they already did (§3's "badge = count per site"), and
 *    a figure is not a symbol needing a legend: it is the count itself;
 *  · **a dive centre** carries the `storefront` glyph, **the same glyph the filter control uses
 *    to switch centres on** — which is §0.6's "a symbol that needs a legend has already failed"
 *    answered rather than dodged: the legend is the control, one press away, in the same 19 pt
 *    ink, and turning the filter off makes every mark carrying that glyph disappear;
 *  · **a community site** carries NOTHING, and stays exactly the dot M2n drew and M3c measured.
 *
 * The empty interior is the one that had to be argued for, because §0.6 has twice ruled that a
 * mark whose meaning is an absence is a legend — M2n refused a bare mark for a single dive for
 * precisely that reason. It is admitted here on a different ground: a **dive site is what this
 * map is of**. A shop is the exception (§3: a centre is not a place you get into the water) and a
 * count is the diver's own, so the unmarked mark is the subject rather than a third code — and
 * the alternative, a third glyph, spends a symbol at 13 pt on the most common mark on the screen.
 * The other arrangement was drawn and looked at; the report for this task says what it showed.
 *
 * **A tap does not mean the same thing on all three**, and since M3e the MARK has to carry that
 * rather than the layer: a centre goes to its page and the other two open a sheet. M3c gave the
 * asymmetry to the layer on the grounds that "a diver never has to work out which kind of thing
 * they are about to press"; the glyph is what pays for that now, which is the second job it does.
 */

/** A mark sits on its coordinate by its middle — see the `anchor` prop below. Hoisted out of
 * the render so the object identity is stable across renders rather than a new one per mark. */
const MARK_ANCHOR = { x: 0.5, y: 0.5 } as const;

/**
 * The centre glyph's drawn size inside its 26 pt disc. Smaller than the capsule's 19 pt for the
 * obvious reason — the disc is half the capsule's height — and settled by looking rather than by
 * arithmetic, since what matters is whether an awning reads over Apple's cartography at all.
 */
const MARK_GLYPH_SIZE = 14;

/**
 * **Which mark wins when two land on one pixel** (M3e), and the rule is: **the one that says the
 * most is on top, so an overlap can only ever hide the mark that says the least.**
 *
 * This is a defect the simulator found and nothing else could have. A dive at a catalogue site
 * the diver never paired — a site typed by hand, or one another diver surveyed at the same rock —
 * draws a badge and a dot on the same coordinate, and the dot went **over** the badge: the count
 * disappeared completely and the place read as somewhere the diver had never been. A mocked map
 * has no z-order and would never have said so.
 *
 * Ordered by how much each interior carries. A place's badge holds a figure that exists nowhere
 * else on the screen. A centre's glyph says which catalogue it is from, and a centre hidden under
 * a plain dot is worse than the reverse, because it then reads as a *site* — the one confusion §3
 * says this map may not create. A community site's dot means "a catalogue row is here", which any
 * visible ring already says, so it is the one that can afford to be behind.
 *
 * **`zIndex` rather than the order of the children**, because `MKMapView` reorders annotations as
 * it pleases — the library maps this onto `zPriority` and `layer.zPosition` (AIRMapMarker.m), and
 * that is the only thing on iOS that holds.
 *
 * **A selected mark is deliberately NOT lifted, and that was measured rather than decided.** The
 * obvious extra — add a constant to the chosen mark's `zIndex`, so the mark a diver has just
 * pressed is the one they can see — was written, run on the simulator, and **had no effect**:
 * two coincident badges kept the order they were first drawn in while the sheet below described
 * the one behind. Selection itself repaints (an isolated dot inverts to solid ink in the same
 * frame), so the re-render happens; what does not happen is `MKMapView` re-sorting an annotation
 * view it already holds. The line is gone rather than left in as a claim nothing could support —
 * and the cost is small, because a mark that is *fully* covered cannot be pressed in the first
 * place, so the case only ever arises for a mark whose visible crescent inverts anyway.
 */
const MARK_Z: Record<MapMarkKind, number> = { community: 1, centers: 2, mine: 3 };

export function DiveMap({ scheme, region, marks, selected, onSelect, showsUserLocation }: DiveMapProps) {
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);
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
        // **Both halves compared, because three kinds share one key space** (M3e): a place key
        // and a catalogue row's id are different vocabularies and a bare string could name a
        // mark of the wrong kind. `key` alone was enough while one layer drew at a time.
        const chosen = selected !== null && selected.kind === mark.kind && selected.key === mark.key;
        return (
          <Marker
            key={`${mark.kind}:${mark.key}`}
            coordinate={mark.point}
            onPress={() => onSelect(mark)}
            // **The mark's CENTRE is the coordinate, said rather than assumed** (M3c). Without
            // this, an annotation's position moves when the mark's size changes — measured:
            // taking the transparent 48 dp wrapper off shifted every mark on screen by about
            // half the difference, which means the marks were never sitting where the comment
            // said they were. An explicit anchor makes a mark's place a fact about its
            // coordinate rather than a consequence of its size.
            anchor={MARK_ANCHOR}
            // Which mark wins an overlap — see `MARK_Z` above for the defect this fixes and why
            // it cannot be done with the order of the children.
            zIndex={MARK_Z[mark.kind]}
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
            {/* No wrapper: the mark is the annotation, and the annotation is the tap target —
                see this file's own note above for the measurement that settled it.

                One disc, three interiors, and the switch is on the mark's own `kind` rather than
                on whether some field happens to be null — which is what the union above buys:
                a community site cannot acquire a badge and a place cannot lose one. */}
            {mark.kind === 'mine' ? (
              <View style={[styles.mapMarkBadge, chosen && styles.mapMarkBadgeSelected]}>
                <Text style={[styles.mapMarkBadgeLabel, chosen && styles.mapMarkBadgeLabelSelected]}>
                  {mark.badge}
                </Text>
              </View>
            ) : (
              // **A catalogue row has no number to show, so it shows none.** §3 badges a count
              // "per site" of *your* dives; a row the diver has never been to has no count, and
              // a badge reading `0` — or worse, a mark carrying the row's name at map scale —
              // would be saying something the catalogue does not know.
              <View style={[styles.mapMarkDot, chosen && styles.mapMarkDotSelected]}>
                {/* And a centre says which kind of row it is, in the filter's own glyph. A
                    community site draws nothing here — see this file's note above for why the
                    unmarked mark is the site rather than a third symbol. */}
                {mark.kind === 'centers' && (
                  <SymbolView
                    name={symbolName(CENTERS_GLYPH)}
                    size={MARK_GLYPH_SIZE}
                    tintColor={chosen ? theme.actionFg : theme.fg}
                  />
                )}
              </View>
            )}
          </Marker>
        );
      })}
    </MapView>
  );
}

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
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
  /**
   * **Where the camera is, reported whenever that changes** — when the map opens, when the diver's
   * pan or pinch comes to rest, and when a `moveTo` has finished flying.
   *
   * The screen needs this and cannot derive it: the refit rule (`refitRegion`, domain/mapSites.ts)
   * turns on whether a newly switched-on kind is *in view*, and after a pan the only thing that
   * knows what is in view is the map. It is reported at mount as well as after a gesture, so the
   * screen's idea of the camera is never older than the map itself — the map is torn down and
   * rebuilt whenever the last mark goes away, and the one that comes back is somewhere else.
   *
   * Wired to `onRegionChangeComplete` rather than `onRegionChange`: the latter fires continuously
   * through a gesture, which would be an update per frame of every drag for an answer that is only
   * ever read when a switch is pressed.
   */
  onRegionSettled: (region: MapRegion) => void;
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
 * **What a caller may ask this map to DO, as opposed to what it may ask it to show** — one verb,
 * and it exists because a camera move is an event rather than a state (M3l).
 *
 * The alternative was tried first and is worth recording: a `moveTo: MapRegion | null` prop, with
 * an effect in here reacting to it changing. It reads more like the rest of this file and it is
 * wrong on two counts. The screen would have to hold a *command* in `useState` and therefore set
 * that state from an effect, which is the cascading-render shape the linter refuses outright; and
 * a standing value survives the map that earned it, so a `MapView` rebuilt after the last mark
 * went away would mount holding a refit computed for a map that no longer exists and fly off the
 * region it had just opened on. A call happens once, to whatever map exists at the time, and is
 * dropped on the floor when there is none — which is exactly the right behaviour in that case,
 * since a map that is about to mount opens on `regionFor` already.
 */
export interface DiveMapHandle {
  /**
   * Fly the camera to a region. **The screen decides whether and where** (`refitRegion`,
   * domain/mapSites.ts, which owns the rule and the judgement in it); this carries it out.
   */
  moveTo: (region: MapRegion) => void;
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
 * The marks are drawn in the app's own two inks and in nothing else — `surface` and `fg`, one way
 * round or the other — and a mark that can be chosen takes §0.6's own option-chip treatment for
 * saying so ("the chosen thing is the inverted thing") applied to a map. No colour was invented
 * for this screen.
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
 * **The camera is the one place that split had to be drawn again** (M3l). The mock models where
 * the camera IS — `initialRegion` until an `animateToRegion` or a settled region moves it — which
 * is bookkeeping of this app's own commands rather than a layout answer, so the suite can say that
 * a `moveTo` puts the map somewhere else and that a recomputed `region` does not. What it cannot
 * say is anything about the flight: that `REFIT_MS` reads as a movement rather than a teleport,
 * that the frame it lands on is legible at that zoom, or that a mark inside the rectangle is a
 * mark a diver can actually see. Those were looked at.
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
 * ── Three kinds on one map, and the one lever left to tell them apart ──────────────────────
 *
 * §3's layers became a filter, so a diver can have their dives, the community's sites and the
 * community's centres drawn at once. **§0.1 leaves no hue to separate them and M3c has already
 * spent plain shape**: it built a disc beside a square, looked at both themes, and found that at
 * map scale a square reads as the same mark drawn slightly wrong, and that two overlapping
 * squares read as one stacked card. What §3 leaves is *ink weight or an inner glyph*.
 *
 * **M3e spent the inner glyph alone — one disc, one ink, three interiors — and the owner found
 * it did not work by using it** (M3k): *"map markers are all same/similar and user have no idea,
 * which one is dive log, site or center."* §3 now carries the diagnosis and it is worth keeping
 * here, because it is the reason this file's design is what it is:
 *
 *  · **a community site was distinguished by having no interior at all**, and an absence is not
 *    a mark — the weakest signal available, on the most common row in the catalogue;
 *  · **§0.6's "a symbol that needs a legend has already failed" was answered by putting the
 *    legend one press away**, inside the filter control. That is a legend.
 *
 * **So: one disc, TWO ink weights, and the interior left carrying one distinction instead of
 * three.** The shape still never varies, which is the half of M3e that held — with a single
 * shape an overlap is self-evidently two marks (M3c's second finding turned into an asset):
 *
 *  · **a community site** is the disc drawn SOLID — `fg` behind a `surface` hairline, the
 *    outlined disc with its ink and its ground swapped (`mapMarkDotFilled`, theme/styles.ts).
 *    It carries nothing inside, and now it does not have to: **the fill is the mark**, not the
 *    absence. A filled disc against an outlined one is visible before anything inside either of
 *    them is, which is the property no interior can have at 26 pt over cartography;
 *  · **your dives** carry a NUMERAL in the outlined disc, which they already did (§3's "badge =
 *    count per site"), and a figure is not a symbol needing a legend: it is the count itself;
 *  · **a dive centre** carries the `storefront` glyph in the outlined disc.
 *
 * **Which pair the interior is left to separate was chosen, not left over.** §3 names one
 * confusion this map may not create — *a centre reading as a site*, because a shop is not a place
 * you get into the water — so that pair gets the strongest lever there is and is told apart
 * before either interior is read at all. What the interior separates is **your own dives from a
 * centre**, where the two marks are a digit and a shop, both of them drawn things, and where
 * being wrong costs a diver a page instead of a rock. The glyph is still the filter control's own
 * symbol (`MAP_KIND_GLYPH`), which is worth keeping for the reason M3e gave — turn centres off
 * and every mark carrying it disappears — but it is no longer being asked to be the legend, and
 * this vocabulary does not need one.
 *
 * **The filled mark has no selected form, and that is why IT is the kind that is filled.** §0.1
 * leaves exactly one lever for "this one is chosen" and it is inverted ink, but `action` **is**
 * `fg` in both themes (§0.2) — so a mark already at full ink has nothing left to invert into.
 * M2n measured the identical thing one axis over ("a coloured fill has no ink left to say
 * selected"). Since M3f a catalogue row's mark **navigates to its page** and is never selected,
 * so a community mark can spend the fill without spending the state; the two marks that can be
 * chosen — a place of the diver's own, and a centre, which keeps its outlined disc for exactly
 * this reason — keep `selectedFill`'s inversion intact.
 *
 * **A tap does not mean the same thing on all three**, and since M3e the MARK has to carry that
 * rather than the layer: a catalogue row goes to its page and the diver's own dives open a sheet.
 * M3c gave the asymmetry to the layer on the grounds that "a diver never has to work out which
 * kind of thing they are about to press"; the numeral is what pays for that now — the mark that
 * opens a sheet is the one wearing a count.
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
 * Ordered by how much each mark carries. A place's badge holds a figure that exists nowhere else
 * on the screen. A centre's glyph says which catalogue it is from. A community site says "a
 * catalogue row is here", which its own visible crescent still says under anything drawn over it,
 * so it is the one that can afford to be behind.
 *
 * **M3k moved one word of this and left the order alone.** The reason the centre was above the
 * site was that "a centre hidden under a plain dot reads as a *site*" — the one confusion §3 says
 * this map may not create. That failure is now impossible in that direction: a site is drawn
 * SOLID and a centre OUTLINED, so a partly covered centre shows a hollow crescent, which is not
 * what a site looks like. The order still holds on its own terms — the mark that says the most is
 * on top — and it now also fixes the case M3e recorded and could not fix, where three shops in one
 * bay drew as a stack and the two behind read as plain rings.
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

/**
 * How long a refit takes, in milliseconds.
 *
 * **Animated rather than instant, and that is the whole point of using `animateToRegion` over
 * `setRegion`.** A camera that teleports leaves a diver holding a map of somewhere else with no
 * account of how they got there; a camera that flies says *the map moved, and this is where from*.
 * The move is one a diver did not ask for in so many words — they pressed a switch, not a
 * coordinate — so it has to be legible as a move.
 */
const REFIT_MS = 400;

export const DiveMap = forwardRef<DiveMapHandle, DiveMapProps>(function DiveMap(
  { scheme, region, onRegionSettled, marks, selected, onSelect, showsUserLocation },
  handle,
) {
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);
  /**
   * **The one ref on the map itself, and it is here rather than on the screen** (M3l).
   *
   * M2n chose a computed `initialRegion` over `fitToCoordinates` precisely so that the Map screen
   * would need no ref — *"an imperative call on a ref after layout means a frame of some other
   * region first"*. That reasoning is untouched and is why `region` is still what the map OPENS
   * on: a pure function of the pins, applied before the first frame. What it never covered is a
   * camera move **after** mount, which `initialRegion` cannot express at all — the prop is read
   * once and every later value of it is ignored, which is exactly how the header came to count
   * marks the map was not showing.
   *
   * So the ref buys the one thing a prop cannot, and buys nothing else: no reading of the camera,
   * no `fitToCoordinates`, no measurement. Where to move is still computed purely, off this
   * component, by `refitRegion`.
   */
  const map = useRef<MapView | null>(null);
  useImperativeHandle(handle, () => ({ moveTo: (to) => map.current?.animateToRegion(to, REFIT_MS) }), []);
  /**
   * **Where the map opened, handed to the caller once.**
   *
   * A real `MKMapView` reports its region for itself once it has laid out, so this is not a fact
   * being invented — it is the same fact, delivered a frame earlier and without depending on the
   * platform to volunteer it. It matters because the map is **rebuilt** whenever the last mark
   * goes away, and a caller left holding the region of a map that no longer exists would judge the
   * next switch against a rectangle from a different place.
   *
   * One ref does both halves — it holds the region to report, and being emptied is what records
   * that it has been — so an unstable `onRegionSettled` cannot make this fire twice and stamp a
   * stale opening region over a camera the diver has since moved.
   */
  const opened = useRef<MapRegion | null>(region);
  useEffect(() => {
    const at = opened.current;
    if (at === null) return;
    opened.current = null;
    onRegionSettled(at);
  }, [onRegionSettled]);
  return (
    <MapView
      ref={map}
      style={styles.mapSurface}
      initialRegion={region}
      // Where the camera came to rest, handed back to the screen — `…Complete`, so it is one
      // update at the end of a gesture rather than one per frame of it (see the prop's docblock).
      onRegionChangeComplete={onRegionSettled}
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

                One disc, two ink weights, and the switch is on the mark's own `kind` rather than
                on whether some field happens to be null — which is what the union above buys:
                a community site cannot acquire a badge and a place cannot lose one. */}
            {mark.kind === 'mine' ? (
              <View style={[styles.mapMarkBadge, chosen && styles.mapMarkBadgeSelected]}>
                <Text style={[styles.mapMarkBadgeLabel, chosen && styles.mapMarkBadgeLabelSelected]}>
                  {mark.badge}
                </Text>
              </View>
            ) : mark.kind === 'centers' ? (
              // **A catalogue row has no number to show, so it shows none.** §3 badges a count
              // "per site" of *your* dives; a row the diver has never been to has no count, and
              // a badge reading `0` — or worse, a mark carrying the row's name at map scale —
              // would be saying something the catalogue does not know. A centre says which kind
              // of row it is with the filter's own glyph instead, in the outlined disc it keeps
              // so that `selectedFill` still has somewhere to invert into.
              <View style={[styles.mapMarkDot, chosen && styles.mapMarkDotSelected]}>
                <SymbolView
                  name={symbolName(CENTERS_GLYPH)}
                  size={MARK_GLYPH_SIZE}
                  tintColor={chosen ? theme.actionFg : theme.fg}
                />
              </View>
            ) : (
              // **A community site: the same disc, drawn solid, and nothing inside it** (M3k).
              // The fill is what says which kind this is — see this file's note above for why an
              // empty interior could not, and why the kind that navigates is the kind that can
              // afford to be drawn at full ink. `chosen` is deliberately not read here: there is
              // no darker ink to move to, and no press on this map can produce the state.
              <View style={[styles.mapMarkDot, styles.mapMarkDotFilled]} />
            )}
          </Marker>
        );
      })}
    </MapView>
  );
});

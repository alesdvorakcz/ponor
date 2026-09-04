import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionCapsule, type CapsuleAction } from '../components/ActionCapsule';
import { DiveMap, type MapMark } from '../components/DiveMap';
import { DiveRow } from '../components/DiveRow';
import { type PlatformSymbol } from '../components/symbolName';
import { useAuthSession } from '../cloud/useAuthSession';
import { useDives } from '../db/useDives';
import { CATALOGUE_UNREADABLE, LOGBOOK_UNREADABLE } from '../domain/logbook';
import { useDiveCenters } from '../db/useDiveCenters';
import { useDiveSites } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { logbookStats } from '../domain/logbookStats';
import {
  groupDivesByPlace,
  regionFor,
  waterTempRange,
  withPoints,
  type MapSite,
} from '../domain/mapSites';
import { type DiveCenter, type DiveSite } from '../domain/types';
import {
  formatCenterCount,
  formatCentersSummary,
  formatCommunitySummary,
  formatMyDivesSummary,
  formatSiteFacts,
  formatSiteSummary,
  UNNAMED_CENTER,
  UNNAMED_SITE,
} from '../format/display';
import { useForegroundReturn } from '../hooks/useForegroundReturn';
import { locationPermission } from '../platform/locationPermission';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset } from '../theme/styles';

/**
 * **The three layers §3's toggle switches between**, as a list with the type derived from it
 * rather than written twice (§4.1's "derive, or tie at compile time").
 *
 * One at a time, never both. A filter that could show the diver's dives and the community's
 * sites together would put two mark vocabularies on one map — a badge that counts your dives
 * beside a dot that counts nothing — and a diver would have to learn which was which. §3 says
 * *"toggle to explore"*, and exploring is a mode.
 *
 * ── Why centres are a THIRD MODE and not a second mark on the community layer (M3c) ───────
 *
 * The question was open and both answers were built and looked at; the report for this task has
 * what the simulator showed. Four things decided it, and the first is that **the rule was
 * already written here**: the paragraph above rejects two mark vocabularies on one map, and a
 * dive centre is a third vocabulary arriving at the same door. A shop is not a place you get
 * into the water, so one layer drawing both would be telling a diver that a dive centre is a
 * dive site.
 *
 * **§0.1 has already spent the only lever that could tell them apart.** M2n settled that the
 * marks are monochrome — the depth palette is tuned as ink and a band used as a fill loses the
 * count inside it — so a second kind of mark on one layer could differ only in *shape*, at
 * 14–26 pt, over Apple's cartography. §0.6 has twice ruled that a symbol needing a legend has
 * already failed.
 *
 * **And a mode needs no new mark at all**, which is the argument that turns a preference into a
 * decision: because the layers never draw together, a centre is the same dot a community site
 * is. The dot means "a catalogue row is here" and the summary line says which catalogue —
 * exactly as the badge means "your dives here" only while the personal layer is showing.
 *
 * The cost is real and named rather than discovered later: **the centres layer is empty on every
 * device today and will stay empty for every centre this app creates**, because §2.3 gives a new
 * centre its name alone. Its empty state therefore says something different from the community
 * layer's and offers the directory, where a centre with no position is still a row.
 */
export const MAP_LAYERS = ['mine', 'community', 'centers'] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/** The capsule's glyphs — one per layer, and the capsule shows the two the diver is **not** on.
 * Each names **what pressing it does** rather than what is currently showing, which is what lets
 * a plain `CapsuleAction` — a trigger with a fixed label, by construction — serve as a toggle:
 * the control says where it takes you, and the summary line under the title says where you are.
 *
 * **Two destinations rather than a three-way cycle** (M3c). A cycle keeps the capsule at one
 * glyph and keeps every label honest, and it was the cheaper change; it also makes a diver press
 * twice to reach a layer and learn an order nothing on screen states. Two glyphs is one press to
 * anywhere, and §0.6's capsule is a row of equal monochrome glyphs already — which is what the
 * Dives screen's own has always been.
 *
 * Exported so `symbolName.test.tsx` can check the Android half against a real Material name —
 * see `DivesScreen`'s two for why no suite that renders this screen can. */
export const EXPLORE_GLYPH = { ios: 'globe', android: 'public' } as const;
export const MY_DIVES_GLYPH = { ios: 'mappin.and.ellipse', android: 'pin_drop' } as const;
export const CENTERS_GLYPH = { ios: 'storefront', android: 'storefront' } as const;

/** What the capsule offers on each layer: the other two, in `MAP_LAYERS`' own order, so a
 * glyph's position tells the diver the same thing wherever they are. Derived from the layer
 * list rather than written out three times — a fourth layer would be one entry here and would
 * appear in all three capsules on its own. */
const LAYER_DESTINATION: Record<MapLayer, { symbol: PlatformSymbol; label: string }> = {
  mine: { symbol: MY_DIVES_GLYPH, label: 'Show my dives' },
  community: { symbol: EXPLORE_GLYPH, label: 'Explore community sites' },
  centers: { symbol: CENTERS_GLYPH, label: 'Explore dive centres' },
};

/**
 * What a catalogue site is called on this screen — its name, or `UNNAMED_SITE` when it has
 * none.
 *
 * **A deliberate near-duplicate of `diveSiteLabel`, and §4.1 requires it to say so.** That
 * function answers "what is this DIVE called" and reads a dive's site-then-centre pair; this
 * one answers "what is this catalogue ROW called" and has only a name to read — a site has no
 * centre to fall back to. What they share is the words for having neither, which is why
 * `UNNAMED_SITE` is imported rather than typed here: a mark a screen reader announces as
 * nothing is worse than one it announces as unnamed, and it must be the same "nothing" the
 * dive list already uses. §5 asks a new site only for a name, so this is an edge rather than
 * the norm — but `dive_sites.name` is nullable in both databases (§6, so §7's one-transaction
 * push can never reject a diver's whole sync over one row) and a null can therefore arrive.
 */
function siteLabel(site: Pick<DiveSite, 'name'>): string {
  return site.name ?? UNNAMED_SITE;
}

/** The same for a catalogue **centre**, in that noun's own words (M3c). Two constants rather
 * than one "Unnamed" plus a noun, for the reason `UNNAMED_CENTER` records: §0.5's Czech declines
 * both nouns, so they are two strings to translate rather than one string and a grammar rule. */
function centreLabel(centre: Pick<DiveCenter, 'name'>): string {
  return centre.name ?? UNNAMED_CENTER;
}

/**
 * A community layer's marks: one per catalogue row that has a position, named by its own
 * table's label rule and carrying no count.
 *
 * **Generic over the row, on `withPoints`' own reasoning** (domain/mapSites.ts): `dive_sites` and
 * `dive_centers` are the same shape under two names, and "a catalogue row at a point, with a
 * name and no badge" is one mark rather than two that happen to look alike. What differs between
 * the two layers is the label rule and nothing else, so that is the argument.
 */
function catalogueMarks<T extends { id: string }>(
  placed: readonly { row: T; point: MapMark['point'] }[],
  label: (row: T) => string,
): MapMark[] {
  return placed.map(({ row, point }) => ({
    key: row.id,
    label: label(row),
    point,
    // No count: a catalogue row the diver has never dived is not a count of anything, and `0`
    // would be a number about the wrong thing (`DiveMap.tsx`).
    badge: null,
  }));
}

/**
 * **The Map tab** (DESIGN.md §3): *"clustered pins of your dives (badge = count per site);
 * tapping a site shows your dives there with a depth/temp summary; toggle to explore all
 * community sites."*
 *
 * Lives outside `src/app/` like every other screen, because expo-router sweeps that tree as
 * routes and a test file in it would ship to a diver's phone; `src/app/(tabs)/map.tsx` is the
 * one-line re-export that puts it in the bar.
 *
 * ── What is actually on this map, which is less than the sentence above suggests ───────────
 *
 * A pin needs coordinates, and there are two sources. A dive's own `latitude`/`longitude` has
 * been settable since M2l's *use my location* and is **null on every dive logged before it**
 * (§10: "no dive logged in M1 can carry a GPS point"). `dive_sites.location` reaches the device
 * only through a pull and is empty today, because nothing creates a site yet. So the state this
 * screen was built for — and the one it will be in for a while — is a handful of the diver's own
 * pins and an empty community layer, and both of those get a real screen rather than a blank
 * map:
 *
 *  · **No dives at all**, and **dives with no pin anywhere**, are different sentences. The
 *    second is the common one for every logbook older than M2l, and it is the one that has to
 *    say how a dive gets a pin — otherwise the screen is a reproach with no way to act on it.
 *  · **The community layer with nothing behind it** says so, and what it says depends on being
 *    signed in: the catalogue arrives by pull (§5, §7), so a guest is not waiting for a sync,
 *    they are waiting for an account. Telling them "your next sync will bring them" would be
 *    telling them to wait for something that will never happen.
 *
 * §1 binds all of it: no dives, no permission, no network and no account each open a tab that
 * says something true.
 *
 * ── What this screen owns, and what it hands over ─────────────────────────────────────────
 *
 * It owns the layer, the selection and the four states each layer can be in. Everything else
 * belongs to somebody: `domain/mapSites.ts` groups the dives, positions each mark and computes
 * the region; `domain/logbookStats.ts` counts and finds the deepest, exactly as it does for the
 * Dives header, so "how many dives" cannot mean two things; `format/display.ts` writes every
 * sentence with a figure in it; `components/DiveMap.tsx` draws the surface, and is the only
 * file in the app that imports `react-native-maps`. There is no `db.select()` here and no
 * second reading of anything.
 *
 * ── The colour question, answered where it belongs ────────────────────────────────────────
 *
 * §0.1 spends every hue on depth and a map is made of colour, so "does a pin take its depth
 * band?" had to be settled. It does not; `components/DiveMap.tsx` carries the three arguments
 * and the option that was rejected. The consequence for THIS file is the part worth seeing from
 * here: the depth palette appears on this screen exactly where it appears on every other one —
 * on the `DiveRow`s inside the site sheet, each depth in its own band, beside its own number.
 */
export default function MapScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const units = useUnitSystem();
  const insets = useSafeAreaInsets();
  const { dives, numbers, resolved, error } = useDives();
  const catalogue = useDiveSites();
  // The centres half of the catalogue, read for the first time by anything on screen (M3c) —
  // its own hook rather than a field on `useDiveSites()`, so a failed centres read cannot take
  // the community sites off the map (db/useDiveCenters.ts).
  const centres = useDiveCenters();
  const { session } = useAuthSession();
  const [layer, setLayer] = useState<MapLayer>('mine');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [locatable, setLocatable] = useState(false);

  /**
   * **Whether the diver's own position may be drawn — READ, never asked.**
   *
   * §3's Settings row exists because iOS spends its permission sheet once ever, and this screen
   * must not be what spends it: a map is worth opening with no permission at all, and the blue
   * dot is a nicety. `locationPermission()` (platform/locationPermission.ts, §4.1's owner) is
   * the half that never raises a sheet; `requestLocationPermission()` is the half this file must
   * not touch, and does not.
   *
   * `granted` specifically, rather than "not denied": `servicesOff` outranks even a granted
   * permission (that module's own ordering rule) and `unknown` is a failed query rather than a
   * yes, so both of those draw no dot — which is the same outcome the platform would produce
   * anyway, decided here rather than left to it.
   *
   * No `catch`, for the reason SettingsScreen's own read gives: that module answers `unknown` on
   * every failure of its own, so a rejection here is not a state this screen can be in, and §10
   * declines a guard nothing could catch failing.
   */
  const readPermission = useCallback(() => {
    void locationPermission().then((state) => setLocatable(state === 'granted'));
  }, []);
  useEffect(() => {
    readPermission();
  }, [readPermission]);
  // ...and again when the diver comes back, because the switch is in another app and there is
  // no event in this one. `hooks/useForegroundReturn.ts` is §7.5's own foreground trigger and
  // §4.1's owner of "coming back to the app" (M2m); this is its third caller.
  useForegroundReturn(readPermission);

  /** Switching layers clears the selection, because a key from one layer names nothing in the
   * other — a site id and a place key are different vocabularies — and a sheet that survived
   * the switch would be describing a mark that is no longer drawn. */
  const showLayer = (next: MapLayer) => {
    setLayer(next);
    setSelectedKey(null);
  };

  const places: MapSite[] = groupDivesByPlace(dives);
  const communitySites = withPoints(catalogue.sites);
  const placedCentres = withPoints(centres.centers);

  const marks: MapMark[] =
    layer === 'mine'
      ? places.map((place) => ({
          key: place.key,
          label: place.label,
          point: place.point,
          // §3's "badge = count per site". Always drawn, including `1` — see `mapMarkBadge`
          // (theme/styles.ts) for why a bare mark for a single dive would be a legend.
          badge: String(place.dives.length),
        }))
      : // `UNNAMED_SITE`/`UNNAMED_CENTER` rather than a literal, so a catalogue row with no name
        // is called on this map exactly what the rest of the app calls one (§4.1). §5 asks a new
        // row only for a name, so this is an edge rather than the norm — but a mark with no
        // label at all is a mark a screen reader cannot announce.
        layer === 'community'
        ? catalogueMarks(communitySites, siteLabel)
        : catalogueMarks(placedCentres, centreLabel);

  const region = regionFor(marks.map((mark) => mark.point));

  const root = [styles.screen, { paddingTop: screenTopInset(insets.top) }];

  /**
   * The large title, drawn on every branch — this screen names itself in the same words, the
   * same treatment and the same place whether it is showing a map, a message or nothing yet,
   * exactly as `DivesScreen`'s does across its four states.
   */
  const title = <Text style={styles.mapTitle}>Map</Text>;

  /**
   * **The layer toggle, and it is drawn on every branch too — including the failing ones.**
   *
   * That is a deliberate difference from the Dives screen, which drops its capsule when the
   * logbook has not been read: there the glyphs act on the data (search it, add to it), so a
   * capsule over an unread list offers actions on nothing. This one acts on the SCREEN. A diver
   * whose logbook read failed can still go and look at the community layer, and taking the
   * control away would strand them on the broken half with no way across.
   *
   * Every `CapsuleAction`'s label says what pressing it does. `ActionCapsule`'s own contract is
   * that its actions are "plain triggers with fixed labels — neither reports a state", and this
   * keeps to it rather than widening it: the state is reported by the summary line.
   *
   * **The two layers the diver is not on**, in `MAP_LAYERS`' own order, derived rather than
   * written out per layer — so a glyph keeps its position wherever the diver is, and a fourth
   * layer would appear in all three capsules from one entry in `LAYER_DESTINATION`.
   */
  const capsuleActions: readonly CapsuleAction[] = MAP_LAYERS.filter((other) => other !== layer).map((other) => ({
    key: other,
    symbol: LAYER_DESTINATION[other].symbol,
    label: LAYER_DESTINATION[other].label,
    onPress: () => showLayer(other),
  }));

  /**
   * **What the screen has to say beneath its title: a summary line, or a message, or neither.**
   *
   * The two are exclusive by construction rather than by two conditions that happen to agree —
   * a layer either has an answer worth summarising or it has something to explain. Modelled on
   * `DivesScreen`'s four branches and keeping their one hard rule: a read that has not answered
   * yet states nothing at all (§10 — "a screen with no answer must not state one"), because an
   * unread logbook and an empty one are the same `[]`.
   */
  const body = (): { summary: string | null; message: string | null } => {
    if (layer === 'centers') {
      // `CATALOGUE_UNREADABLE` (domain/logbook.ts) — one sentence, three screens, since M3c made
      // this its second and third reader. It was a literal here while the Map was the only one.
      if (centres.error) return { summary: null, message: CATALOGUE_UNREADABLE };
      if (!centres.resolved) return { summary: null, message: null };
      if (centres.centers.length === 0) {
        // **The same guest/member split the community layer draws**, and for the same reason: a
        // centre reaches this table through a pull or through §2.3's *add a centre*, and §5 puts
        // an account behind both.
        return {
          summary: null,
          message:
            session === null
              ? 'No dive centres here yet. They arrive with an account, on your first sync.'
              : 'No dive centres here yet. Centres appear as divers add them and your next sync brings them down.',
        };
      }
      if (marks.length === 0) {
        // **The layer's ordinary state, and a different sentence from the one above it** — the
        // device holds centres and none of them can be drawn. §2.3 is why: *"a centre inherits
        // its name alone — the form's pin is where the diver entered the water, so writing it to
        // a centre files a dive site as the shop's address"*. So a centre only ever gets a
        // position from a catalogue that surveyed it, and the honest answer here is to send the
        // diver to the list, where a centre with no position is still a row. The gesture is
        // named, exactly as the pinless-dives sentence names *"Use my location"*.
        return {
          summary: null,
          message: `None of your ${formatCenterCount(centres.centers.length)} has a position yet. Tap “All centres” to browse them.`,
        };
      }
      // Both figures, because they are almost never the same one — see `formatCentersSummary`.
      return { summary: formatCentersSummary(marks.length, centres.centers.length), message: null };
    }

    if (layer === 'community') {
      if (catalogue.error) return { summary: null, message: CATALOGUE_UNREADABLE };
      if (!catalogue.resolved) return { summary: null, message: null };
      if (marks.length === 0) {
        // **Two sentences, because a guest is not waiting for the same thing a signed-in diver
        // is.** The catalogue reaches a device only through a pull (§5, §7), and §7.4 erases it
        // on the way out precisely because "a guest never had them" — so telling a guest their
        // next sync will bring sites would be pointing at something that cannot happen.
        return {
          summary: null,
          message:
            session === null
              ? 'No community sites here yet. They arrive with an account, on your first sync.'
              : 'No community sites here yet. Sites appear as divers add them and your next sync brings them down.',
        };
      }
      return { summary: formatCommunitySummary(marks.length), message: null };
    }

    if (error) {
      // `LOGBOOK_UNREADABLE` (db/useDives.ts) — the one owner of what this hook's `error`
      // says, shared with the dives list, search and the Stats tab.
      return { summary: null, message: LOGBOOK_UNREADABLE };
    }
    if (!resolved) return { summary: null, message: null };

    const logged = logbookStats(dives).dives;
    if (logged === 0) {
      return { summary: null, message: 'No dives logged yet. A dive joins the map when you give it a pin.' };
    }
    if (marks.length === 0) {
      // **The common case, and a different sentence from the one above it.** Every dive logged
      // before M2l has null coordinates (§10), so a full logbook with an empty map is the
      // expected state rather than a fault — and the sentence has to name the gesture, because
      // nothing on this screen sets a pin (§2.3's other half; see the note at the foot of this
      // file).
      return {
        summary: null,
        message: `None of your ${String(logged)} logged dives has a pin yet. Open a dive, edit it, and tap “Use my location” at the site.`,
      };
    }
    const onMap = places.reduce((count, place) => count + place.dives.length, 0);
    return { summary: formatMyDivesSummary(places.length, onMap, logged), message: null };
  };

  const { summary, message } = body();

  /** The mark whose sheet is open, or null. Looked up rather than stored, so a selection that
   * outlives its mark — a dive deleted on another screen, a pull that merges a site away —
   * simply closes the sheet instead of leaving it describing something that is gone. */
  const selectedPlace = layer === 'mine' ? places.find((place) => place.key === selectedKey) : undefined;
  const selectedSite =
    layer === 'community' ? communitySites.find(({ row }) => row.id === selectedKey)?.row : undefined;
  const siteFacts = selectedSite === undefined ? null : formatSiteFacts(selectedSite, units);

  /**
   * **What a tapped mark does, and it is not the same act on all three layers** (M3c).
   *
   * A site — the diver's own or the catalogue's — opens a sheet, because a site has nowhere else
   * in the app to be shown: the sheet *is* its page. **A centre has a page**, so its mark goes
   * there, and drawing a peek of that page under the map would be the same three facts in two
   * places for one of them to fall behind (§4.1).
   *
   * The asymmetry is deliberate and it is the layer that carries it, never the mark: on the
   * centres layer *every* mark navigates, so a diver never has to work out which kind of thing
   * they are about to press. `selectedKey` simply stays null there, which is why the centres
   * layer needs no sheet branch and no selected state.
   */
  const pressMark = (key: string) => {
    if (layer === 'centers') {
      router.push(`/center/${key}`);
      return;
    }
    setSelectedKey(key);
  };

  /** The sheet's way out — §0.6's one treatment for leaving, shared with the dive detail's back
   * control and the form's `‹ Cancel` through `backControl` (theme/styles.ts). */
  const closeSheet = (label: string) => (
    <Pressable
      style={styles.mapSheetClose}
      onPress={() => setSelectedKey(null)}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.mapSheetCloseLabel}>Close</Text>
    </Pressable>
  );

  return (
    <View style={root}>
      {/* The region the capsule floats in — its top edge is the title's top edge, which is what
          lets `capsuleFloat` say `top: 0` and mean "beside the title". The same arrangement
          `divesListArea` makes on the Dives screen, and the reason that style is now named for
          the rule rather than for that screen. */}
      <View style={styles.mapArea}>
        {title}
        {summary !== null && <Text style={styles.mapSummary}>{summary}</Text>}
        {/* **The way into the directory, on the centres layer and nowhere else** (M3c).
            §0.6's day-strip action — "a bordered pill in tracked uppercase, not plain text, so it
            reads as a control rather than a label" — because that is exactly what this is, and
            inventing a second treatment for one control is what §0.6 exists to stop.

            It is on the layer rather than in the capsule for a measured reason: the header's
            trailing reserve is derived from a glyph COUNT, so a magnifier that appeared on one
            layer only would either under-reserve there or leave 49 pt of empty column on the
            other two. And it is drawn on **every** branch of this layer, the failing one
            included, on the same reasoning the toggle is: the directory reads the same table and
            says so for itself, and a control that vanished when the data failed would strand a
            diver on the broken half. */}
        {layer === 'centers' && (
          <View style={styles.mapCentersRow}>
            <Pressable
              style={styles.mapCentersAction}
              onPress={() => router.push('/centers')}
              accessibilityRole="button"
              accessibilityLabel="All centres"
            >
              <View style={styles.mapCentersActionPill}>
                <Text style={styles.mapCentersActionLabel}>All centres</Text>
              </View>
            </Pressable>
          </View>
        )}
        {message !== null && (
          <View style={styles.centerFill}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        )}
        {/* The map is drawn only when there is somewhere to put it — `regionFor` returns null
            for no marks, and §1 would rather open a tab that says something true than centre a
            map on a place the diver has never been. */}
        {message === null && region !== null && (
          <DiveMap
            scheme={scheme}
            region={region}
            marks={marks}
            selectedKey={selectedKey}
            onSelect={pressMark}
            showsUserLocation={locatable}
          />
        )}
        {selectedPlace !== undefined && (
          <View style={styles.mapSheet}>
            <View style={styles.mapSheetHeader}>
              <Text style={styles.mapSheetTitle}>{selectedPlace.label}</Text>
              {closeSheet(`Close ${selectedPlace.label}`)}
            </View>
            {/* §3's "depth/temp summary". `logbookStats` is the same owner the Dives header
                asks and `waterTempRange` its map-side sibling; `formatSiteSummary` owns the
                words. The depth in it takes no band colour — it is an aggregate over the dives
                at this place (§0.6's ruling for the header, for the identical reason). */}
            <Text style={styles.mapSheetSummary}>
              {formatSiteSummary(logbookStats(selectedPlace.dives), waterTempRange(selectedPlace.dives), units)}
            </Text>
            {/* **And here is where the depth palette lives on this screen** — one `DiveRow` per
                dive, each with its own depth in its own band, beside its own number, exactly as
                on the logbook. Nothing about a dive is re-rendered specially for the map. */}
            <FlatList
              data={selectedPlace.dives}
              keyExtractor={(dive) => dive.id}
              renderItem={({ item }) => (
                <DiveRow
                  dive={item}
                  number={numbers.get(item.id)}
                  scheme={scheme}
                  units={units}
                  onPress={(id) => router.push(`/dive/${id}`)}
                />
              )}
              // The device's own clearance, not a constant — `screenBottomInset` (theme/
              // styles.ts) owns it, and what it reports on a screen inside `(tabs)` already
              // contains the Liquid Glass bar. The sheet's bottom edge IS the display's, so
              // without this the last dive scrolls under the bar: the same defect that constant
              // was written for, arriving on a second screen.
              contentContainerStyle={[
                styles.mapSheetList,
                { paddingBottom: screenBottomInset(insets.bottom) },
              ]}
            />
          </View>
        )}
        {selectedSite !== undefined && (
          <View style={[styles.mapSheet, { paddingBottom: screenBottomInset(insets.bottom) }]}>
            <View style={styles.mapSheetHeader}>
              <Text style={styles.mapSheetTitle}>{siteLabel(selectedSite)}</Text>
              {closeSheet(`Close ${siteLabel(selectedSite)}`)}
            </View>
            {/* What the catalogue knows, or no line at all: §5 asks a new site only for a name,
                so a row with nothing else is the expected shape rather than a degraded one, and
                `formatSiteFacts` returns null rather than an empty line for it. */}
            {siteFacts !== null && <Text style={styles.mapSheetFacts}>{siteFacts}</Text>}
          </View>
        )}
        {/* Last inside the region so nothing it overlaps can cover it back, exactly as on the
            Dives screen. */}
        <View style={styles.capsuleFloat}>
          <ActionCapsule scheme={scheme} actions={capsuleActions} />
        </View>
      </View>
    </View>
  );
}

/**
 * **The seam this task deliberately did not build** (§2.3: *"a GPS pin can be set from the map
 * or 'use my location'"*), recorded here rather than left as a gap someone rediscovers.
 *
 * Half of that sentence exists — M2l's *use my location* row on the dive form — and the other
 * half is setting a pin **from** the map, which belongs to whoever builds site creation next.
 * The shape it wants is a `MapView` `onPress`, whose event carries the tapped `coordinate`, and
 * the honest place for it is the site-creation flow rather than this screen: a tap on THIS map
 * has a meaning already (it deselects), and a map that sometimes moved a dive's pin and
 * sometimes closed a sheet would be a control whose behaviour depends on what is open.
 *
 * So the seam is a *route*, not a mode: the creation screen pushes a picker map of its own,
 * with its own instruction line and its own confirm, and returns a point. Nothing in this file
 * or in `components/DiveMap.tsx` is in the way of that — `DiveMap` takes its marks and its
 * region as props and holds no opinion about what a tap on the surface means, so a picker can
 * render the same component with one mark and its own handler.
 */

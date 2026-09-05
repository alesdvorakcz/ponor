import { useCallback, useEffect, useState } from 'react';
import { router, type Href } from 'expo-router';
import {
  FlatList,
  Pressable,
  Text,
  View,
  useColorScheme,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionCapsule, type CapsuleAction } from '../components/ActionCapsule';
import {
  DiveMap,
  MAP_KIND_GLYPH,
  MAP_MARK_KINDS,
  type MapMark,
  type MapMarkKind,
  type MapMarkRef,
} from '../components/DiveMap';
import { DiveRow } from '../components/DiveRow';
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
  sitesWithoutYourMark,
  waterTempRange,
  withPoints,
  type MapPoint,
  type MapSite,
} from '../domain/mapSites';
import { catalogueSiteIdentity } from '../domain/siteIdentity';
import { type DiveCenter, type DiveSite } from '../domain/types';
import {
  formatCenterCount,
  formatCenterMarkLabel,
  formatDiveMarkLabel,
  formatMapSummary,
  formatSiteFacts,
  formatSiteMarkLabel,
  formatSiteSummary,
  UNNAMED_CENTER,
  UNNAMED_SITE,
} from '../format/display';
import { useForegroundReturn } from '../hooks/useForegroundReturn';
import { locationPermission } from '../platform/locationPermission';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';

/**
 * ── §3's layers are a FILTER, not a mode (owner's call, M3e, reversing M3c) ────────────────
 *
 * §3 now says it in as many words: *"Any combination shows at once — dives alone, or dives with
 * the sites and centres around them — because the question a diver actually has on a map is what
 * is near here, and a mode can only ever answer one third of it at a time."*
 *
 * **What the control switches is exactly what `components/DiveMap.tsx` can draw**, and this file
 * takes that list (`MAP_MARK_KINDS`) rather than keeping a second one (§4.1's "derive, or tie at
 * compile time") — a `MAP_LAYERS` of its own lived here until M3e and was the same three strings
 * twice. A fourth kind of mark now appears in the filter on its own and cannot appear in one and
 * not the other.
 *
 * **M3c's measurements are not overturned by the reversal; they are the constraint on it**, and
 * they are kept where they bind rather than summarised here: `DiveMap.tsx` carries what a mark
 * may look like now that plain shape has been tried and failed, and `format/display.ts` carries
 * the summary line that a mode's version could not write. What this file keeps of M3c is the one
 * sentence that survived intact — a shop is not a place you get into the water — and it is now
 * carried by the mark's own glyph rather than by never drawing the two together.
 *
 * **What the reversal cost, stated because M3c's argument for modes was that they cost nothing:**
 * a centre's mark needs a symbol inside it, a site a diver has dived would be drawn twice at one
 * coordinate if nothing stopped it (`sitesWithoutYourMark`, domain/mapSites.ts), and a tap means
 * two things depending on which mark it lands on. All three were the reasons not to mix; all three
 * are paid here rather than avoided.
 *
 * **The third of those is now a rule instead of an exception** (M3f). It read "a centre's mark
 * navigates and the other two open a sheet" because a site had no page to navigate to; `/site/[id]`
 * exists now, so it reads **a catalogue row goes to its page, your own dives open a sheet** — and
 * the mark says which, because the mark that opens a sheet is the one wearing a numeral. See
 * `pressMark` for the whole of it, including which sheet went with the change and why M3e's own
 * §4.1 argument is what removed it.
 */

/**
 * **What each switch says it will do, in both of its states** (§0.6).
 *
 * A `CapsuleAction`'s label has always named *what pressing it does* rather than what is showing,
 * and that does not change — what changes is that pressing it now does one of two things, so the
 * label has two spellings and the one on offer is the one the press will carry out. The *state*
 * is reported twice over, in the two channels §0.1 leaves: the glyph is drawn in inverted ink
 * while it is on (`capsuleGlyphInk`, theme/styles.ts) and `accessibilityState.selected` says so
 * to a screen reader.
 *
 * Keyed by the kind, so a fourth kind is one entry here and a missing one does not compile.
 */
const KIND_SWITCH: Record<MapMarkKind, { show: string; hide: string }> = {
  mine: { show: 'Show your dives', hide: 'Hide your dives' },
  community: { show: 'Show community sites', hide: 'Hide community sites' },
  centers: { show: 'Show dive centres', hide: 'Hide dive centres' },
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
 * A catalogue kind's marks: one per row that has a position, named by its own table's label rule
 * and carrying no count.
 *
 * **Generic over the row, on `withPoints`' own reasoning** (domain/mapSites.ts): `dive_sites` and
 * `dive_centers` are the same shape under two names, and "a catalogue row at a point, with a name
 * and no badge" is one mark rather than two that happen to look alike. What differs between the
 * two is the label rule and the kind, so those are the arguments — and the kind is what decides
 * both the glyph inside the mark and what a tap on it does, so it travels with the mark rather
 * than being re-derived where those questions are asked.
 */
function catalogueMarks<T extends { id: string }>(
  placed: readonly { row: T; point: MapPoint }[],
  kind: 'community' | 'centers',
  label: (row: T) => string,
): MapMark[] {
  return placed.map(({ row, point }) => ({ kind, key: row.id, label: label(row), point }));
}

/**
 * **A pill on this screen that leaves it for a catalogue screen** — the two directory links under
 * the summary line, and the site's page from an open sheet.
 *
 * §0.6's day-strip action: *"a bordered pill in tracked uppercase, not plain text, so it reads as
 * a control rather than a label"*. One component rather than three copies of a Pressable wrapping
 * a View wrapping a Text — this screen had one of them and grew two more in M3f, which is the
 * point at which a shape becomes a rule (§4.1).
 *
 * The 48 dp box (§0.5) is the Pressable and the pill inside it is smaller — `dayStripAction`'s own
 * "small visible control, generous hidden target" split. `style` is the outer box, because the
 * sheet's copy sits inside a card rather than in the header row and takes that card's padding.
 *
 * `announce` is for the one link whose label is not what it opens: *All sites* and *All centres*
 * say what they do, and *Site page* is a category, so the sheet's copy announces the place by
 * name. That is Settings' rule for every row that opens something.
 */
function DirectoryLink({
  label,
  href,
  announce,
  style,
  styles,
}: {
  label: string;
  href: Href;
  announce?: string;
  style?: StyleProp<ViewStyle>;
  styles: Styles;
}) {
  return (
    <Pressable
      style={style ?? styles.mapDirectoryAction}
      onPress={() => router.push(href)}
      accessibilityRole="button"
      accessibilityLabel={announce ?? label}
    >
      <View style={styles.mapDirectoryActionPill}>
        <Text style={styles.mapDirectoryActionLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}

/**
 * **The Map tab** (DESIGN.md §3): *"your dives grouped by site identity, not by geometry (badge =
 * count per site); tapping a site shows your dives there with a depth/temp summary; a toggle
 * between your dives, community sites and community centres"* — **a filter since M3e, so any
 * combination of the three is on the map at once.**
 *
 * Lives outside `src/app/` like every other screen, because expo-router sweeps that tree as
 * routes and a test file in it would ship to a diver's phone; `src/app/(tabs)/map.tsx` is the
 * one-line re-export that puts it in the bar.
 *
 * ── What is actually on this map, which is less than the sentence above suggests ───────────
 *
 * A pin needs coordinates, and there are two sources. A dive's own `latitude`/`longitude` has
 * been settable since M2l's *use my location* and is **null on every dive logged before it**
 * (§10: "no dive logged in M1 can carry a GPS point"). `dive_sites.location` and
 * `dive_centers.location` reach the device only through a pull, and §2.3 gives a new centre its
 * name alone — so the state this screen was built for, and the one it will be in for a while, is
 * a handful of the diver's own pins over an empty catalogue. **Every one of the three filters
 * therefore has an empty case, and §1 binds all of them**: no dives, no catalogue, no permission,
 * no network and no account each open a tab that says something true.
 *
 * ── What this screen owns, and what it hands over ─────────────────────────────────────────
 *
 * It owns the filter, the selection, and which sentence each state deserves. Everything else
 * belongs to somebody: `domain/mapSites.ts` groups the dives, positions each mark, decides which
 * catalogue rows still need one and computes the region; `domain/logbookStats.ts` counts and
 * finds the deepest, exactly as it does for the Dives header, so "how many dives" cannot mean two
 * things; `format/display.ts` writes every sentence with a figure in it and every mark's spoken
 * name; `components/DiveMap.tsx` draws the surface and owns the mark vocabulary, and is the only
 * file in the app that imports `react-native-maps`. There is no `db.select()` here and no second
 * reading of anything.
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
  // The centres half of the catalogue (M3c) — its own hook rather than a field on
  // `useDiveSites()`, so a failed centres read cannot take the community sites off the map
  // (db/useDiveCenters.ts). Now that both are drawn at once, that split is what lets one of them
  // fail while the other keeps its marks.
  const centres = useDiveCenters();
  const { session } = useAuthSession();
  /**
   * **What is switched on. Opens on the diver's own dives and nothing else** — which is exactly
   * what the tab did before it was a filter, so a diver who never touches the control sees no
   * change and a fresh device still meets one sentence rather than three.
   *
   * It is not remembered between visits. Persisting it means a stored shape and a default for a
   * nonsense row, which is `db/settings.ts`' territory (§4.1) and a decision of its own; the map
   * opening on the diver's own logbook is a defensible answer rather than a placeholder for one.
   */
  const [shown, setShown] = useState<ReadonlySet<MapMarkKind>>(() => new Set<MapMarkKind>(['mine']));
  const [selected, setSelected] = useState<MapMarkRef | null>(null);
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

  /**
   * **Switching anything clears the selection, including the two kinds the open sheet is not
   * about** — and the bluntness is deliberate rather than unexamined.
   *
   * A sheet describes a mark, so it has to close when that mark stops being drawn. The narrow
   * version of that rule — clear only when the sheet's own kind is switched off — is **wrong in a
   * way M2n already measured once**: the sheet would close on the way out and *reopen* on the way
   * back, on a mark the diver never pressed. And the coupling is not only within a kind, because
   * switching *dives* on takes a community site off the map (`sitesWithoutYourMark`), so a site's
   * open sheet has to close on a press about something else.
   *
   * The cost is one sentence long and is the honest half: a diver reading Blue Hole's dives who
   * switches centres on loses the sheet and taps the mark again. A selection that survived would
   * have to prove, for every combination, that it was still drawn — and "it is still drawn" is
   * exactly what could not be proved cheaply enough to be worth the risk of re-opening one.
   */
  const toggleKind = (kind: MapMarkKind) => {
    setShown((current) => {
      const next = new Set(current);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
    setSelected(null);
  };

  /**
   * **The three populations, each of them empty when its filter is off**, so everything below —
   * the marks, the region, the summary's figures and the selection lookup — is computed from what
   * is actually on the map rather than from what the device happens to hold.
   */
  const places: MapSite[] = shown.has('mine') ? groupDivesByPlace(dives) : [];
  // **The catalogue sites that are not already standing under one of the diver's own marks.**
  // A dive and the site it was logged at are not near each other, they are the same coordinate:
  // §2.3's *Add "…" as a new site* copies the dive's own pin into the new row and pairs the dive
  // to it by id. `sitesWithoutYourMark` (domain/mapSites.ts) settles it by that identity rather
  // than by distance, and the place's sheet below carries the row's facts so nothing is lost
  // with the dot.
  const communitySites = shown.has('community')
    ? sitesWithoutYourMark(withPoints(catalogue.sites), places)
    : [];
  const placedCentres = shown.has('centers') ? withPoints(centres.centers) : [];

  const marks: MapMark[] = [
    ...places.map((place): MapMark => ({
      kind: 'mine',
      key: place.key,
      // The mark's spoken name says the kind as well as the place, because three kinds are on
      // one map and the numeral that tells this one apart is invisible to a screen reader
      // (`format/display.ts`).
      label: formatDiveMarkLabel(place.label, place.dives.length),
      point: place.point,
      // §3's "badge = count per site". Always drawn, including `1` — see `mapMarkBadge`
      // (theme/styles.ts) for why a bare mark for a single dive would be a legend.
      badge: String(place.dives.length),
    })),
    // `UNNAMED_SITE`/`UNNAMED_CENTER` rather than a literal, so a catalogue row with no name is
    // called on this map exactly what the rest of the app calls one (§4.1). §5 asks a new row
    // only for a name, so this is an edge rather than the norm — but a mark with no label at all
    // is a mark a screen reader cannot announce.
    ...catalogueMarks(communitySites, 'community', (row) => formatSiteMarkLabel(siteLabel(row))),
    ...catalogueMarks(placedCentres, 'centers', (row) => formatCenterMarkLabel(centreLabel(row))),
  ];

  const region = regionFor(marks.map((mark) => mark.point));

  const root = [styles.screen, { paddingTop: screenTopInset(insets.top) }];

  /**
   * The large title, drawn on every branch — this screen names itself in the same words, the
   * same treatment and the same place whether it is showing a map, a message or nothing yet,
   * exactly as `DivesScreen`'s does across its four states.
   */
  const title = <Text style={styles.mapTitle}>Map</Text>;

  /**
   * **The filter, and it is drawn on every branch — including the failing ones.**
   *
   * That is a deliberate difference from the Dives screen, which drops its capsule when the
   * logbook has not been read: there the glyphs act on the data (search it, add to it), so a
   * capsule over an unread list offers actions on nothing. This one acts on the SCREEN. A diver
   * whose logbook read failed can still switch the community on and look at that, and taking the
   * control away would strand them on the broken half with no way across.
   *
   * **All three glyphs, always, in `MAP_MARK_KINDS`' own order**, so a glyph never moves and a
   * diver aims at the same place every time — which is what a row of switches has to do and what
   * M3c's "the two you are not on" could not: that capsule's contents changed with its state.
   */
  const capsuleActions: readonly CapsuleAction[] = MAP_MARK_KINDS.map((kind) => ({
    key: kind,
    symbol: MAP_KIND_GLYPH[kind],
    label: shown.has(kind) ? KIND_SWITCH[kind].hide : KIND_SWITCH[kind].show,
    selected: shown.has(kind),
    onPress: () => toggleKind(kind),
  }));

  /**
   * **How much of each switched-on kind is on the map, or nothing at all for a kind that has no
   * answer yet** (§10: a screen with no answer must not state one — an unread table and an empty
   * one are the same `[]`).
   *
   * A **failed** read is deliberately also `null` here rather than `0`: it is reported by the
   * notice below instead, because `0 sites` over a failure is a figure the screen does not have.
   *
   * The dives figure counts LOGGED dives at drawn places against the whole logbook, which is what
   * the badges add up to; §2.4's plans are excluded by `logbookStats` and by `groupDivesByPlace`
   * alike, so the two cannot disagree.
   */
  const divesOnMap = places.reduce((count, place) => count + place.dives.length, 0);
  const logged = logbookStats(dives).dives;
  const summary = formatMapSummary(
    shown.has('mine') && resolved && error === undefined ? { onMap: divesOnMap, known: logged } : null,
    shown.has('community') && catalogue.resolved && catalogue.error === undefined
      ? { onMap: communitySites.length, known: catalogue.sites.length }
      : null,
    shown.has('centers') && centres.resolved && centres.error === undefined
      ? { onMap: placedCentres.length, known: centres.centers.length }
      : null,
  );

  /**
   * **A read that failed, for a kind the diver switched on** — said whether or not there is still
   * a map, which is the state a mode never had. With one layer a failure meant an empty screen
   * and the sentence was the screen; with three filters the catalogue can fail while the diver's
   * own dives are on the map, and saying nothing would quietly draw fewer marks than were asked
   * for.
   *
   * **One sentence per distinct failure, not per kind.** `CATALOGUE_UNREADABLE` (domain/
   * logbook.ts) is one sentence about "the community catalogue", and both catalogue reads failing
   * at once is one thing gone wrong — printing it twice would be the screen counting its own
   * tables at the diver.
   */
  const failures: string[] = [];
  if (shown.has('mine') && error) failures.push(LOGBOOK_UNREADABLE);
  if ((shown.has('community') && catalogue.error) || (shown.has('centers') && centres.error)) {
    failures.push(CATALOGUE_UNREADABLE);
  }

  /**
   * **Why a switched-on kind has nothing on the map — one sentence each, and only when the map
   * is empty.**
   *
   * The split is the rule rather than a layout convenience. A **failure** is always said, because
   * it is the one state where the map is silently not showing what the diver asked for. An
   * **emptiness** is said only when there is nothing else to look at: the summary line's own
   * `0 sites` reports it in the line the screen was drawing anyway, and a paragraph explaining an
   * empty catalogue over a map full of the diver's own dives is a reproach for something they did
   * not do.
   *
   * Each sentence **names a gesture**, which is M2n's rule and the reason there are two of them
   * per kind rather than one: "you have none" and "none of yours has a position" are different
   * problems with different answers, and a diver told only "nothing here" has been given no way
   * to act.
   */
  const emptiness = (): string[] => {
    if (marks.length > 0) return [];
    const reasons: string[] = [];
    if (shown.has('mine') && resolved && !error) {
      if (logged === 0) {
        reasons.push('No dives logged yet. A dive joins the map when you give it a pin.');
      } else {
        // **The common case, and a different sentence from the one above it.** Every dive logged
        // before M2l has null coordinates (§10), so a full logbook with an empty map is the
        // expected state rather than a fault — and the sentence has to name the gesture, because
        // nothing on this screen sets a pin (§2.3's other half; see the note at the foot of this
        // file).
        reasons.push(
          `None of your ${String(logged)} logged dives has a pin yet. Open a dive, edit it, and tap “Use my location” at the site.`,
        );
      }
    }
    if (shown.has('community') && catalogue.resolved && !catalogue.error) {
      if (catalogue.sites.length === 0) {
        // **Two sentences, because a guest is not waiting for the same thing a signed-in diver
        // is.** The catalogue reaches a device only through a pull (§5, §7), and §7.4 erases it
        // on the way out precisely because "a guest never had them" — so telling a guest their
        // next sync will bring sites would be pointing at something that cannot happen.
        reasons.push(
          session === null
            ? 'No community sites here yet. They arrive with an account, on your first sync.'
            : 'No community sites here yet. Sites appear as divers add them and your next sync brings them down.',
        );
      } else {
        // **The device holds sites and none of them can be drawn, which is a different sentence
        // from "there are none"** — and it did not exist before M3e, though the state always
        // did: the community layer said "No community sites here yet" over a device holding
        // thirty of them, because it only ever counted the ones it could position. §5 asks a new
        // site for a name and `siteFactsFrom` passes a pin only when the dive carried one, so a
        // catalogue of nameless-place rows is ordinary. The centres layer has had its own version
        // of this sentence since M3c; this is the sibling it should always have had.
        reasons.push(
          `None of your ${String(catalogue.sites.length)} community sites has a position yet. A site takes the pin of the dive that created it, so tap “Use my location” before you add one.`,
        );
      }
    }
    if (shown.has('centers') && centres.resolved && !centres.error) {
      if (centres.centers.length === 0) {
        // **The same guest/member split**, and for the same reason: a centre reaches this table
        // through a pull or through §2.3's *add a centre*, and §5 puts an account behind both.
        reasons.push(
          session === null
            ? 'No dive centres here yet. They arrive with an account, on your first sync.'
            : 'No dive centres here yet. Centres appear as divers add them and your next sync brings them down.',
        );
      } else {
        // §2.3 is why: *"a centre inherits its name alone — the form's pin is where the diver
        // entered the water, so writing it to a centre files a dive site as the shop's address"*.
        // So a centre only ever gets a position from a catalogue that surveyed it, and the honest
        // answer is to send the diver to the list, where a centre with no position is still a row.
        reasons.push(
          `None of your ${formatCenterCount(centres.centers.length)} has a position yet. Tap “All centres” to browse them.`,
        );
      }
    }
    // **Nothing switched on is a legitimate state and the control is what says so** — every glyph
    // is drawn in plain ink and none is inverted, which is a diver's own doing rather than a
    // failure. What it may not be is a blank screen, so the sentence names all three switches.
    if (shown.size === 0) {
      reasons.push(
        'Nothing selected. Switch on your dives, community sites or dive centres to put them on the map.',
      );
    }
    return reasons;
  };

  const messages = emptiness();

  /**
   * The place whose sheet is open — **looked up in what is actually drawn** rather than stored, so
   * a selection that outlives its mark closes the sheet instead of describing something that is
   * gone: a dive deleted on another screen, a pull that merges a site away, or a filter that took
   * the mark off the map.
   *
   * **Only a place of the diver's own can be selected now** (M3f). A catalogue mark of either kind
   * navigates to that row's page, so `selected` is `kind: 'mine'` in practice — the type still
   * carries all three because `MapMarkRef` is `DiveMap`'s vocabulary and the lookup is written to
   * find nothing for the other two rather than to assume they cannot arrive.
   */
  const selectedPlace =
    selected?.kind === 'mine' ? places.find((place) => place.key === selected.key) : undefined;

  /**
   * **What the catalogue knows about the place a dive sheet is describing** — the other half of
   * absorbing a site into the diver's own mark, and the reason that absorption costs nothing.
   *
   * Matched by `catalogueSiteIdentity` (domain/siteIdentity.ts), the same rule that decided the
   * mark, so the sheet cannot show the facts of a row whose dot is still drawn beside it.
   *
   * **It does not consult the filter**, and that is the decision: these are facts about the place
   * the sheet is already about, not a community mark the diver asked to see. Switching sites off
   * says "do not put the catalogue on my map"; it does not say "do not tell me what my own dive
   * site is".
   *
   * Read from the whole catalogue rather than from the placed rows, because a row can perfectly
   * well know its country and its entry and have no pin — that is §5's ordinary new site.
   */
  const placeSite =
    selectedPlace === undefined
      ? undefined
      : catalogue.sites.find((row) => catalogueSiteIdentity(row.id) === selectedPlace.key);
  const placeFacts = placeSite === undefined ? null : formatSiteFacts(placeSite, units);

  /**
   * **What a tapped mark does, and the rule is now one sentence: a catalogue row goes to its
   * page, and your own dives open a sheet** (M3f).
   *
   * M3e had to say it in two, and said so: *"A site — the diver's own place or the catalogue's row
   * — opens a sheet, because a site has nowhere else in the app to be shown: the sheet IS its
   * page. A centre has a page, so its mark goes there, and drawing a peek of that page under the
   * map would be the same three facts in two places for one of them to fall behind (§4.1)."* The
   * premise of the first half was true when it was written and is not now: `/site/[id]` exists, so
   * a community site's sheet became precisely the peek that paragraph refuses — its whole content
   * was `formatSiteFacts`, which is a strict subset of the page's own cluster. The sheet went, and
   * M3e's own §4.1 argument is what removed it rather than a new opinion.
   *
   * **What is left is a better rule than the one it replaces**, and it is legible from the mark:
   * the mark that opens a sheet is the one wearing a numeral, because the numeral is what says
   * *these dives are yours*. The two catalogue marks — a plain dot and a storefront glyph — both
   * leave the screen. M3e's worry was that a diver should never have to work out which kind of
   * thing they are about to press, and one rule over two kinds of interior answers it better than
   * one exception did.
   *
   * The sheet a diver's own place opens is unchanged and is not a page of anything: it is about a
   * GROUP OF DIVES, which may have no catalogue row behind it at all (every dive at a hand-typed
   * site), and it draws them in their own depth bands. Where the catalogue does know the place, the
   * sheet says so and offers the page (`placeSite` above).
   */
  const pressMark = (mark: MapMark) => {
    if (mark.kind === 'centers') {
      router.push(`/center/${mark.key}`);
      return;
    }
    if (mark.kind === 'community') {
      router.push(`/site/${mark.key}`);
      return;
    }
    setSelected({ kind: mark.kind, key: mark.key });
  };

  /** The sheet's way out — §0.6's one treatment for leaving, shared with the dive detail's back
   * control and the form's `‹ Cancel` through `backControl` (theme/styles.ts). */
  const closeSheet = (label: string) => (
    <Pressable
      style={styles.mapSheetClose}
      onPress={() => setSelected(null)}
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
        {/* **The ways into the two directories, each while its own kind is switched on** (M3c for
            centres, M3f for sites). §0.6's day-strip action — "a bordered pill in tracked
            uppercase, not plain text, so it reads as a control rather than a label" — because that
            is exactly what these are, and inventing a second treatment for one control is what
            §0.6 exists to stop.

            They are tied to the filter rather than living in the capsule for a measured reason:
            the header's trailing reserve is derived from a glyph COUNT, so a glyph that appeared
            in one state only would either under-reserve there or leave a column of empty header on
            the others. And they are drawn on **every** branch, the failing one included, on the
            same reasoning the capsule is: a directory reads the same table and says so for itself,
            and a control that vanished when the data failed would strand a diver on the broken
            half.

            **One row for both.** A second row would push the map down by a row's height for a
            diver who switched both kinds on, and the two pills are the same object about two
            tables; the row is only drawn at all when at least one of them is in it. */}
        {(shown.has('community') || shown.has('centers')) && (
          <View style={styles.mapDirectoryRow}>
            {shown.has('community') && (
              <DirectoryLink label="All sites" href="/sites" styles={styles} />
            )}
            {shown.has('centers') && (
              <DirectoryLink label="All centres" href="/centers" styles={styles} />
            )}
          </View>
        )}
        {failures.map((sentence) => (
          <View key={sentence} style={styles.mapNotice}>
            <Text style={styles.mapNoticeText}>{sentence}</Text>
          </View>
        ))}
        {messages.length > 0 && (
          <View style={styles.centerFill}>
            {messages.map((sentence) => (
              <Text key={sentence} style={styles.messageText}>
                {sentence}
              </Text>
            ))}
          </View>
        )}
        {/* The map is drawn only when there is somewhere to put it — `regionFor` returns null
            for no marks, and §1 would rather open a tab that says something true than centre a
            map on a place the diver has never been.

            **The region is computed at mount and does not follow the filter** (`initialRegion`,
            M2n's own choice against a ref and `fitToCoordinates`), so switching a kind on adds
            its marks without moving the camera off what the diver was looking at — which is right
            for a filter, and does mean a lone centre a hundred miles away is added off-screen. */}
        {region !== null && (
          <DiveMap
            scheme={scheme}
            region={region}
            marks={marks}
            selected={selected}
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
            {/* What the catalogue knows about this place, when it knows it at all — one line from
                `formatSiteFacts`, which is also what the site's own page spells out as labelled
                rows. **Two renderings of five values and not two answers**: every value comes from
                the same formatter either way, so the words cannot drift; what differs is the
                measure, since a card under a map has one line and a page has rows. That is the
                same relation `formatCenterRow` already has to a centre page's fact rows. */}
            {placeFacts !== null && <Text style={styles.mapSheetFacts}>{placeFacts}</Text>}
            {/* **And the way to that page, for the place the catalogue does know.** This is what
                makes absorbing a catalogue row into the diver's own mark cost nothing (M3e's rule,
                `sitesWithoutYourMark`): the dot is gone, and the facts AND the page it led to are
                both still reachable from the mark standing on it. Drawn only where there is a row
                to open — a dive at a hand-typed site has no page, which is every dive in a logbook
                that has never synced. */}
            {placeSite !== undefined && (
              <DirectoryLink
                label="Site page"
                href={`/site/${placeSite.id}`}
                announce={`Open ${siteLabel(placeSite)}`}
                style={styles.mapSheetAction}
                styles={styles}
              />
            )}
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
 *
 * **A site's own page was what M3e left owed, and M3f built it.** That note asked for four things
 * and all four are here: the route (`/site/[id]`), the way in from the dive detail's *Site* row,
 * the directory at `/sites`, and a caller at last for §2.3's `search_sites`. What it got wrong was
 * the last sentence — *"the sheet is not a prototype of that page; both can exist"* — which is
 * true of the sheet a diver's OWN place opens and was not true of the community site's. That one
 * held `formatSiteFacts` and nothing else, which is a strict subset of the page's own cluster, so
 * it was the peek §4.1 refuses; it is gone and its mark navigates. The place sheet stays, because
 * it is about a group of dives rather than about a row, it exists for places the catalogue has
 * never heard of, and it now carries the way to the page for the ones it has.
 */

import { useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { conditionIconFor } from '../components/ConditionIcon';
import { ConditionTiles, type ConditionTile } from '../components/ConditionTiles';
import { DiveRow } from '../components/DiveRow';
import { MapCard } from '../components/MapCard';
import { useDives } from '../db/useDives';
import { useDiveSampleShapes } from '../db/useDiveSampleShapes';
import { useDiveSites } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { catalogueUnreadable, logbookUnreadable } from '../domain/logbook';
import { logbookStats } from '../domain/logbookStats';
import { pointOf, waterTempRange } from '../domain/mapSites';
import { SITE_DEFAULT_FIELDS, siteDefaultValue, type SiteDefaultField } from '../domain/siteDefaults';
import { divesAtSite } from '../domain/siteDives';
import { type DiveSite, type Salinity, type WaterBody } from '../domain/types';
import {
  formatAltNames,
  formatCoordinates,
  formatAltitude,
  formatDepth,
  formatPlaceToken,
  formatSalinity,
  formatSiteSummary,
  formatSuitableFor,
  formatWaterBody,
  formatWreck,
  unnamedSite,
} from '../format/display';
import { t, useT } from '../i18n';
import { backToSites } from '../navigation/leaveScreen';
import { completePlacePick, firstParam, placePickRequest } from '../navigation/placePick';
import { showOnMap } from '../platform/showOnMap';
import { type UnitSystem } from '../format/units';
import { resolveScheme } from '../theme/resolve';
import { liftedBottomInset, makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * **One dive site's own page** (`/site/[id]`, M3f) — the screen `dive_sites` never had, and the
 * one every dive in the app already refers to.
 *
 * A dive *centre* got a page and a directory in M3c, and until now the newer and emptier of the
 * two concepts had more surface than the one every dive names: a site could be shown only inside
 * the Map tab's sheet, which is reachable by finding a mark, has no route, cannot be linked to,
 * and says almost nothing about a site the diver has never dived. M3e's own closing note is the
 * brief for this file.
 *
 * ── What it shows, and what a site has that a centre does not ─────────────────────────────
 *
 * Two halves, and the second is what makes a site's page a different page rather than the centre
 * one with a noun swapped.
 *
 * **The diver's own dives here**, which is the half no table holds — the logbook groups by trip,
 * the Map groups by place, Stats counts the logbook, and none of them answers "what have I done
 * at this rock". `divesAtSite` (domain/siteDives.ts) owns which dives those are.
 *
 * **What the catalogue knows**, which for a site is §6's `country`, `entry`, `salinity`,
 * `water_body` and its own `max_depth_m` — where a centre has a `website` — and #31's facts. Three
 * of them are §2.1's **site defaults**, and the page is where a diver can see what picking this site
 * will put into a new dive. **They stand in one cluster with the rest, and a note under it names
 * them** (the owner's pick C, 2026-11-17) — a list with nothing said would give a diver no way to
 * tell the facts that *do something* from the facts that merely describe, and §2.1's precedence is
 * a rule worth being able to see before it fires rather than only after it has.
 *
 * ── The site's own depth is not any dive's, and this page is where the two meet ────────────
 *
 * §6 calls `max_depth_m` *"(site depth)"* and §2.3 refuses to seed it from a dive, because *"a
 * 12 m dive on a 40 m wall would publish 'this site is 12 m deep'"*. This is the one screen in the
 * app that shows both figures at once — `deepest 18.2 m` in the summary line is the diver's own
 * deepest dive here, `Site depth 42.0 m` in the cluster is the rock — so the row is labelled *Site
 * depth* rather than *Depth*: the two numbers sit inches apart and the shorter label is exactly
 * the confusion M2o's report says bit.
 *
 * ── The three states, kept apart ──────────────────────────────────────────────────────────
 *
 * A site this device does not hold, a catalogue that could not be read, and a catalogue that has
 * not answered yet are three different things and each gets its own branch — §10's "a screen with
 * no answer must not state one", which `DiveDetailScreen`'s not-found branch records at length:
 * `useLiveQuery` hands back `[]` on the renders before its query returns, so *"Site not found"*
 * said unconditionally would be a claim about a database nothing has yet asked.
 *
 * **A merged site is "not found", and that is the answer rather than a gap** (§5, M2r).
 * `db/catalogue.ts`'s `pickable` hands back live, `status = 'active'` rows only, so a duplicate an
 * admin folded away has no page — and nothing here reads `merged_into`, because the pull that
 * delivers a merge repoints the dives themselves (`domain/merges.ts`). The consequence is that
 * this branch is nearly unreachable through the app's own links: a dive's *Site* row links by
 * `site_id`, and by the time the merge is on the device that id is the survivor's. What is left is
 * a stale deep link and a device that has been told about the merge but not yet given the
 * survivor — and for both of those, "not found" is true.
 *
 * ── Opened from a near-match, it can be picked ─────────────────────────────────────────────
 *
 * *New dive site* lists §2.3's near-matches above Save, and a tap opens the match here with the
 * dive form's pick token as `pick` (owner's call on PR #35: a diver checks that it really is the
 * same place before using it). Then, and only while the registry still holds that request, the
 * page carries **Use this site** — the inverted primary button, in the form's footer — which hands
 * the site to the form through `completePlacePick` and closes this page, the create page and the
 * picker. `‹ Back` returns to the create page as it was left. Either one is the way off, once: the
 * pick's dismiss and a `‹ Back` landing during it would otherwise pop the dive form too.
 */

/** What this page calls the site it is showing — its name, or `unnamedSite`.
 *
 * **A deliberate near-duplicate of `diveSiteLabel`, of `MapScreen`'s `siteLabel` and of
 * `DiveCenterScreen`'s `centerLabel`, and §4.1 requires it to say so.** `diveSiteLabel` answers
 * "what is this DIVE called" and falls through the dive's site and then its centre; this answers
 * it for a catalogue *site* row, which has only a name to lose. The words for having none are
 * `format/display.ts`'s, never a literal here, because a heading a screen reader announces as
 * nothing is worse than one it announces as unnamed. §5 asks a new site only for a name, so this
 * is an edge — but `dive_sites.name` is nullable in both databases (§6, so §7's one-transaction
 * push can never reject a diver's whole sync over one row) and a null can arrive in a pull. */
function siteLabel(site: Pick<DiveSite, 'name'>): string {
  return site.name ?? unnamedSite();
}

/**
 * What on *The site* each of §2.1's three defaults stands in, in the page's order: since issue #6 the
 * water body and the ways in are tiles and the salinity a row (the owner's call), so each default
 * names its own thing, by the label it is drawn with.
 */
const PREFILL_ROWS = ['salinity', 'waterBody', 'entry'] as const;

type PrefillRow = (typeof PREFILL_ROWS)[number];

/**
 * **Which thing each of §2.1's three defaults stands in** — derived from `SITE_DEFAULT_FIELDS`
 * (domain/siteDefaults.ts) rather than listed again here.
 *
 * §4.1's *"derive, or tie at compile time"*, and it is the tie: this is a `Record` over the field
 * union, so a fourth default added to that module does not compile until this page decides what it
 * fills and so whether the note names it. A hand-written list would agree today and go stale the day
 * the list moves — which is the failure `siteDefaults.ts`' own type assertion exists to have caught
 * once already, in the other direction. Salinity and water body shared one *Water* row (`Salt ·
 * Ocean`) until issue #6 made the water body a tile.
 */
const ROW_OF_DEFAULT: Record<SiteDefaultField, PrefillRow> = {
  salinity: 'salinity',
  waterBody: 'waterBody',
  entry: 'entry',
};

/** Each one's label — the one its row or tiles are drawn with and the one the note names it by, so
 * the two cannot read differently. */
const PREFILL_ROW_LABEL: Record<PrefillRow, () => string> = {
  salinity: () => t('field.salinity'),
  waterBody: () => t('field.waterBody'),
  entry: () => t('field.entry'),
};

/**
 * A site's salinity, read through the prefill's own rule (`siteDefaultValue`), so the row stands
 * exactly when the note names it. A value is a word this build may not know (§10's store-and-flag),
 * which the formatter takes as a word.
 */
function salinityLine(site: DiveSite): string | null {
  const salinity = siteDefaultValue(site, 'salinity');
  return salinity === null ? null : formatSalinity(salinity as Salinity);
}

/** Words only: a list from another client's build may hold a number or a null (#31). */
function wordsOf(list: readonly unknown[]): string[] {
  return list.filter((item): item is string => typeof item === 'string');
}

/**
 * **The site's tiles** (issue #6): its types, its water body and its ways in, each its drawing, its
 * word and its field, as the dive detail's conditions are. The water body by the prefill's own rule
 * (`siteDefaultValue`), so a tile stands exactly when the note can name it; every way in, as the set
 * holds them. Keyed by position, so a token stored twice cannot collide. A word this build does not
 * know keeps its word on an undrawn tile (§10's store-and-flag).
 */
function siteTiles(site: DiveSite): ConditionTile[] {
  const tiles: ConditionTile[] = wordsOf(site.siteTypes).map((type, index) => ({
    key: `type-${index}-${type}`,
    icon: conditionIconFor('siteType', type),
    value: formatPlaceToken('siteTypes', type),
    label: t('field.siteTypes'),
  }));
  const body = siteDefaultValue(site, 'waterBody');
  if (body !== null) {
    tiles.push({
      key: `body-${body}`,
      icon: conditionIconFor('waterBody', body),
      value: formatWaterBody(body as WaterBody) ?? body,
      label: PREFILL_ROW_LABEL.waterBody(),
    });
  }
  wordsOf(site.entry).forEach((way, index) =>
    tiles.push({
      key: `entry-${index}-${way}`,
      icon: conditionIconFor('entry', way),
      value: formatPlaceToken('entry', way),
      label: PREFILL_ROW_LABEL.entry(),
    }),
  );
  return tiles;
}

/**
 * **The note under *The site*: which of its rows fill in a new dive**, or `null` when none does.
 *
 * Decided field by field by the prefill's own reading, `siteDefaultValue`, so the page and the
 * prefill cannot disagree: *Salinity* and *Water body* when each is a default, *Entry* only when the
 * set holds exactly one way in — several are left to the diver (§2.1, #63), so the tiles draw them and
 * the note does not promise them. It states the tier it can promise and not the one it cannot: §2.1 puts
 * the site above carry-over and below anything the diver has typed, and a note claiming the rows are
 * simply "filled in" would be wrong about the tier that matters most.
 */
function prefillNote(site: DiveSite): string | null {
  const filled = new Set(
    SITE_DEFAULT_FIELDS.filter((field) => siteDefaultValue(site, field) !== null).map((field) => ROW_OF_DEFAULT[field]),
  );
  const names = PREFILL_ROWS.filter((row) => filled.has(row)).map((row) => PREFILL_ROW_LABEL[row]());
  const count = names.length;
  const last = names.pop();
  if (last === undefined) return null;
  // "A", "A and B", and for three "A, B and C": the last joined by the language's own *and*.
  const rows = names.length === 0 ? last : t('site.prefillRows', { first: names.join(', '), second: last });
  return t('site.prefillNote', { rows, count });
}

/**
 * The way out, in §0.6's one treatment for leaving — mono, muted, small, and never competing with
 * the content beside it (`backControl`, theme/styles.ts, shared with the dive detail's back and
 * the form's `‹ Cancel`).
 *
 * Rendered on **every** branch, the not-found one included, for `DiveDetailScreen`'s own stated
 * reason: a page reached by an unknown id is more of a dead end than a real one, not less.
 * `backToSites` (navigation/leaveScreen.ts) owns where it lands.
 *
 * **It says *Back*, not *‹ Sites*, and that is the owner's own finding** (M3k): this page is
 * reached from the sites directory, from a mark on the Map's community layer, and from a dive's
 * own *Site* row, and `leaveTo` pops the stack — so on two of those three entrances the label was
 * naming somewhere the diver had not been. The navigation was right the whole time. **A way out
 * names a destination only when the screen has exactly one way in**, and this one has three; the
 * directory in `backToSites` is a fallback for a cold deep link, not a promise the control may
 * make. M3c recorded the same thing about the centre page and read it as a precedent rather than
 * as a defect (*"consistent rather than new"*), which is how it reached a second page.
 */
function BackButton({ styles, onPress = backToSites }: { styles: Styles; onPress?: () => void }) {
  return (
    <Pressable
      style={styles.detailBack}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('back.anyLabel')}
    >
      <Text style={styles.detailBackLabel}>{t('back.any')}</Text>
    </Pressable>
  );
}

/** One catalogue fact, in the row grammar §0.6 gives every label-and-value pair in the app
 * (`formField`/`formFieldRow`/`formFieldLabel`, read exactly as Settings, the Stats tab and a
 * centre's page read them). Not a new vocabulary for one screen. */
function FactRow({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.formField}>
      <View style={styles.formFieldRow}>
        <Text style={styles.factLabel}>{label}</Text>
        <Text style={styles.siteFactValue}>{value}</Text>
      </View>
    </View>
  );
}

interface DiveSiteScreenProps {
  /** Overrides the route's own `id` param, on `DiveDetailScreen`'s and `DiveCenterScreen`'s
   * precedent — the routed case (`/site/[id]`) passes none and reads `useLocalSearchParams()`. */
  id?: string;
}

export default function DiveSiteScreen({ id: idProp }: DiveSiteScreenProps = {}) {
  // The subscription that repaints this screen when the diver changes the language (src/i18n) —
  // a screen root, so nothing above it re-renders on its own.
  useT();
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const units = useUnitSystem();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[]; pick?: string | string[] }>();
  const routeId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = idProp ?? routeId;
  // Opened from a near-match on *New dive site*: the form's token, and whether its request is still
  // there to answer — read once, as the picker and the create page read theirs.
  const pickToken = firstParam(params.pick);
  const [picking] = useState(() => pickToken !== undefined && placePickRequest(pickToken) !== null);
  const leaving = useRef(false);
  const once = (go: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    go();
  };
  // Only while picking is `‹ Back` claimed with *Use this site*; otherwise it is the page's own.
  const back = picking ? () => once(backToSites) : backToSites;

  const catalogue = useDiveSites();
  const { dives, numbers, resolved: logbookResolved, error: logbookError } = useDives();
  // Task 6's row sparkline map — its own hook, read alongside `useDives()` with neither of its
  // own `resolved`/`error` consulted: a failed sample-series read must not blank this screen
  // the way a failed DIVES read does.
  const { shapes } = useDiveSampleShapes();

  const site = catalogue.sites.find((row) => row.id === id);

  if (site === undefined) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackButton styles={styles} onPress={back} />
        <View style={styles.centerFill}>
          {/* Three states, one branch each. A failed read must never read as "not found", and a
              read that has not answered says nothing at all — the frame is drawn, and the sentence
              arrives under it when there is one (§10, `DiveDetailScreen`). */}
          {catalogue.error !== undefined && <Text style={styles.messageText}>{catalogueUnreadable()}</Text>}
          {catalogue.error === undefined && catalogue.resolved && (
            <Text style={styles.messageText}>{t('site.notFound')}</Text>
          )}
        </View>
      </View>
    );
  }

  const myDives = divesAtSite(dives, site);

  /**
   * What the page says about the diver's own dives here, or nothing at all while the logbook has
   * not answered.
   *
   * `formatSiteSummary` (format/display.ts) is the same sentence the Map tab's own sheet carries
   * about a place, asked of the same two owners (`logbookStats` and `waterTempRange`) — §3's
   * *depth/temp* pair, said once. **It always states the count, `0 dives` included**, which is
   * what a page opened to ask "what have I done here" has to answer even when the answer is none;
   * that is the one place this page deliberately differs from `formatSiteRow`, where a nought
   * would be noise on every row of a community directory.
   */
  const summary = logbookError || !logbookResolved
    ? null
    : formatSiteSummary(logbookStats(myDives), waterTempRange(myDives), units);

  const point = pointOf(site);
  const coordinates = formatCoordinates(site.latitude, site.longitude);
  const description = site.description !== null && site.description.trim() !== '' ? site.description : null;

  const header = (
    <View>
      <Text style={styles.siteHeading}>{siteLabel(site)}</Text>
      {summary !== null && <Text style={styles.siteSummary}>{summary}</Text>}
      {/* The one failure that has to be said here: the site is on screen and readable, and it is
          the logbook underneath it that could not be opened — `logbookUnreadable()`
          (domain/logbook.ts), the same sentence five other screens say about the same event. */}
      {logbookError !== undefined && <Text style={styles.siteSummary}>{logbookUnreadable()}</Text>}
      {/* The description (#31) comes first, under the page's own lines: what a diver opened the
          page to read. Only when it says something; its newlines are the author's and nothing
          cuts it short. */}
      {description !== null && <Text style={styles.siteDescription}>{description}</Text>}
      {/* **"Show on map"** (issue #21) — the dive detail's card, under the description where the
          design canvas draws it, and only for a site with a position a map can show (`pointOf`).
          It opens Ponor's map pointed at this site (`platform/showOnMap.ts`), selecting the diver's own mark where they have dived it — that is the mark
          standing there (`domain/mapFocus.ts`). */}
      {point !== null && coordinates !== null && (
        <MapCard
          styles={styles}
          scheme={scheme}
          coordinates={coordinates}
          onPress={() => showOnMap({ kind: 'site', id: site.id, overItsPage: true }, point, siteLabel(site))}
        />
      )}
      <SiteFacts site={site} units={units} styles={styles} scheme={scheme} />
      {myDives.length > 0 && <Text style={styles.siteSectionTitle}>{t('place.yourDives')}</Text>}
    </View>
  );

  const pickThisSite = () =>
    once(() => {
      if (pickToken !== undefined) completePlacePick(pickToken, { id: site.id, name: site.name ?? '' }, 3);
    });

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      <BackButton styles={styles} onPress={back} />
      <FlatList
        style={styles.siteScroll}
        data={myDives}
        keyExtractor={(dive) => dive.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <DiveRow
            dive={item}
            number={numbers.get(item.id)}
            points={shapes.get(item.id)}
            scheme={scheme}
            units={units}
            onPress={(diveId) => router.push(`/dive/${diveId}`)}
          />
        )}
        // The device's own clearance rather than a constant (`screenBottomInset`, theme/styles.ts):
        // this screen is pushed OVER the tab bar, so its list runs to the bottom of the display and
        // the last dive would otherwise scroll under the Liquid Glass.
        // While picking, the footer below clears the home indicator instead.
        contentContainerStyle={[styles.siteContent, { paddingBottom: picking ? 24 : screenBottomInset(insets.bottom) }]}
      />
      {picking && (
        <View style={[styles.formFooter, { paddingBottom: liftedBottomInset(insets.bottom, 24, false) }]}>
          <Pressable
            style={styles.action}
            onPress={pickThisSite}
            accessibilityRole="button"
            accessibilityLabel={t('site.useThisSite')}
          >
            <Text style={styles.actionLabel}>{t('site.useThisSite')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * **What the catalogue knows, in one cluster, and a note under it saying which rows do something**
 * (the owner's pick C on the board *#31 · Site defaults, altitude offer*, 2026-11-17).
 *
 * *The site* holds every fact in the canvas's order — its type, the level it suits, its own depth,
 * its altitude, its wreck, its water, its ways in, its other names and its country (#31) — each only
 * when filled. Three of them are what §2.1's defaults will **do**: picking this site on a new dive
 * writes them into it, over anything carried from the diver's last dive. The note names those rows
 * (`prefillNote`), by the prefill's own rule, so a page that lists everything together still lets a
 * diver see the rule before it fires. It replaced a *Site defaults* cluster of its own, which the
 * canvas never drew.
 *
 * **The cluster and the note are absent when they hold nothing**, which is the shape §0.6 requires on
 * the dive detail and `DiveCenterScreen` already follows: a heading over zero rows is worse than no
 * heading. §5 asks a new site only for a name, so a row that draws no cluster is the ordinary shape
 * rather than a degraded one (§1: a sparse row is normal, not broken) — and `null` in one of these
 * columns means *the catalogue does not know*, never *the answer is empty* (`domain/siteDefaults.ts`),
 * which is exactly why an absent row is the honest rendering of it and an em dash would not be.
 */
function SiteFacts({ site, units, styles, scheme }: { site: DiveSite; units: UnitSystem; styles: Styles; scheme: ColorScheme }) {
  const country = site.country !== null && site.country !== '' ? site.country : null;
  // **The site's types, water body and ways in lead as tiles** (issue #6, the owner's call), each
  // its drawing and its word, as the dive detail's conditions are; see `siteTiles`.
  const tiles = siteTiles(site);
  // The canvas's order, each row only when it holds something (§1).
  const facts = [
    { label: t('field.suitableFor'), value: formatSuitableFor(site.suitableFor) },
    // **"Site depth", never "Depth"** — §6's own parenthesis, and the summary line a few points
    // above is already showing the diver's deepest dive here. Two depths on one screen with one
    // of them unlabelled is the confusion §2.3 refuses to create in the other direction when it
    // declines to seed this column from a dive. Ink, as the page has always drawn it (§0.1).
    { label: t('field.siteDepth'), value: formatDepth(site.maxDepthM, units) },
    // A height above sea level, not a depth: whole units, signed, ink — no band colour (§0.1).
    { label: t('field.altitude'), value: formatAltitude(site.altitudeM, units) },
    { label: t('field.wreck'), value: formatWreck(site.wreckName, site.wreckSunkYear) },
    // The salinity, the one of the three with no shape to draw; the water body and the ways in are
    // tiles above (issue #6), and the note says when any of them is a default.
    { label: PREFILL_ROW_LABEL.salinity(), value: salinityLine(site) },
    { label: t('field.altNames'), value: formatAltNames(site.altNames) },
    { label: t('field.country'), value: country },
  ].filter((row): row is { label: string; value: string } => row.value !== null);
  const note = prefillNote(site);

  if (facts.length === 0 && tiles.length === 0) return null;
  return (
    <View>
      <Text style={styles.siteSectionTitle}>{t('site.facts')}</Text>
      <ConditionTiles tiles={tiles} scheme={scheme} />
      {facts.map((row) => (
        <FactRow key={row.label} label={row.label} value={row.value} styles={styles} />
      ))}
      {/* One sentence under the cluster rather than a mark on each row — §0.6's own reasoning about
          the carried-over return mark applied one screen over: a second symbol is new vocabulary
          for a single case, and this case has a sentence's worth to say. */}
      {note !== null && (
        <View style={styles.siteFactsNote}>
          <Text style={styles.siteFactsNoteText}>{note}</Text>
        </View>
      )}
    </View>
  );
}

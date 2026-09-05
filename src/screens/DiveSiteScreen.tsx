import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DiveRow } from '../components/DiveRow';
import { useDives } from '../db/useDives';
import { useDiveSites } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { CATALOGUE_UNREADABLE, LOGBOOK_UNREADABLE } from '../domain/logbook';
import { logbookStats } from '../domain/logbookStats';
import { waterTempRange } from '../domain/mapSites';
import { SITE_DEFAULT_FIELDS, type SiteDefaultField } from '../domain/siteDefaults';
import { divesAtSite } from '../domain/siteDives';
import { type DiveSite } from '../domain/types';
import {
  formatDepth,
  formatEntry,
  formatSalinity,
  formatSiteSummary,
  formatWaterBody,
  UNNAMED_SITE,
} from '../format/display';
import { backToSites } from '../navigation/leaveScreen';
import { type UnitSystem } from '../format/units';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';

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
 * `water_body` and its own `max_depth_m` — where a centre has a `website`. Three of those five are
 * §2.1's **site defaults**, and the page is where a diver can see what picking this site will put
 * into a new dive; the other two describe the place and prefill nothing. **They are drawn as two
 * clusters for exactly that reason** — a single list would give a diver no way to tell the facts
 * that *do something* from the facts that merely describe, and §2.1's precedence is a rule worth
 * being able to see before it fires rather than only after it has.
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
 */

/** What this page calls the site it is showing — its name, or `UNNAMED_SITE`.
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
  return site.name ?? UNNAMED_SITE;
}

/**
 * **The three columns §2.1 prefills from, as rows** — derived from `SITE_DEFAULT_FIELDS`
 * (domain/siteDefaults.ts) rather than listed again here.
 *
 * §4.1's *"derive, or tie at compile time"*, and it is the tie rather than the derivation: this is
 * a `Record` over the field union, so a fourth default added to that module does not compile until
 * this page decides what to call it and how to read it, and a field dropped from it stops being
 * drawn without anyone remembering to look here. A hand-written array of three labels would agree
 * today and go stale the day the list moves — which is the failure `siteDefaults.ts`' own type
 * assertion exists to have caught once already, in the other direction.
 *
 * The labels are the dive form's and the dive detail's own words for the same three fields, which
 * is §4.1's one recorded exception (roughly twenty-five duplicated field labels, unified when
 * i18next keys them and not before). The VALUES go through `format/display.ts`, so a site's entry
 * reads the same word here as on a dive logged at it.
 */
const SITE_DEFAULT_ROWS: Record<SiteDefaultField, { label: string; read: (site: DiveSite) => string | null }> = {
  entry: { label: 'Entry', read: (site) => formatEntry(site.entry) },
  salinity: { label: 'Salinity', read: (site) => formatSalinity(site.salinity) },
  waterBody: { label: 'Water body', read: (site) => formatWaterBody(site.waterBody) },
};

/**
 * The way out, in §0.6's one treatment for leaving — mono, muted, small, and never competing with
 * the content beside it (`backControl`, theme/styles.ts, shared with the dive detail's back and
 * the form's `‹ Cancel`).
 *
 * Rendered on **every** branch, the not-found one included, for `DiveDetailScreen`'s own stated
 * reason: a page reached by an unknown id is more of a dead end than a real one, not less.
 * `backToSites` (navigation/leaveScreen.ts) owns where it lands.
 */
function BackButton({ styles }: { styles: Styles }) {
  return (
    <Pressable
      style={styles.detailBack}
      onPress={backToSites}
      accessibilityRole="button"
      accessibilityLabel="Back to sites"
    >
      <Text style={styles.detailBackLabel}>‹ Sites</Text>
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
        <Text style={styles.formFieldLabel}>{label}</Text>
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
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const units = useUnitSystem();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = idProp ?? routeId;

  const catalogue = useDiveSites();
  const { dives, numbers, resolved: logbookResolved, error: logbookError } = useDives();

  const site = catalogue.sites.find((row) => row.id === id);

  if (site === undefined) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackButton styles={styles} />
        <View style={styles.centerFill}>
          {/* Three states, one branch each. A failed read must never read as "not found", and a
              read that has not answered says nothing at all — the frame is drawn, and the sentence
              arrives under it when there is one (§10, `DiveDetailScreen`). */}
          {catalogue.error !== undefined && <Text style={styles.messageText}>{CATALOGUE_UNREADABLE}</Text>}
          {catalogue.error === undefined && catalogue.resolved && (
            <Text style={styles.messageText}>Site not found.</Text>
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

  const header = (
    <View>
      <Text style={styles.siteHeading}>{siteLabel(site)}</Text>
      {summary !== null && <Text style={styles.siteSummary}>{summary}</Text>}
      {/* The one failure that has to be said here: the site is on screen and readable, and it is
          the logbook underneath it that could not be opened — `LOGBOOK_UNREADABLE`
          (domain/logbook.ts), the same sentence five other screens say about the same event. */}
      {logbookError !== undefined && <Text style={styles.siteSummary}>{LOGBOOK_UNREADABLE}</Text>}
      <SiteFacts site={site} units={units} styles={styles} />
      {myDives.length > 0 && <Text style={styles.siteSectionTitle}>Your dives</Text>}
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      <BackButton styles={styles} />
      <FlatList
        style={styles.siteScroll}
        data={myDives}
        keyExtractor={(dive) => dive.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <DiveRow
            dive={item}
            number={numbers.get(item.id)}
            scheme={scheme}
            units={units}
            onPress={(diveId) => router.push(`/dive/${diveId}`)}
          />
        )}
        // The device's own clearance rather than a constant (`screenBottomInset`, theme/styles.ts):
        // this screen is pushed OVER the tab bar, so its list runs to the bottom of the display and
        // the last dive would otherwise scroll under the Liquid Glass.
        contentContainerStyle={[styles.siteContent, { paddingBottom: screenBottomInset(insets.bottom) }]}
      />
    </View>
  );
}

/**
 * **What the catalogue knows, in two clusters, and the split is the point.**
 *
 * *Site* holds the facts that describe the place — its country and its own depth. *Site defaults*
 * holds §2.1's three, which are the ones that will **do something**: picking this site on a new
 * dive writes them into it, over anything carried from the diver's last dive. A page that listed
 * all five together would be showing a diver a rule they cannot see and cannot predict, on the one
 * screen that has room to explain it.
 *
 * **Either cluster is absent when it holds nothing**, which is the shape §0.6 requires on the dive
 * detail and `DiveCenterScreen` already follows: a heading over zero rows is worse than no
 * heading. §5 asks a new site only for a name, so a row that draws neither cluster is the ordinary
 * shape rather than a degraded one (§1: a sparse row is normal, not broken) — and `null` in one of
 * these columns means *the catalogue does not know*, never *the answer is empty*
 * (`domain/siteDefaults.ts`), which is exactly why an absent row is the honest rendering of it and
 * an em dash would not be.
 */
function SiteFacts({ site, units, styles }: { site: DiveSite; units: UnitSystem; styles: Styles }) {
  const country = site.country !== null && site.country !== '' ? site.country : null;
  const depth = formatDepth(site.maxDepthM, units);
  const defaults = SITE_DEFAULT_FIELDS.map((field) => ({
    label: SITE_DEFAULT_ROWS[field].label,
    value: SITE_DEFAULT_ROWS[field].read(site),
  })).filter((row): row is { label: string; value: string } => row.value !== null);

  return (
    <View>
      {(country !== null || depth !== null) && (
        <View>
          <Text style={styles.siteSectionTitle}>Site</Text>
          {country !== null && <FactRow label="Country" value={country} styles={styles} />}
          {/* **"Site depth", never "Depth"** — §6's own parenthesis, and the summary line a few
              points above it is already showing the diver's deepest dive here. Two depths on one
              screen with one of them unlabelled is the confusion §2.3 refuses to create in the
              other direction when it declines to seed this column from a dive. */}
          {depth !== null && <FactRow label="Site depth" value={depth} styles={styles} />}
        </View>
      )}
      {defaults.length > 0 && (
        <View>
          <Text style={styles.siteSectionTitle}>Site defaults</Text>
          {defaults.map((row) => (
            <FactRow key={row.label} label={row.label} value={row.value} styles={styles} />
          ))}
          {/* One sentence under the group rather than a mark on each row — §0.6's own reasoning
              about the carried-over return mark applied one screen over: a second symbol is new
              vocabulary for a single case, and this case has a sentence's worth to say. It states
              the tier it can promise and not the one it cannot: §2.1 puts the site above
              carry-over and below anything the diver has typed, and a caption claiming the rows
              are simply "filled in" would be wrong about the tier that matters most. */}
          <View style={styles.siteDefaultsCaption}>
            <Text style={styles.siteDefaultsCaptionText}>
              Picking this site on a new dive fills these in, over anything carried from your last
              dive.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

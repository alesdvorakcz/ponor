import { router, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DiveRow } from '../components/DiveRow';
import { useDiveCenters } from '../db/useDiveCenters';
import { useDives } from '../db/useDives';
import { useUnitSystem } from '../db/useUnitSystem';
import { divesWithCenter } from '../domain/centerDives';
import { CATALOGUE_UNREADABLE, LOGBOOK_UNREADABLE } from '../domain/logbook';
import { logbookStats } from '../domain/logbookStats';
import { waterTempRange } from '../domain/mapSites';
import { formatSiteSummary, UNNAMED_CENTER } from '../format/display';
import { backToCenters } from '../navigation/leaveScreen';
import { isOpenableWebsite, openWebsite } from '../platform/openWebsite';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';

/**
 * **One dive centre's own page** (`/center/[id]`, M3c) — the screen `dive_centers` never had.
 *
 * Nothing in `src/` read that table on screen before this milestone: a diver could add a centre
 * from the dive form (§2.3, M2o), watch `usePendingChanges` count it, watch it sync, and never
 * see it again anywhere in the app. §6 has held `name`, `country`, `website`, `location` since
 * M2a with no reader, which makes this closer to a defect than to a feature.
 *
 * ── What it shows, and what makes it worth opening for the common centre ──────────────────
 *
 * §2.3 is explicit that **a centre inherits its name alone**: the dive form's pin is where the
 * diver got into the water, so writing it to a centre would file a dive site as the shop's
 * address, and there is no country either, because §2.3 derives a country from a pin and from
 * nothing else. **So the ordinary centre in this app is a name and nine nulls**, and a page that
 * only knew how to display catalogue facts would be an empty screen for every centre a diver has
 * ever created.
 *
 * What makes it worth opening anyway is the half the catalogue does not hold: **the diver's own
 * dives with them**. That is a question nothing else in the app answers — the logbook groups by
 * trip (`tripKeyOf`, which reads the centre but never lists by it), the Map groups by site, and
 * Stats counts the logbook — so a centre with nothing but a name still opens on `3 dives ·
 * deepest 18.2 m · 18–24 °C` over the three rows themselves. The catalogue's own facts are a
 * cluster that is simply absent when the row carries none, exactly as an unrecorded field is
 * absent on a dive's detail (§1: a sparse row is normal, not broken).
 *
 * ── Which dives count ─────────────────────────────────────────────────────────────────────
 *
 * `divesWithCenter` (domain/centerDives.ts) owns it, and its docblock carries the whole rule and
 * why it is not `siteIdentityOf`. Two consequences are visible here: a dive that carries a
 * `center_id` is decided by that id alone, so this page never claims another centre's dives; and
 * §2.4's planned dives are excluded, so a page opened from a *plan* with this centre reads
 * `0 dives` — which is the same answer the Map's site sheet gives a planned dive, for the same
 * reason, rather than an inconsistency introduced here.
 *
 * ── The three states, kept apart ──────────────────────────────────────────────────────────
 *
 * A centre this device does not hold, a catalogue that could not be read, and a catalogue that
 * has not answered yet are three different things and each gets its own branch — §10's "a screen
 * with no answer must not state one", which `DiveDetailScreen`'s own not-found branch records at
 * length: `useLiveQuery` hands back `[]` on the renders before its query returns, so *"Centre not
 * found"* said unconditionally would be a claim about the database that nothing has yet asked it.
 *
 * `db/catalogue.ts`'s `pickable` is what decides whether a centre is here at all: live, and
 * `status = 'active'`. So a centre an admin merged away is **not found** rather than shown beside
 * its survivor — and nothing on this screen reads `merged_into`, because M2r repoints the dives
 * themselves on the pull that delivers the merge (§5, and `domain/merges.ts` owns the rule).
 */

/** What this page calls the centre it is showing — its name, or `UNNAMED_CENTER`.
 *
 * **A deliberate near-duplicate of `diveSiteLabel`, and of `MapScreen`'s own `siteLabel`, and
 * §4.1 requires it to say so.** `diveSiteLabel` answers "what is this DIVE called" and falls
 * through the dive's site and then its centre; `siteLabel` answers it for a catalogue *site*
 * row; this answers it for a catalogue *centre* row, which has only a name to lose. The words
 * for having none are `format/display.ts`'s, never a literal here, because a heading a screen
 * reader announces as nothing is worse than one it announces as unnamed. */
function centerLabel(center: { name: string | null }): string {
  return center.name ?? UNNAMED_CENTER;
}

/**
 * The way out, in §0.6's one treatment for leaving — mono, muted, small, and never competing
 * with the content beside it (`backControl`, theme/styles.ts, shared with the dive detail's back
 * and the form's `‹ Cancel`).
 *
 * Rendered on **every** branch, the not-found one included, for `DiveDetailScreen`'s own stated
 * reason: a page reached by an unknown id is more of a dead end than a real one, not less.
 * `backToCenters` (navigation/leaveScreen.ts) owns where it lands.
 */
function BackButton({ styles }: { styles: Styles }) {
  return (
    <Pressable
      style={styles.detailBack}
      onPress={backToCenters}
      accessibilityRole="button"
      accessibilityLabel="Back to centres"
    >
      <Text style={styles.detailBackLabel}>‹ Centres</Text>
    </Pressable>
  );
}

/** One catalogue fact, in the row grammar §0.6 gives every label-and-value pair in the app
 * (`formField`/`formFieldRow`/`formFieldLabel`, read exactly as Settings and the Stats tab read
 * them). Not a new vocabulary for one screen. */
function FactRow({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.formField}>
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        <Text style={styles.centerFactValue}>{value}</Text>
      </View>
    </View>
  );
}

interface DiveCenterScreenProps {
  /** Overrides the route's own `id` param, on `DiveDetailScreen`'s precedent — the routed case
   * (`/center/[id]`) passes none and reads `useLocalSearchParams()`. */
  id?: string;
}

export default function DiveCenterScreen({ id: idProp }: DiveCenterScreenProps = {}) {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const units = useUnitSystem();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = idProp ?? routeId;

  const catalogue = useDiveCenters();
  const { dives, numbers, resolved: logbookResolved, error: logbookError } = useDives();

  const center = catalogue.centers.find((row) => row.id === id);

  if (center === undefined) {
    return (
      <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
        <BackButton styles={styles} />
        <View style={styles.centerFill}>
          {/* Three states, one branch each. A failed read must never read as "not found", and
              a read that has not answered says nothing at all — the frame is drawn, and the
              sentence arrives under it when there is one (§10, `DiveDetailScreen`). */}
          {catalogue.error !== undefined && <Text style={styles.messageText}>{CATALOGUE_UNREADABLE}</Text>}
          {catalogue.error === undefined && catalogue.resolved && (
            <Text style={styles.messageText}>Centre not found.</Text>
          )}
        </View>
      </View>
    );
  }

  const myDives = divesWithCenter(dives, center);
  const website = center.website;
  // Both facts are absent on every centre this app creates (§2.3), so the cluster is drawn only
  // when the catalogue actually knows something — the same rule the dive detail applies to its
  // own clusters, rather than a heading standing over nothing.
  const hasFacts = (center.country !== null && center.country !== '') || (website !== null && website !== '');

  /**
   * What the page says about the diver's own dives with this centre, or nothing at all while
   * the logbook has not answered.
   *
   * `formatSiteSummary` (format/display.ts) is reused rather than reimplemented: it is §3's
   * *depth/temp* pair said about a set of dives, which is exactly this question asked of a shop
   * instead of a rock, and `logbookStats` and `waterTempRange` are the same two owners the Map
   * tab's site sheet asks. **It always states the count, `0 dives` included**, which is what a
   * page opened to ask "what did I do with this centre" has to answer even when the answer is
   * none — and is the one place this page deliberately differs from `formatCenterRow`, where a
   * nought would be noise on every row of a community directory.
   */
  const summary = logbookError || !logbookResolved
    ? null
    : formatSiteSummary(logbookStats(myDives), waterTempRange(myDives), units);

  const header = (
    <View>
      <Text style={styles.centerHeading}>{centerLabel(center)}</Text>
      {summary !== null && <Text style={styles.centerSummary}>{summary}</Text>}
      {/* The one failure that has to be said here: the centre is on screen and readable, and it
          is the logbook underneath it that could not be opened — `LOGBOOK_UNREADABLE`
          (domain/logbook.ts), the same sentence four other screens say about the same event. */}
      {logbookError !== undefined && <Text style={styles.centerSummary}>{LOGBOOK_UNREADABLE}</Text>}
      {hasFacts && (
        <View>
          <Text style={styles.centerSectionTitle}>Centre</Text>
          {center.country !== null && center.country !== '' && (
            <FactRow label="Country" value={center.country} styles={styles} />
          )}
          {website !== null && website !== '' && (
            <WebsiteRow website={website} styles={styles} />
          )}
        </View>
      )}
      {myDives.length > 0 && <Text style={styles.centerSectionTitle}>Your dives</Text>}
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
      <BackButton styles={styles} />
      <FlatList
        style={styles.centerScroll}
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
        // The device's own clearance rather than a constant (`screenBottomInset`, theme/
        // styles.ts): this screen is pushed OVER the tab bar, so its list runs to the bottom of
        // the display and the last dive would otherwise scroll under the Liquid Glass.
        contentContainerStyle={[styles.centerContent, { paddingBottom: screenBottomInset(insets.bottom) }]}
      />
    </View>
  );
}

/**
 * The website row — a fact when it is text, and a control when it is an address.
 *
 * `isOpenableWebsite` (platform/openWebsite.ts, §4.1's owner of what this app will hand to the
 * outside world) decides which. A bare `aquasplit.hr` is shown and not pressable, because
 * guessing a scheme on another diver's behalf is inventing a fact about somebody else's shop —
 * and a row that looked pressable and did nothing is the dead control §0.6 objects to four
 * separate times.
 *
 * The pressable half announces `Open <address>` rather than the address alone: §0.6's rule for
 * every navigation row on Settings, where "a row announced as a bare name says nothing about
 * where a tap would land".
 */
function WebsiteRow({ website, styles }: { website: string; styles: Styles }) {
  if (!isOpenableWebsite(website)) return <FactRow label="Website" value={website} styles={styles} />;
  return (
    <Pressable
      style={styles.formField}
      onPress={() => void openWebsite(website)}
      accessibilityRole="link"
      accessibilityLabel={`Open ${website}`}
    >
      <View style={styles.formFieldRow}>
        <Text style={styles.formFieldLabel}>Website</Text>
        <Text style={styles.centerFactValue}>{website}</Text>
      </View>
    </Pressable>
  );
}

import { useState } from 'react';
import { router } from 'expo-router';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionCapsule, type CapsuleAction } from '../components/ActionCapsule';
import { SearchCapsule } from '../components/SearchCapsule';
import { applyPulledDiveSites } from '../db/catalogue';
import { useDives } from '../db/useDives';
import { useDiveSites } from '../db/useDiveSites';
import { useUnitSystem } from '../db/useUnitSystem';
import { searchSites } from '../cloud/searchSites';
import { useAuthSession } from '../cloud/useAuthSession';
import { CATALOGUE_UNREADABLE } from '../domain/logbook';
import { browseCatalogue } from '../domain/search';
import { isDiveAtSite } from '../domain/siteDives';
import { type DiveSite } from '../domain/types';
import { formatSiteCount, formatSiteRow, UNNAMED_SITE } from '../format/display';
import { type UnitSystem } from '../format/units';
import { useCatalogueSupplement } from '../hooks/useCatalogueSupplement';
import { backToMap } from '../navigation/leaveScreen';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';

/** The way out, in the same slot the Map's own capsule glyphs occupy — one glyph, monochrome, in
 * a capsule. Exported so `symbolName.test.tsx` can check the Android half against a real Material
 * name, for the reason `SearchScreen`'s and the centres directory's own close glyphs are. */
export const CLOSE_SITES_GLYPH = { ios: 'xmark', android: 'close' } as const;

/**
 * **The dive sites directory** (`/sites`, M3f) — §2.3's *"typing a site or center searches your
 * own history first, then the on-device copy of the community catalogue… live search adds anything
 * newer when online"*, as a screen, for the half of that sentence that never had one.
 *
 * `DiveCentersScreen`'s twin, and deliberately so: they are the same list over the same table
 * shape, they share the browse rule (`browseCatalogue`), the online supplement
 * (`useCatalogueSupplement`) and every style definition, and what they do not share is the content
 * of a row — §6 gives a centre a country and a website, and a site four facts more, which is why
 * `formatSiteRow` is not `formatCenterRow`.
 *
 * Reached from §3's Map tab while community sites are switched on, which is where the catalogue's
 * sites are drawn and where a diver discovers that **most of them cannot be drawn at all**: §2.3
 * gives a new site the pin of the dive that created it and nothing when that dive had none, so the
 * map shows the sites that have a position and this list shows all of them. The map answers
 * *where*, this answers *which*.
 *
 * ── This is where `search_sites` finally gets a caller ─────────────────────────────────────
 *
 * §5's RPC list opens with `search_sites`. It was written in M2j and **has had no caller since**,
 * a standing item in both M3c's and M3e's reports: the device's own copy has been the whole of the
 * answer for sites, which is fully offline-correct and silently misses every site added since this
 * phone last pulled. `cloud/searchSites.ts` is that caller and this screen is what calls it.
 *
 * ── Device first, and the server fills the device rather than a second list ────────────────
 *
 * The list on screen is **one** query — `useDiveSites()`, the device's own catalogue, live. When
 * the diver has typed something, the supplement asks the server and hands what comes back to
 * `applyPulledDiveSites`; the live query then re-renders with the new rows in it. There is no
 * "local or remote" state on any row, no second ordering, and a site found online is still here
 * the next time this diver is on a boat.
 *
 * ── Not `SearchScreen`, and the difference is one line of behaviour ───────────────────────
 *
 * That screen clears its list on arrival, because the list it would otherwise show is the logbook
 * the diver has just left. **This one opens on the whole catalogue**, because a directory is a
 * directory first and a search second. Everything else is that screen's: the field docked at the
 * bottom on the keyboard (§0.6, measured off Messages), the way out beside it, and a pushed route
 * over the tabs so the bottom of the screen is the bottom of the screen.
 */
export default function DiveSitesScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();
  const units = useUnitSystem();
  const catalogue = useDiveSites();
  const { dives } = useDives();
  const { session } = useAuthSession();
  const [query, setQuery] = useState('');

  /** §2.3's online supplement — `hooks/useCatalogueSupplement.ts` owns the pause, the cancellation
   * and the silence; this call site owns the pair that has to travel together, and the hook's
   * shared type variable is what stops the sites RPC being handed the centres writer. */
  useCatalogueSupplement(query, searchSites, applyPulledDiveSites);

  const shown = browseCatalogue(catalogue.sites, query);

  const close: readonly CapsuleAction[] = [
    { key: 'close-sites', symbol: CLOSE_SITES_GLYPH, label: 'Close sites', onPress: backToMap },
  ];

  /**
   * The four states this screen can be in, kept visibly distinct for the reason `DivesScreen` and
   * `SearchScreen` keep their own apart: a failed read must never read as "you have none",
   * "nothing typed yet" must never read as "nothing found", and a read that has not answered must
   * state nothing at all (§10 — `useLiveQuery` hands back `[]` before its query returns, so "no
   * sites yet" would be a claim about a database nothing has asked).
   */
  const message = (): string | null => {
    if (catalogue.error !== undefined) return CATALOGUE_UNREADABLE;
    if (!catalogue.resolved) return null;
    if (catalogue.sites.length === 0) {
      // **Two sentences, because a guest is not waiting for the same thing a signed-in diver is**
      // — the split `MapScreen`'s community layer draws and the centres directory repeats. A site
      // reaches this table two ways and §5 puts an account behind both: a pull, and §2.3's *add a
      // site*, which is offered to a signed-in diver alone. Telling a guest their next sync will
      // bring sites would be pointing at something that cannot happen.
      return session === null
        ? 'No dive sites yet. They arrive with an account — on your first sync, and when you add one from a dive.'
        : 'No dive sites yet. Name the site on a dive and tap “Add” to publish one; your next sync brings the community’s.';
    }
    if (shown.length === 0) return 'No sites match your search.';
    return null;
  };

  const note = message();

  return (
    // `padding` on iOS and `height` on Android — RN's own documented pairing, and `SearchScreen`
    // records why this screen needs it at all: the field sits ON the keyboard rather than merely
    // above the fold.
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <FlatList
        style={styles.siteScroll}
        data={shown}
        keyExtractor={(site) => site.id}
        ListHeaderComponent={
          <View>
            <Text style={styles.sitesHeading}>Dive sites</Text>
            {/* The count of what is on screen, in the muted mono line every screen in this app
                hangs under its title. Absent while the read has not answered, for the reason
                above; absent under a message too, since the message is what the line would
                otherwise be counting. */}
            {catalogue.resolved && catalogue.error === undefined && note === null && (
              <Text style={styles.siteSummary}>{formatSiteCount(shown.length)}</Text>
            )}
            {note !== null && (
              <View style={styles.siteEmpty}>
                <Text style={styles.messageText}>{note}</Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <SiteRow
            site={item}
            dives={dives.reduce((count, dive) => count + (isDiveAtSite(dive, item) ? 1 : 0), 0)}
            units={units}
            styles={styles}
          />
        )}
        contentContainerStyle={[styles.siteContent, { paddingBottom: screenBottomInset(insets.bottom) }]}
        // The keyboard is up for the life of this screen and a diver scrolling a directory is
        // reading rather than typing; a TAP must still open the site rather than be spent
        // dismissing the keyboard. Both are `SearchScreen`'s own pair, for its stated reasons.
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      />
      {/* Bottom-anchored and in flow rather than absolutely positioned, which is what lets
          KeyboardAvoidingView lift it with the keyboard. `insets.bottom` clears the home indicator
          when the keyboard is down. */}
      <View style={[styles.searchDock, { paddingBottom: insets.bottom + 12 }]}>
        <SearchCapsule scheme={scheme} value={query} onChangeText={setQuery} placeholder="Search sites" />
        <ActionCapsule scheme={scheme} actions={close} />
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * One site in the directory: its name, and what the catalogue and the logbook together know about
 * it (`formatSiteRow` — "CZ · Shore · Fresh · Quarry · 42.0 m · 3 dives", or no second line at
 * all).
 *
 * `formField`/`formFieldRow` is the row, exactly as Settings' preset and certification rows and
 * the centres directory's own rows are: §0.6's row grammar, not a fifth vocabulary for a name over
 * a summary. The announcement says what pressing it does rather than merely what the row is
 * called — Settings' own rule for every row that opens something.
 */
function SiteRow({
  site,
  dives,
  units,
  styles,
}: {
  site: DiveSite;
  dives: number;
  units: UnitSystem;
  styles: Styles;
}) {
  const name = site.name ?? UNNAMED_SITE;
  const summary = formatSiteRow(site, dives, units);
  return (
    <Pressable
      style={styles.formField}
      // Absolute and interpolated, for the reason every other `[id]` link in this app records:
      // expo-router's typed routes check an absolute path against the routes that exist on disk,
      // where a relative one is resolved at runtime and checked against nothing at all.
      onPress={() => router.push(`/site/${site.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}`}
    >
      <View style={styles.formFieldRow}>
        <Text style={styles.siteRowName}>{name}</Text>
      </View>
      {summary !== null && <Text style={styles.siteRowSummary}>{summary}</Text>}
    </Pressable>
  );
}

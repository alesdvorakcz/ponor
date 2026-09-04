import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionCapsule, type CapsuleAction } from '../components/ActionCapsule';
import { SearchCapsule } from '../components/SearchCapsule';
import { applyPulledDiveCenters } from '../db/catalogue';
import { db } from '../db/client';
import { useDiveCenters } from '../db/useDiveCenters';
import { useDives } from '../db/useDives';
import { searchCenters } from '../cloud/searchCenters';
import { cloud } from '../cloud/supabase';
import { useAuthSession } from '../cloud/useAuthSession';
import { isDiveWithCenter } from '../domain/centerDives';
import { CATALOGUE_UNREADABLE } from '../domain/logbook';
import { browseCenters } from '../domain/search';
import { type DiveCenter } from '../domain/types';
import { formatCenterCount, formatCenterRow, UNNAMED_CENTER } from '../format/display';
import { backToMap } from '../navigation/leaveScreen';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset, type Styles } from '../theme/styles';

/** The way out, in the same slot the Map's own capsule glyphs occupy — one glyph, monochrome,
 * in a capsule. Exported so `symbolName.test.tsx` can check the Android half against a real
 * Material name, for the reason `SearchScreen`'s own close glyph is. */
export const CLOSE_CENTERS_GLYPH = { ios: 'xmark', android: 'close' } as const;

/**
 * **How long after the last keystroke the server is asked** (§2.3's *"live search adds anything
 * newer when online"*).
 *
 * A number rather than a call per keystroke, because a keystroke is not a question: a diver
 * typing `Ponorka` would otherwise send seven round trips, six of which are already stale when
 * they land. 400 ms is a pause rather than a delay — the device's own answer is already on
 * screen the whole time, so what this delays is a list getting *longer*, never a list appearing.
 */
export const LIVE_SEARCH_DELAY_MS = 400;

/**
 * **The dive centres directory** (`/centers`, M3c) — §2.3's *"typing a site or center searches
 * your own history first, then the on-device copy of the community catalogue… live search adds
 * anything newer when online"*, as a screen.
 *
 * Reached from §3's Map tab, on the centres layer, which is where the catalogue's centres are
 * drawn and where a diver discovers that **most of them cannot be drawn at all**: §2.3 gives a
 * centre its name and nothing else, so a map of centres shows the handful that a pull brought a
 * position for and this list shows all of them. The map answers *where*, this answers *which*.
 *
 * ── Device first, and the server fills the device rather than a second list ────────────────
 *
 * The list on screen is **one** query — `useDiveCenters()`, the device's own catalogue, live.
 * When the diver has typed something, `searchCenters` (cloud/searchCenters.ts) asks the server
 * and hands what comes back to `applyPulledDiveCenters`; the live query then re-renders with the
 * new rows in it. That is §2.3's shape taken literally — *"the device answers first and the
 * server supplements rather than replaces"* — and it is what keeps the screen free of a merge:
 * there is no "local or remote" state on any row, no second ordering, and a centre found online
 * is still here the next time this diver is on a boat.
 *
 * `search_centers` was written in M2j and **had never had a caller**. Its own migration says the
 * rows it returns are byte-for-byte `pull_changes` rows for exactly this reason.
 *
 * ── Not `SearchScreen`, and the difference is one line of behaviour ───────────────────────
 *
 * That screen clears its list on arrival, because the list it would otherwise show is the
 * logbook the diver has just left. **This one opens on the whole catalogue**, because there is
 * nowhere else in the app that catalogue is listed — it is a directory first and a search
 * second. Everything else is that screen's: the field docked at the bottom on the keyboard
 * (§0.6, measured off Messages), the way out beside it, and a pushed route over the tabs so the
 * bottom of the screen is the bottom of the screen.
 */
export default function DiveCentersScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();
  const catalogue = useDiveCenters();
  const { dives } = useDives();
  const { session } = useAuthSession();
  const [query, setQuery] = useState('');

  /**
   * **The online supplement**, debounced, and deliberately fire-and-forget.
   *
   * Nothing on screen waits for it and nothing reports it: `searchCenters` answers `[]` for every
   * way of failing (no backend in this build, nobody signed in, no signal, a server that refused)
   * and the device's own rows are what the diver is reading meanwhile. §1 is the whole of that —
   * a directory of shops must work at sea — and §0.6 is the rest: a notice under a search field
   * that fired on every keystroke made out of signal is a message with no gesture beneath it.
   *
   * The write is `applyPulledDiveCenters`, which is `applyPulledRows` (db/dirty.ts): rows land
   * **clean**, only where they may safely replace what is here, and `sync_state` is untouched —
   * the migration is explicit that advancing the watermark on a filtered answer would step it
   * past everything the filter excluded.
   */
  useEffect(() => {
    const wanted = query.trim();
    if (wanted === '') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const rows = await searchCenters(cloud, wanted);
          if (cancelled || rows.length === 0) return;
          await applyPulledDiveCenters(db, rows);
        } catch {
          // The read cannot throw (that module's own contract); the write can, and a catalogue
          // that refused a write is the same outcome as a server that never answered — the
          // device's own rows, already on screen.
        }
      })();
    }, LIVE_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const shown = browseCenters(catalogue.centers, query);

  const close: readonly CapsuleAction[] = [
    { key: 'close-centers', symbol: CLOSE_CENTERS_GLYPH, label: 'Close centres', onPress: backToMap },
  ];

  /**
   * The four states this screen can be in, kept visibly distinct for the reason `DivesScreen`
   * and `SearchScreen` keep their own apart: a failed read must never read as "you have none",
   * "nothing typed yet" must never read as "nothing found", and a read that has not answered
   * must state nothing at all (§10 — `useLiveQuery` hands back `[]` before its query returns, so
   * "no centres yet" would be a claim about a database nothing has asked).
   */
  const message = (): string | null => {
    if (catalogue.error !== undefined) return CATALOGUE_UNREADABLE;
    if (!catalogue.resolved) return null;
    if (catalogue.centers.length === 0) {
      // **Two sentences, because a guest is not waiting for the same thing a signed-in diver
      // is** — the split `MapScreen`'s community layer already draws. A centre reaches this
      // table two ways and §5 puts an account behind both: a pull, and §2.3's *add a centre*,
      // which is offered to a signed-in diver alone. Telling a guest their next sync will bring
      // centres would be pointing at something that cannot happen.
      return session === null
        ? 'No dive centres yet. They arrive with an account — on your first sync, and when you add one from a dive.'
        : 'No dive centres yet. Name the centre on a dive and tap “Add” to publish one; your next sync brings the community’s.';
    }
    if (shown.length === 0) return 'No centres match your search.';
    return null;
  };

  const note = message();

  return (
    // `padding` on iOS and `height` on Android — RN's own documented pairing, and
    // `SearchScreen` records why this screen needs it at all: the field sits ON the keyboard
    // rather than merely above the fold.
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <FlatList
        style={styles.centerScroll}
        data={shown}
        keyExtractor={(center) => center.id}
        ListHeaderComponent={
          <View>
            <Text style={styles.centersHeading}>Dive centres</Text>
            {/* The count of what is on screen, in the muted mono line every screen in this app
                hangs under its title. Absent while the read has not answered, for the reason
                above; absent under a message too, since the message is what the line would
                otherwise be counting. */}
            {catalogue.resolved && catalogue.error === undefined && note === null && (
              <Text style={styles.centerSummary}>{formatCenterCount(shown.length)}</Text>
            )}
            {note !== null && (
              <View style={styles.centerEmpty}>
                <Text style={styles.messageText}>{note}</Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <CenterRow
            center={item}
            dives={dives.reduce((count, dive) => count + (isDiveWithCenter(dive, item) ? 1 : 0), 0)}
            styles={styles}
          />
        )}
        contentContainerStyle={[styles.centerContent, { paddingBottom: screenBottomInset(insets.bottom) }]}
        // The keyboard is up for the life of this screen and a diver scrolling a directory is
        // reading rather than typing; a TAP must still open the centre rather than be spent
        // dismissing the keyboard. Both are `SearchScreen`'s own pair, for its stated reasons.
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      />
      {/* Bottom-anchored and in flow rather than absolutely positioned, which is what lets
          KeyboardAvoidingView lift it with the keyboard. `insets.bottom` clears the home
          indicator when the keyboard is down. */}
      <View style={[styles.searchDock, { paddingBottom: insets.bottom + 12 }]}>
        <SearchCapsule scheme={scheme} value={query} onChangeText={setQuery} placeholder="Search centres" />
        <ActionCapsule scheme={scheme} actions={close} />
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * One centre in the directory: its name, and what the catalogue and the logbook together know
 * about it (`formatCenterRow` — "Croatia · 3 dives", or no second line at all).
 *
 * `formField`/`formFieldRow` is the row, exactly as Settings' preset and certification rows are:
 * §0.6's row grammar, not a fourth vocabulary for a name over a summary. The announcement says
 * what pressing it does rather than merely what the row is called — Settings' own rule for every
 * row that opens something.
 */
function CenterRow({ center, dives, styles }: { center: DiveCenter; dives: number; styles: Styles }) {
  const name = center.name ?? UNNAMED_CENTER;
  const summary = formatCenterRow(center, dives);
  return (
    <Pressable
      style={styles.formField}
      // Absolute and interpolated, for the reason every other `[id]` link in this app records:
      // expo-router's typed routes check an absolute path against the routes that exist on disk,
      // where a relative one is resolved at runtime and checked against nothing at all.
      onPress={() => router.push(`/center/${center.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}`}
    >
      <View style={styles.formFieldRow}>
        <Text style={styles.centerRowName}>{name}</Text>
      </View>
      {summary !== null && <Text style={styles.centerRowSummary}>{summary}</Text>}
    </Pressable>
  );
}

import { useState } from 'react';
import { router } from 'expo-router';
import { FlatList, KeyboardAvoidingView, Platform, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionCapsule, type CapsuleAction } from '../components/ActionCapsule';
import { DiveRow } from '../components/DiveRow';
import { SearchCapsule } from '../components/SearchCapsule';
import { useDives } from '../db/useDives';
import { useDiveSampleShapes } from '../db/useDiveSampleShapes';
// M3m: whether the keyboard is covering the bottom edge, which is what decides whether the
// dock below still has a home indicator to clear (`liftedBottomInset`).
import { useKeyboardShown } from '../hooks/useKeyboardShown';
import { logbookUnreadable } from '../domain/logbook';
import { useUnitSystem } from '../db/useUnitSystem';
import { searchDives } from '../domain/search';
import { t, useT } from '../i18n';
import { backToDives } from '../navigation/leaveScreen';
import { resolveScheme } from '../theme/resolve';
import { liftedBottomInset, makeStyles, screenTopInset } from '../theme/styles';

/** The way out, in the same slot the Dives screen's magnifier occupies at the other end of
 * the app — one glyph, monochrome, in a capsule. `symbolName` (components/symbolName.ts)
 * owns the per-platform key; this is only which symbol. */
/* Exported so `symbolName.test.tsx` can check the `android` half against a real Material
 * name — see `DivesScreen`'s two for why no suite that renders this screen can. */
export const CLOSE_SEARCH_GLYPH = { ios: 'xmark', android: 'close' } as const;

/**
 * Searching the logbook (DESIGN.md §3), as a screen rather than a mode on the list.
 *
 * **Measured off iOS 26 Messages by the owner, not recalled.** Tapping the magnifier there
 * does not slide a field under the header: the list clears, the screen becomes a search
 * mode, and the field is anchored at the **bottom**, gaining a caret and a way out beside
 * it. It sits exactly where the keyboard rises, so the input is next to both the thumb and
 * the keys. §0.6 already rejected a field at the top of this app once, for its own reason —
 * it was the brightest object on the screen and the furthest control from the thumb — and
 * this arrangement is that finding and Messages' agreeing.
 *
 * **The trigger and the field are two different decisions, and only the trigger moved.** §3's
 * note puts the magnifier in the top-right capsule beside the `+`, which is what keeps the
 * bottom strip free for four tabs; this screen is what that magnifier opens.
 *
 * **A pushed route rather than a mode on `DivesScreen`**, for one reason that decides it:
 * the field has to ride above the keyboard, and on the list there is a native tab bar
 * between the two. Pushed over the tabs — exactly as the dive form is (§3: "four tabs plus
 * a full-screen dive form") — the bottom of the screen is the bottom of the screen, and
 * `KeyboardAvoidingView` has nothing to negotiate with. It also keeps the list screen free
 * of a second mode: `DivesScreen` no longer holds a query, a field, or a hidden filter.
 *
 * **The list clears on arrival**, as Messages' does: an empty query shows a prompt rather
 * than the whole logbook. A screen that opened showing every dive would look like the list
 * the diver just left, and the first keystroke would appear to delete most of it.
 *
 * Results are a **flat list, not trips.** `groupIntoTrips` answers "which dives belong
 * together", which is the right question for a logbook read in order and the wrong one for
 * matches gathered from across it — a search for "Blue Hole" spanning four years would draw
 * a header per trip and bury the rows that were asked for.
 */
export default function SearchScreen() {
  // The subscription that repaints this screen when the diver changes the language (src/i18n) —
  // a screen root, so nothing above it re-renders on its own.
  useT();
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const units = useUnitSystem();
  const { dives, numbers, error } = useDives();
  // Task 6's row sparkline map — its own hook, read alongside `useDives()` with neither of its
  // own `resolved`/`error` consulted: a failed sample-series read must not blank this screen
  // the way a failed DIVES read does.
  const { shapes } = useDiveSampleShapes();
  const insets = useSafeAreaInsets();
  // M3m — read here rather than inside the dock's style, so the one screen that knows about
  // the keyboard is the one that owns the layout it changes.
  const keyboardShown = useKeyboardShown();
  const [query, setQuery] = useState('');

  // Trimmed only to decide whether anything was actually typed — `searchDives` owns what a
  // query MEANS (domain/search.ts), and is handed the diver's text unchanged.
  const asked = query.trim() !== '';
  const matching = asked ? searchDives(dives, query) : [];

  const close: readonly CapsuleAction[] = [
    { key: 'close-search', symbol: CLOSE_SEARCH_GLYPH, label: t('search.close'), onPress: backToDives },
  ];

  // The three states a diver can be in here, kept visibly distinct for the same reason
  // DivesScreen keeps its own three apart: a failed read must never read as "no matches",
  // and "nothing typed yet" must never read as "nothing found".
  const body = () => {
    if (error) {
      // `logbookUnreadable` (db/useDives.ts), not a literal: four screens say this about
      // this hook's own `error`, and three spellings of it had already appeared.
      return <Text style={styles.messageText}>{logbookUnreadable()}</Text>;
    }
    if (!asked) {
      return <Text style={styles.messageText}>{t('search.prompt')}</Text>;
    }
    if (matching.length === 0) {
      return <Text style={styles.messageText}>{t('dives.noMatches')}</Text>;
    }
    return null;
  };

  const message = body();

  return (
    // `padding` on iOS is the behaviour that actually moves a bottom-anchored element clear
    // of the keyboard; on Android the window resizes and `height` is the one that does not
    // double-count it. Both are RN's own documented pairing, and this is the app's only
    // screen where a control has to sit ON the keyboard rather than merely above the fold.
    <KeyboardAvoidingView
      // The top clearance comes from the device, not the sheet (`screenTopInset`,
      // theme/styles.ts): `insets` is already read below for the dock's own bottom
      // clearance, and this is the same device answering the other end of the screen.
      style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {message !== null ? (
        <View style={styles.centerFill}>{message}</View>
      ) : (
        <FlatList
          data={matching}
          keyExtractor={(dive) => dive.id}
          renderItem={({ item }) => (
            <DiveRow
              dive={item}
              number={numbers.get(item.id)}
              points={shapes.get(item.id)}
              scheme={scheme}
              units={units}
              onPress={(id) => router.push(`/dive/${id}`)}
            />
          )}
          contentContainerStyle={styles.searchResults}
          // The keyboard is up for the whole life of this screen, and a diver scrolling a
          // list of results is reading rather than typing — RN's default here is 'none',
          // which leaves the keyboard covering half the results it just produced.
          keyboardDismissMode="on-drag"
          // ...but a TAP on a result must still open that dive rather than being spent
          // dismissing the keyboard, which is what the default 'never' would do.
          keyboardShouldPersistTaps="handled"
        />
      )}
      {/* Bottom-anchored, and in flow rather than absolutely positioned: that is what lets
          KeyboardAvoidingView above lift it with the keyboard.

          **`insets.bottom` is spent only while there is an indicator left to clear** (M3m).
          It used to be added unconditionally, and on this screen the keyboard is up from the
          moment it opens — the field autofocuses — so the whole inset went on clearing a home
          indicator the keys were already covering, and the dock rode that much higher than it
          belonged. `liftedBottomInset` (theme/styles.ts) is the one owner of that rule now,
          shared with DiveFormScreen's footer, which made the same composition for the same
          reason and had the same fault. */}
      <View style={[styles.searchDock, { paddingBottom: liftedBottomInset(insets.bottom, 12, keyboardShown) }]}>
        <SearchCapsule scheme={scheme} value={query} onChangeText={setQuery} autoFocus />
        <ActionCapsule scheme={scheme} actions={close} />
      </View>
    </KeyboardAvoidingView>
  );
}

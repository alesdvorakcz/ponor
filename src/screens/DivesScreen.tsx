import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, SectionList, Text, TextInput, View, useColorScheme } from 'react-native';

import { DiveRow } from '../components/DiveRow';
import { EmptyState } from '../components/EmptyState';
import { TripHeader } from '../components/TripHeader';
import { useDives } from '../db/useDives';
import { searchDives } from '../domain/search';
import { groupIntoTrips, splitPlanned, type Trip } from '../domain/trips';
import { resolveScheme, themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';

/**
 * The Dives screen (DESIGN.md §3) — the app's front door. Rendered at route
 * `/` via a thin re-export in `src/app/index.tsx`; this file itself lives
 * outside expo-router's swept `src/app/` tree on purpose, so that this
 * module's colocated test isn't swept into the app bundle too.
 *
 * The read is `useDives()` and nothing else: no `db.select()` here, and no
 * re-sorting of what it returns. Task 1 split the dive read into
 * `useDives()`/`composeDives()` specifically so that no screen would ever
 * need its own query or comparator; `groupIntoTrips`, `splitPlanned` and
 * `searchDives` below all operate on the order `useDives()` already hands
 * back rather than re-deriving it.
 *
 * Three states can look identical to a diver unless they're kept visibly
 * distinct, so each gets its own branch below: a failed read (`error` set)
 * is reported as a failure and must never fall through to "empty logbook";
 * a genuinely empty logbook (`dives.length === 0`) shows the "log your
 * first dive" prompt; and a non-empty logbook whose *search* matches
 * nothing says so on its own, with the search box left in place so a diver
 * who mistyped can fix it rather than being told they have no dives.
 */
export default function DivesScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);
  const { dives, numbers, error } = useDives();
  const [query, setQuery] = useState('');

  const openDive = (id: string) => router.push(`./dive/${id}`);
  // M1c builds the dive form this points at (DESIGN.md §9); the route does
  // not exist yet, and this deliberately does not build a stub for it. A
  // relative href, rather than an absolute one, is what lets this compile
  // under expo-router's typed routes (app.config.js's
  // experiments.typedRoutes) without a type-check suppression: typed
  // routes validates an absolute path against the routes that actually
  // exist on disk, but a relative path is resolved at runtime against
  // whatever screen is current, so it deliberately isn't checked against
  // that list. Verified: an absolute `router.push('/dive/new')` here does
  // not typecheck today; the relative form does.
  const logDive = () => router.push('./dive/new');

  if (error) {
    return (
      <View style={styles.screen}>
        <View style={styles.centerFill}>
          <Text style={styles.messageText}>
            Couldn&apos;t open your logbook. Try closing and reopening the app.
          </Text>
        </View>
      </View>
    );
  }

  if (dives.length === 0) {
    return (
      <View style={styles.screen}>
        <EmptyState scheme={scheme} onPress={logDive} />
      </View>
    );
  }

  const matching = searchDives(dives, query);
  const { planned, logged } = splitPlanned(matching);
  // `planned` inherits useDives()'s one order (newest-date-first, via
  // compareDiveOrder) unchanged — correct for the logged trips below, but
  // backwards for a section titled "Up next": a future date sorts as
  // "newest", so without this the furthest-out dive would render first.
  // Reversed here, for display only, so the soonest planned dive is on top;
  // splitPlanned, groupIntoTrips and compareDiveOrder stay the single owners
  // of order everywhere else.
  const upNext = [...planned].reverse();
  const sections: Trip[] = [
    ...(upNext.length ? [{ key: 'up-next', title: 'Up next', dateRange: '', dives: upNext }] : []),
    ...groupIntoTrips(logged),
  ];

  return (
    <View style={styles.screen}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search dives"
        placeholderTextColor={theme.fgMuted}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search dives"
      />
      {sections.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.messageText}>No dives match your search.</Text>
        </View>
      ) : (
        // SectionList needs each section's items under `data`; Trip (domain/trips.ts)
        // names that field `dives`, since a trip is not SectionList-specific. Mapping
        // here only renames the field for the one caller that needs the other name — it
        // does not touch order, grouping, or filtering, all of which already happened
        // above via searchDives/splitPlanned/groupIntoTrips.
        <SectionList
          sections={sections.map((section) => ({ ...section, data: section.dives }))}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DiveRow dive={item} number={numbers.get(item.id)} scheme={scheme} onPress={openDive} />
          )}
          renderSectionHeader={({ section }) => (
            <TripHeader title={section.title} dateRange={section.dateRange} scheme={scheme} />
          )}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.listContent}
        />
      )}
      <Pressable style={styles.fab} onPress={logDive} accessibilityLabel="Log a dive" accessibilityRole="button">
        <Text style={styles.fabLabel}>+</Text>
      </Pressable>
    </View>
  );
}

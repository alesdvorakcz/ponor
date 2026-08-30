import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, SectionList, Text, TextInput, View, useColorScheme } from 'react-native';

import { DiveRow } from '../components/DiveRow';
import { EmptyState } from '../components/EmptyState';
import { applyReorder, createReorderGate, ReorderControls, type ReorderGate } from '../components/ReorderControls';
import { TripHeader } from '../components/TripHeader';
import { reorderDivesForDate } from '../db/dives';
import { useDives } from '../db/useDives';
import { searchDives } from '../domain/search';
import { canReorder, groupIntoTrips, sameDateGroups, splitPlanned } from '../domain/trips';
import { type Dive } from '../domain/types';
import { useWideLayout } from '../hooks/useWideLayout';
import { resolveScheme, themeFor } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import DiveDetailScreen from './DiveDetailScreen';

/**
 * One row of a section's `data`, after `toListEntries` below has decided
 * which same-date dives (`sameDateGroups`, domain/trips.ts) get plain
 * `DiveRow`s and which get `ReorderControls` instead. A discriminated union
 * rather than two parallel arrays, so `renderItem` can never pair a
 * `ReorderControls` block with the wrong group's dives.
 */
type ListEntry =
  | { kind: 'dive'; dive: Dive }
  | { kind: 'reorderGroup'; date: string; dives: Dive[] };

/**
 * Splits `dives` (one section's worth, already in the screen's own order)
 * into `ListEntry` rows: a `sameDateGroups` run becomes one `reorderGroup`
 * entry when `canReorder` says hand-ordering could actually change
 * something, and plain `dive` entries — rendered exactly as before this
 * task — otherwise. This is the ONE place that decision is made; `DiveRow`
 * and `ReorderControls` both just render whatever entry they are handed.
 */
function toListEntries(dives: Dive[]): ListEntry[] {
  return sameDateGroups(dives).flatMap((group): ListEntry[] => {
    const date = group.at(0)?.date;
    // sameDateGroups never returns an empty group, and canReorder already
    // requires at least two dives to return true, so `date === undefined`
    // here is unreachable — but typed defensively (falls back to plain rows)
    // rather than asserted past, the same choice `dateRangeOf` (trips.ts)
    // makes for the same shape of "can't actually happen" gap.
    if (date !== undefined && canReorder(group)) {
      return [{ kind: 'reorderGroup', date, dives: group }];
    }
    return group.map((dive): ListEntry => ({ kind: 'dive', dive }));
  });
}

/** Stable across a reorder: keyed by the group's full, sorted id set rather
 * than e.g. its first dive's id, which can itself change after a move. */
function entryKey(entry: ListEntry): string {
  return entry.kind === 'dive'
    ? entry.dive.id
    : `reorder:${entry.date}:${[...entry.dives].map((d) => d.id).sort().join(',')}`;
}

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
 *
 * A fourth, non-blocking state: `settingsError` (useDives.ts) means only the
 * `dives_before` *offset* — a display preference, not the dives themselves —
 * failed to load. Review task 7, Important #3: an earlier version folded this
 * into the same `error` as a failed dives read, so a diver's two perfectly
 * good logged dives rendered as nothing but the fatal failure message below —
 * "an empty logbook and a failed read must not look the same" failing again,
 * through a third door, and directly contradicting `composeDives`'s own
 * stated intent about degrading a corrupt offset gracefully rather than
 * hiding the dives over it. The dives still render; a banner in `listPane`
 * says the numbers may be off instead, so the diver is told something is
 * wrong rather than shown a plausible lie (numbering quietly restarting
 * from 1 with no signal anything failed).
 *
 * This screen's one write (M1b's hand-ordering, §2.5) still goes through the
 * same read-back-through-`useDives()` discipline: `handleReorder` calls
 * `reorderDivesForDate` but never touches its result to decide what this
 * screen shows next — the day's actual new order arrives back through
 * `useDives()`'s live query re-running, the one path everything else here
 * already uses. See `ReorderControls.tsx` for the rest of that mechanism.
 *
 * **Wide (tablet) layout** (DESIGN.md §3, `useWideLayout.ts`): `wide` splits the render
 * into a fixed-width list column plus a detail pane for whichever dive is `selectedId`.
 * The list column's own JSX — search box, notice, the section list, the "+" fab — is
 * identical to the narrow layout's; it is written ONCE (`listPane`, below) and reused in
 * both branches, rather than kept as two copies that could quietly drift apart. The detail
 * pane reuses `DiveDetailScreen` itself, the exact component `/dive/[id]` renders, rather
 * than a second view that redraws a dive's fields a second way — see that file's own
 * docblock for the two props (`id`, `showBackButton`) this needed and why. `openDive`
 * (below) is the one place that decides whether selecting a row navigates or just updates
 * `selectedId`; every caller — `DiveRow` and `ReorderControls` alike — already goes through
 * it, so neither had to learn about wide layouts at all.
 */
export default function DivesScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);
  const { dives, numbers, error, settingsError } = useDives();
  const wide = useWideLayout();
  const [query, setQuery] = useState('');
  // Wide layout only: which dive's detail shows beside the list (this screen's own
  // docblock, above). Narrow layout never reads this — openDive navigates instead.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Set only when a reorder request could not fully take effect
  // (`applyReorder`'s ApplyReorderResult) — canReorder is meant to keep that
  // unreachable, but it is still handled: see ReorderControls.tsx's
  // NOT_APPLIED_MESSAGE docblock for why an unreachable branch that fails
  // silently is worth guarding anyway.
  const [reorderMessage, setReorderMessage] = useState<string | null>(null);

  // Wide: stay on this screen and just show the pick in the detail pane — there is no
  // route to push to that would put both list and detail on screen at once. Narrow:
  // unchanged, a real push to /dive/[id]. Both DiveRow and ReorderControls call this
  // same function for a tap, so neither needed to learn about `wide` itself.
  const openDive = (id: string) => {
    if (wide) {
      setSelectedId(id);
    } else {
      router.push(`./dive/${id}`);
    }
  };
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

  // One `ReorderGate` (ReorderControls.tsx) for the screen's lifetime — a
  // lazily-initialised ref, not a bare `useRef(createReorderGate())`, so a
  // fresh (and immediately discarded) gate isn't constructed on every
  // render; only the very first one is ever kept or used. `run` is what
  // actually decides whether a write may start; `pendingReorderDates`
  // (state) below exists only so a render can SEE which dates are pending,
  // to compute `disabled` — it never itself decides anything.
  const reorderGateRef = useRef<ReorderGate | null>(null);
  if (reorderGateRef.current === null) reorderGateRef.current = createReorderGate();
  const [pendingReorderDates, setPendingReorderDates] = useState<Set<string>>(new Set());

  // Bound per date-group at the JSX call site below (`handleReorder(entry.date)`),
  // since `ReorderControls`'s `onReorder` is `(orderedIds: string[]) => void` and
  // has no other way to say which day it's for. Never awaited by the caller —
  // the day's actual resulting order comes back through `useDives()`'s own
  // live query, not through this promise.
  //
  // The write itself is routed through `reorderGateRef` — see that
  // function's own docblock for why a second overlapping call for the same
  // day is ignored outright rather than raced. `setReorderMessage(null)`
  // sits INSIDE the guarded callback on purpose: a request the gate ignores
  // never ran, so it has nothing to say and must not clear a message a
  // still-in-flight or just-finished call is showing.
  const handleReorder = (date: string) => (orderedIds: string[]) => {
    const started = reorderGateRef.current!.run(date, () => {
      setReorderMessage(null);
      return applyReorder(date, orderedIds, reorderDivesForDate)
        .then((result) => setReorderMessage(result.message))
        .catch(() => setReorderMessage("Couldn't reorder that day. Try again."));
    });
    if (started === null) return; // this day already has a write in flight
    setPendingReorderDates((prev) => new Set(prev).add(date));
    started.finally(() => {
      setPendingReorderDates((prev) => {
        const next = new Set(prev);
        next.delete(date);
        return next;
      });
    });
  };

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
  // Hand-ordering is scoped to logged trips only, not "Up next": a planned
  // dive has no number to reorder for (assignDiveNumbers only numbers
  // `status: 'logged'` dives — diveNumber.ts), and `upNext`'s reversed
  // display order runs the opposite direction from `toDives`'s newest-first
  // order that ReorderControls/moveDown assume — mixing the two would need a
  // second, differently-signed reversal here, exactly the kind of "which way
  // does this go" mistake this milestone's review already flagged once.
  const sections = [
    ...(upNext.length
      ? [
          {
            key: 'up-next',
            title: 'Up next',
            // Stays empty rather than e.g. the soonest/furthest date: a batch of planned
            // dives has no single trip date range the way a logged trip does, and each
            // row already states its own date (§3 — DiveRow.tsx's `plannedDate`), so
            // there is nothing this header needs to add.
            dateRange: '',
            data: upNext.map((dive): ListEntry => ({ kind: 'dive', dive })),
          },
        ]
      : []),
    ...groupIntoTrips(logged).map((trip) => ({
      key: trip.key,
      title: trip.title,
      dateRange: trip.dateRange,
      data: toListEntries(trip.dives),
    })),
  ];

  // Everything the narrow layout has always rendered inside `styles.screen`, unchanged —
  // written once and reused by both branches below, rather than kept as two copies of the
  // same list that could quietly drift apart (this file's own top docblock).
  const listPane = (
    <>
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
      {reorderMessage !== null && (
        <Pressable
          style={styles.reorderNotice}
          onPress={() => setReorderMessage(null)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss message"
        >
          <Text style={styles.reorderNoticeText}>{reorderMessage}</Text>
        </Pressable>
      )}
      {settingsError !== undefined && (
        // Not a Pressable, unlike reorderMessage above: this tracks useDives()'s live
        // settingsError, not a one-off action outcome, so there is no single attempt to
        // dismiss — it clears itself once the settings read next succeeds. See this file's
        // own top docblock (Important #3) for why a failed settings read must not blank
        // the dives below, and must not fail silently either.
        <View style={styles.settingsNotice}>
          <Text style={styles.settingsNoticeText}>
            Couldn&apos;t read your settings — dive numbers may be missing your pre-Ponor count.
          </Text>
        </View>
      )}
      {sections.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.messageText}>No dives match your search.</Text>
        </View>
      ) : (
        // Order, grouping and filtering all already happened above
        // (searchDives/splitPlanned/groupIntoTrips/toListEntries); this just
        // renders whatever ListEntry each section ended up with — a plain
        // DiveRow, or a ReorderControls block for one hand-orderable day.
        <SectionList
          sections={sections}
          keyExtractor={entryKey}
          renderItem={({ item }) =>
            item.kind === 'dive' ? (
              <DiveRow dive={item.dive} number={numbers.get(item.dive.id)} scheme={scheme} onPress={openDive} />
            ) : (
              <ReorderControls
                dives={item.dives}
                numbers={numbers}
                scheme={scheme}
                onPress={openDive}
                onReorder={handleReorder(item.date)}
                disabled={pendingReorderDates.has(item.date)}
              />
            )
          }
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
    </>
  );

  if (!wide) {
    return <View style={styles.screen}>{listPane}</View>;
  }

  return (
    <View style={styles.wideScreen}>
      <View style={styles.wideListColumn}>{listPane}</View>
      <View style={styles.wideDetailColumn}>
        {selectedId === null ? (
          // Composes screen + centerFill itself (rather than wideDetailColumn supplying
          // the padding) so this placeholder lines up with DiveDetailScreen's own root
          // exactly the way a selected dive's detail does — see wideDetailColumn's style
          // comment (theme/styles.ts) for why that padding belongs here, not the column.
          <View style={styles.screen}>
            <View style={styles.centerFill}>
              <Text style={styles.messageText}>Select a dive to see its details.</Text>
            </View>
          </View>
        ) : (
          <DiveDetailScreen id={selectedId} showBackButton={false} />
        )}
      </View>
    </View>
  );
}

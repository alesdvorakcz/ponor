import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, SectionList, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayStrip } from '../components/DayStrip';
import { DiveRow } from '../components/DiveRow';
import { EmptyState } from '../components/EmptyState';
import { applyReorder, createReorderGate, ReorderControls, type ReorderGate } from '../components/ReorderControls';
import { SearchCapsule } from '../components/SearchCapsule';
import { TripHeader } from '../components/TripHeader';
import { reorderDivesForDate } from '../db/dives';
import { useDives } from '../db/useDives';
import { searchDives } from '../domain/search';
import { canReorder, groupIntoTrips, sameDateGroups, splitPlanned } from '../domain/trips';
import { type Dive } from '../domain/types';
import { formatDiveCount } from '../format/display';
import { useHideOnScroll } from '../hooks/useHideOnScroll';
import { useWideLayout } from '../hooks/useWideLayout';
import { resolveScheme } from '../theme/resolve';
import { makeStyles } from '../theme/styles';
import DiveDetailScreen from './DiveDetailScreen';

/**
 * One row of a section's `data`, after `toListEntries` below has decided which same-date
 * dives (`sameDateGroups`, domain/trips.ts) get a `DayStrip` (M1c task 6, DESIGN.md
 * §0.6), which of those get `ReorderControls` instead of plain `DiveRow`s, and which get
 * neither. A discriminated union rather than parallel arrays, so `renderItem` can never
 * pair a `strip` or a `reorderGroup` with the wrong group's dives.
 */
type ListEntry =
  | { kind: 'dive'; dive: Dive }
  | { kind: 'reorderGroup'; date: string; dives: Dive[] }
  | { kind: 'strip'; date: string; count: number };

/**
 * Splits `dives` (one section's worth, already in the screen's own order) into
 * `ListEntry` rows. A `sameDateGroups` run that `canReorder` (domain/trips.ts) says could
 * actually be hand-ordered gets a `strip` entry (DayStrip) ahead of its dives — §0.6:
 * "Hand-ordering lives on a day strip, not a row" — followed by either a `reorderGroup`
 * (when that run's date IS the screen's one `activeReorderDate`, so its rows show
 * arrows) or plain `dive` entries (when it is not, so the strip offers to switch modes
 * but the rows beneath still read exactly as any other day's do — depth visible, no
 * arrows). A run that fails `canReorder` gets plain `dive` entries and no strip at all:
 * `canReorder` gates the STRIP as much as the arrows, since offering a control on a day
 * that cannot actually reorder (`reorderDivesForDate` would report success while
 * changing nothing — ReorderControls.tsx's own `NOT_APPLIED_MESSAGE`) would be a control
 * that lies. This is the ONE place any of that is decided; `DayStrip`, `DiveRow` and
 * `ReorderControls` all just render whatever entry they are handed.
 */
function toListEntries(dives: Dive[], activeReorderDate: string | null): ListEntry[] {
  return sameDateGroups(dives).flatMap((group): ListEntry[] => {
    const date = group.at(0)?.date;
    // sameDateGroups never returns an empty group, and canReorder already
    // requires at least two dives to return true, so `date === undefined`
    // here is unreachable — but typed defensively (falls back to plain rows)
    // rather than asserted past, the same choice `dateRangeOf` (trips.ts)
    // makes for the same shape of "can't actually happen" gap.
    if (date === undefined || !canReorder(group)) {
      return group.map((dive): ListEntry => ({ kind: 'dive', dive }));
    }
    const strip: ListEntry = { kind: 'strip', date, count: group.length };
    const rows: ListEntry[] =
      date === activeReorderDate
        ? [{ kind: 'reorderGroup', date, dives: group }]
        : group.map((dive): ListEntry => ({ kind: 'dive', dive }));
    return [strip, ...rows];
  });
}

/** Stable across a reorder: keyed by the group's full, sorted id set rather
 * than e.g. its first dive's id, which can itself change after a move. */
function entryKey(entry: ListEntry): string {
  switch (entry.kind) {
    case 'dive':
      return entry.dive.id;
    case 'reorderGroup':
      return `reorder:${entry.date}:${[...entry.dives].map((d) => d.id).sort().join(',')}`;
    case 'strip':
      return `strip:${entry.date}`;
  }
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

/** Clearance ABOVE the safe-area inset (`insets.bottom` below) the floating row keeps —
 * so the capsule/fab sit a deliberate distance off the home indicator (or the physical
 * bottom edge, on a device with none) rather than flush against it. Not itself the
 * "clears the home indicator" mechanism — `insets.bottom` is — just the fixed margin added
 * on top of whatever that turns out to be on the device this actually runs on. */
const FLOATING_ROW_BOTTOM_MARGIN = 12;

export default function DivesScreen() {
  const scheme = resolveScheme(useColorScheme());
  const styles = makeStyles(scheme);
  const { dives, numbers, error, settingsError } = useDives();
  const wide = useWideLayout();
  const [query, setQuery] = useState('');
  // Computed here rather than just below, where `sections` actually needs it, because
  // useHideOnScroll's `forceVisible` argument depends on it and a hook call can never
  // follow the early returns below (Rules of Hooks) — this is the single call `sections`
  // used to make on its own, relocated, not a second one. `dives.length === 0` on the
  // empty-logbook branch below makes `matching` trivially `[]` too, which is harmless:
  // that branch returns before `listPane` — and everything below it — is ever reached.
  const matching = searchDives(dives, query);
  // M1c task 8, DESIGN.md §0.6: the floating row (search capsule + "+") recedes as the
  // list scrolls down and returns on the way up. See useHideOnScroll.ts's own docblock for
  // the mechanism and for why a search that has just narrowed to zero results
  // (`matching.length === 0`) forces the row back rather than leaving it wherever the
  // scroll position last put it.
  const hideOnScroll = useHideOnScroll(matching.length === 0);
  // M1c task 11, DESIGN.md §0.6: "the capsule must clear the home indicator" — read off the
  // real device rather than a guessed constant, since how much clearance that needs varies
  // by device (an iPhone with a home button needs none of this; one with a Dynamic Island
  // needs 34pt). Real usage gets a SafeAreaProvider ancestor for free from expo-router's
  // own root layout; DivesScreen.test.tsx supplies the package's own official Jest mock for
  // the same hook, which is what lets it exercise this with a chosen inset instead.
  const insets = useSafeAreaInsets();
  // Wide layout only: which dive's detail shows beside the list (this screen's own
  // docblock, above). Narrow layout never reads this — openDive navigates instead.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Set only when a reorder request could not fully take effect
  // (`applyReorder`'s ApplyReorderResult) — canReorder is meant to keep that
  // unreachable, but it is still handled: see ReorderControls.tsx's
  // NOT_APPLIED_MESSAGE docblock for why an unreachable branch that fails
  // silently is worth guarding anyway.
  const [reorderMessage, setReorderMessage] = useState<string | null>(null);
  // M1c task 6, DESIGN.md §0.6: which day (if any) is currently in hand-ordering mode —
  // a single date, not a Set, since only one `DayStrip` can be "on" at a time (toggling
  // a different day's strip just moves this to that day's date instead of adding a
  // second active one; toggling the active day's own strip sets this back to `null`).
  // `toListEntries` reads this to decide which qualifying date (if any) gets
  // `reorderGroup` rows instead of plain ones; `renderItem` below reads it a second time
  // to dim every row that is not part of that one active date.
  const [activeReorderDate, setActiveReorderDate] = useState<string | null>(null);

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
  // `src/app/dive/new.tsx` (M1d task 6) is a thin route onto DiveFormScreen.tsx's
  // `mode="create"`, the same relationship `openDive` above has with `/dive/[id]`. A
  // relative href, rather than an absolute one, is what lets this compile under
  // expo-router's typed routes (app.config.js's experiments.typedRoutes) without a
  // type-check suppression: typed routes validates an absolute path against the routes
  // that actually exist on disk, but a relative path is resolved at runtime against
  // whatever screen is current, so it deliberately isn't checked against that list.
  // Verified: an absolute `router.push('/dive/new')` here did not typecheck before that
  // route file existed; the relative form did, and still does now that it does.
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

  // `matching` itself is computed above, before the early returns (this file's own note
  // there explains why).
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
            variant: 'upNext' as const,
            // How many dives are queued — NOT a date range. A batch of planned dives has
            // no single trip date range the way a logged trip does (each row states its
            // own date, §3 — DiveRow.tsx's `plannedDate`), and this slot used to be left
            // empty for that reason, which read as a trip whose date range failed to load
            // rather than as a section that has none. The count is the fact this header
            // actually has to add.
            trailing: formatDiveCount(upNext.length),
            data: upNext.map((dive): ListEntry => ({ kind: 'dive', dive })),
          },
        ]
      : []),
    ...groupIntoTrips(logged).map((trip) => ({
      key: trip.key,
      title: trip.title,
      variant: 'trip' as const,
      trailing: trip.dateRange,
      data: toListEntries(trip.dives, activeReorderDate),
    })),
  ];

  // Renders one row of the SectionList's flat `data`, dispatching on `ListEntry`'s own
  // discriminant — `toListEntries`'s own docblock explains what put each kind there.
  // Pulled out of the JSX below as its own function only because a three-way dispatch
  // reads better than nested ternaries; it still closes over this render's own
  // `activeReorderDate`/`numbers`/etc. exactly as inline JSX would.
  const renderListEntry = (item: ListEntry) => {
    if (item.kind === 'strip') {
      return (
        <DayStrip
          date={item.date}
          count={item.count}
          active={item.date === activeReorderDate}
          scheme={scheme}
          onToggle={() => setActiveReorderDate((current) => (current === item.date ? null : item.date))}
        />
      );
    }
    if (item.kind === 'reorderGroup') {
      return (
        <ReorderControls
          dives={item.dives}
          numbers={numbers}
          scheme={scheme}
          onPress={openDive}
          onReorder={handleReorder(item.date)}
          disabled={pendingReorderDates.has(item.date)}
        />
      );
    }
    // `item.kind === 'dive'`: every row that is not part of the one active reorder
    // day's own `reorderGroup` — every row of every OTHER day, whether or not that day
    // qualifies for its own strip — dims to 32% opacity while any day is active (§0.6:
    // "Entering the mode dims the rest ... so row heights do not change" — opacity,
    // like the arrows moving into `depthSlot`, never touches layout). The common case,
    // `activeReorderDate === null`, skips the wrapper's style entirely rather than
    // applying an explicit `opacity: 1`, so an ordinary day's rows stay exactly as
    // unaffected as they were before this task.
    return (
      <View style={activeReorderDate !== null ? styles.reorderDimmed : undefined}>
        <DiveRow dive={item.dive} number={numbers.get(item.dive.id)} scheme={scheme} onPress={openDive} />
      </View>
    );
  };

  // Everything the narrow layout has always rendered inside `styles.screen`, unchanged —
  // written once and reused by both branches below, rather than kept as two copies of the
  // same list that could quietly drift apart (this file's own top docblock).
  const listPane = (
    <>
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
        // (searchDives/splitPlanned/groupIntoTrips/toListEntries); renderListEntry above
        // just renders whatever ListEntry each section ended up with — a DayStrip, a
        // plain DiveRow (dimmed while another day is active), or a ReorderControls block
        // for the one active hand-orderable day.
        <SectionList
          sections={sections}
          keyExtractor={entryKey}
          renderItem={({ item }) => renderListEntry(item)}
          renderSectionHeader={({ section }) => (
            <TripHeader
              title={section.title}
              trailing={section.trailing}
              variant={section.variant}
              scheme={scheme}
            />
          )}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.listContent}
          onScroll={hideOnScroll.onScroll}
          // RN's own default (0) sends only one scroll event per gesture — far too
          // coarse for hideOnScroll's accumulator to track direction against. 16ms
          // matches the screen's refresh rate (RN's docs note no benefit below it).
          scrollEventThrottle={16}
        />
      )}
      {/* M1c task 11, DESIGN.md §0.6: "Search is a floating capsule at the bottom, beside
          the +" — both float here as one row, on top of the list (this element comes
          AFTER the SectionList above in sibling order deliberately: React Native stacks
          siblings by render order regardless of `position: absolute`, so a floating row
          placed before an in-flow SectionList would paint UNDER its rows, not over them,
          as soon as any scrolled past it). `insets.bottom` (useSafeAreaInsets, above)
          clears the home indicator; `FLOATING_ROW_BOTTOM_MARGIN` is the fixed clearance
          kept above that. `hidden` gates pointerEvents/accessibility directly, exactly as
          the old top search wrapper's collapse did, so a diver can never tap into, or have
          a screen reader land on, a row that has faded to nothing. */}
      <View
        style={[
          styles.floatingRow,
          { bottom: insets.bottom + FLOATING_ROW_BOTTOM_MARGIN },
          hideOnScroll.hidden ? styles.floatingRowHidden : undefined,
        ]}
        pointerEvents={hideOnScroll.hidden ? 'none' : 'auto'}
        importantForAccessibility={hideOnScroll.hidden ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={hideOnScroll.hidden}
      >
        <SearchCapsule scheme={scheme} value={query} onChangeText={setQuery} />
        <Pressable style={styles.fab} onPress={logDive} accessibilityLabel="Log a dive" accessibilityRole="button">
          <Text style={styles.fabLabel}>+</Text>
        </Pressable>
      </View>
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

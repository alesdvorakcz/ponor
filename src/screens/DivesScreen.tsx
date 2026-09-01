import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, SectionList, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionCapsule, type CapsuleAction } from '../components/ActionCapsule';
import { DayStrip } from '../components/DayStrip';
import { DiveRow } from '../components/DiveRow';
import { EmptyState } from '../components/EmptyState';
import { applyReorder, createReorderGate, ReorderControls, type ReorderGate } from '../components/ReorderControls';
import { TripHeader } from '../components/TripHeader';
import { reorderDivesForDate } from '../db/dives';
import { useDives } from '../db/useDives';
import { useUnitSystem } from '../db/useUnitSystem';
import { canReorder, groupIntoTrips, sameDateGroups, splitPlanned } from '../domain/trips';
import { type Dive } from '../domain/types';
import { diveSiteLabel, formatDiveCount } from '../format/display';
import { useWideLayout } from '../hooks/useWideLayout';
import { completeDiveHref } from '../navigation/editDiveLink';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenTopInset } from '../theme/styles';
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
 * Four states can look identical to a diver unless they're kept visibly
 * distinct, so each gets its own branch below: a failed read (`error` set)
 * is reported as a failure and must never fall through to "empty logbook";
 * a read that has not answered yet (`resolved` false, M1f) states nothing
 * at all, because an unread logbook and an empty one are the same `[]` and
 * "Log your first dive" was told to every diver on every launch;
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
 * The list column's own JSX — the pinned bar and its capsule, the notices, the section list
 * with the large title at the head of its content — is identical to the narrow layout's; it
 * is written ONCE (`listPane`, below) and reused in both branches, rather than kept as two
 * copies that could quietly drift apart. That is also what keeps the title inside the COLUMN
 * rather than across the window: it is part of the pane, not of the wrapper the two panes sit
 * in, so at 900 px the heading names the list and not the dive beside it. The detail
 * pane reuses `DiveDetailScreen` itself, the exact component `/dive/[id]` renders, rather
 * than a second view that redraws a dive's fields a second way — see that file's own
 * docblock for the two props (`id`, `showBackButton`) this needed and why. `openDive`
 * (below) is the one place that decides whether selecting a row navigates or just updates
 * `selectedId`; every caller — `DiveRow` and `ReorderControls` alike — already goes through
 * it, so neither had to learn about wide layouts at all.
 */

/**
 * The two glyphs the top-right capsule carries (DESIGN.md §3's note), as symbol names —
 * `symbolName` (components/symbolName.ts) owns the per-platform key each is requested by,
 * and this is only which symbol each slot shows.
 *
 * Both are **triggers that leave this screen**, and the capsule is therefore fixed: two
 * glyphs, always the same two, never showing a state of their own. Search opens
 * `/search`, which is where the field lives (SearchScreen.tsx — measured off iOS 26
 * Messages: the field belongs at the BOTTOM, on the keyboard, and only its trigger belongs
 * up here). The `+` opens the form. Neither ever swaps for an × or a Done, so the `+`
 * cannot move out from under a thumb that was reaching for it.
 */
const SEARCH_GLYPH = { ios: 'magnifyingglass', android: 'search' } as const;
const LOG_DIVE_GLYPH = { ios: 'plus', android: 'add' } as const;

export default function DivesScreen() {
  const scheme = resolveScheme(useColorScheme());
  // The diver's units (§3), read once here and threaded down exactly as `scheme` is — one
  // place per screen decides, and every component below stays a pure function of its props.
  const units = useUnitSystem();
  const styles = makeStyles(scheme);
  // `resolved` is read alongside the list because `dives` alone cannot say whether it has been
  // read yet — see the branch below the fatal one, and `DiveListState.resolved` for why the
  // signal is `updatedAt` rather than an empty `data`.
  const { dives, numbers, error, settingsError, resolved } = useDives();
  const wide = useWideLayout();
  // The device's own safe area, read for how far down this screen's content begins: the
  // pinned bar in the narrow layout (`bar`, below) and the wide layout's "nothing selected"
  // pane, both through `screenTopInset` — the one owner every screen in the app asks. The
  // Dynamic Island is the whole reason — a static inset that clears a notch does not clear
  // an island, and there is no way for a scheme-only stylesheet to know which one this
  // phone has.
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
      // Absolute for the same reason `logDive` below is: `/dive/[id]` is a real typed
      // route, and the template form is what expo-router's typed routes actually checks.
      router.push(`/dive/${id}`);
    }
  };
  // `src/app/dive/new.tsx` (M1d task 6) is a thin route onto DiveFormScreen.tsx's
  // `mode="create"`, the same relationship `openDive` above has with `/dive/[id]`.
  // ABSOLUTE, and that is the whole point: expo-router's typed routes
  // (app.config.ts's experiments.typedRoutes) validates an absolute path against the routes
  // that actually exist on disk, where a relative one is resolved at runtime and so is
  // deliberately not checked against anything. The relative form was correct only while
  // `/dive/new` did not exist and an absolute reference could not compile; the route is real
  // now, so the relative spelling buys nothing and costs the check. Measured, not assumed:
  // `router.push('/dives/new')` — a route that does not exist — is a TS2345 here, while
  // `router.push('./dives/new')` compiles perfectly happily, because `RelativePathString` is
  // `` `.${string}` `` and accepts any string at all. One limit worth knowing: `[id].tsx` next
  // door makes `/dive/<anything>` a valid href, so this catches a misspelt or moved SEGMENT
  // but not this file alone being renamed — that would silently resolve to the detail route.
  const logDive = () => router.push('/dive/new');
  // §2.4's *Complete dive*: "After surfacing, Complete dive asks only for the missing
  // numbers." It opens the SAME route the detail screen's own Edit control does — a planned
  // dive is completed by editing it — with the form's Logged/Planned control already
  // flipped to Logged, so that saving finishes the dive, which is exactly what this label
  // promises. `completeDiveHref` (navigation/editDiveLink.ts) owns both ends of that link;
  // this list writes nothing itself, because there is one place a dive's status changes and
  // it is the form's own control (DESIGN.md §10). The href is the route TEMPLATE plus
  // params rather than an interpolated string, which expo-router's typed routes check just
  // as strictly — see that module and `logDive` above.
  const completeDive = (id: string) => router.push(completeDiveHref(id));
  // `/search` (SearchScreen.tsx) is a thin route the same way `/dive/new` is, and absolute
  // for the same reason `logDive` above records: expo-router's typed routes check an
  // absolute path against the files that actually exist.
  const openSearch = () => router.push('/search');

  /**
   * What the capsule carries, in order. §3 expects a third glyph eventually (Calendar's
   * view-toggle); adding one is adding an entry here.
   *
   * Both are plain triggers with fixed labels — neither reports a state, because neither has
   * one to report: this screen is never "in search", it only opens the screen that is.
   */
  const capsuleActions: readonly CapsuleAction[] = [
    { key: 'search', symbol: SEARCH_GLYPH, label: 'Search dives', onPress: openSearch },
    // Unchanged label from the 60 dp circle this replaces: it is the same action, said the
    // same way, and DivesScreen.test.tsx finds it by exactly this string.
    { key: 'log-dive', symbol: LOG_DIVE_GLYPH, label: 'Log a dive', onPress: logDive },
  ];

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

  /**
   * The screen's pinned bar — the **native iOS large-title arrangement** (owner's call, made
   * on the device after seeing both this and the single title row it replaces): the capsule
   * stays in a bar that does not scroll, and the large title (`title`, below) lives in the
   * list's own content and scrolls away.
   *
   * **The capsule floated over the list once, and both problems that caused are answered
   * here structurally.** A capsule floating over a list of STICKY trip headers occludes every
   * one of their date ranges in turn (§0.6's type table puts the range in exactly the slot
   * the capsule floated in) — observed on the simulator as `UNNAMED SITE`'s range reading
   * `…16`. That was first patched by making the capsule recede on scroll (`useHideOnScroll`,
   * since deleted), then fixed by putting it in a row in flow. This bar keeps the fix and
   * does not reopen it: the SectionList is the bar's SIBLING, so its viewport begins at the
   * bar's bottom edge and a sticky header sticks THERE, not under the capsule. The bar is
   * also opaque (`divesBar`, theme/styles.ts), so even if it ever did overlap the list,
   * nothing could be read through it.
   *
   * **The top clearance is the device's, not a number.** `screenTopInset(insets.top)` —
   * see it in theme/styles.ts. The old row inherited `screen`'s static 48, which on a
   * Dynamic Island phone put the capsule at ~52 pt where iOS 26's own Files and Photos put
   * their trailing controls at 62; reading the safe area gives 62 there and leaves every
   * other device on the app's own 48. Every other screen's root now asks that same
   * function, so this bar is no longer the one place in the app that clears the island.
   *
   * **No compact title.** Nothing fades in to replace the title once it has scrolled off —
   * the owner's deliberate choice, on the grounds that the tab bar already says which screen
   * this is, so the screen is never left unidentified.
   *
   * `actions` is optional, and the three branches that omit it are saying something. A failed
   * read has no logbook to search and no dive worth adding to a database that would not
   * read it back; an empty logbook has nothing to search either, and §3 already gives that
   * branch the full-size "Log your first dive" in the thumb zone (§0.5) rather than a
   * 19 px glyph at the far corner; and a read that has not answered (M1f) knows neither, so
   * offering a search that could only answer "No dives match your search" would be the same
   * false statement the branch below it was fixed for. All three keep the TITLE, so the
   * screen names itself in every
   * state, and `divesBarRow`'s own `minHeight` holds the bar at the height the capsule gives
   * it so that name does not move between branches.
   */
  const bar = (actions?: readonly CapsuleAction[]) => (
    <View style={[styles.divesBar, { paddingTop: screenTopInset(insets.top) }]}>
      <View style={styles.divesBarRow}>
        {actions !== undefined && <ActionCapsule scheme={scheme} actions={actions} />}
      </View>
    </View>
  );

  /**
   * The large title, and on the list branch it is handed to the SectionList as its
   * `ListHeaderComponent` — content, not chrome, which is what makes it scroll away.
   *
   * An ELEMENT rather than a `() => JSX` component: `ListHeaderComponent` treats a function
   * as a component type, and an inline arrow is a new type on every render, which remounts
   * the header each time. As an element it simply re-renders, like any other child.
   *
   * The branches with no list (a failed read, an empty logbook) render this same element
   * directly under the bar. There is nothing to scroll there, so "in the scroll content" has
   * no meaning; what matters is that the screen names itself in the same words, the same
   * treatment and the same place in all three states.
   */
  const title = <Text style={styles.divesTitle}>Dives</Text>;

  if (error) {
    return (
      <View style={styles.divesScreen}>
        {bar()}
        {title}
        <View style={styles.centerFill}>
          <Text style={styles.messageText}>
            Couldn&apos;t open your logbook. Try closing and reopening the app.
          </Text>
        </View>
      </View>
    );
  }

  // **"Your logbook is empty" is an answer, so it waits for one** (M1f). `useDives()` hands back
  // an empty list on the renders before its query returns, and this branch could not tell that
  // from a diver's genuine first run — so `EmptyState` filled the whole screen to tell a diver
  // with eleven logged dives that they had none, every time the app opened. The loudest of the
  // five false statements `resolved` closes, and the one that degrades worst under §7's sync: a
  // slow first read stretches the frame, and a diver whose logbook appears to have vanished is
  // the one who goes hunting for a restore button.
  //
  // What is drawn instead is the same frame the two branches around it draw — the bar and the
  // large title, this screen naming itself in every state (`bar`'s own docblock) — with nothing
  // under it. So the title does not move when the logbook, or the prompt, lands beneath it.
  // `bar()` carries no actions here for the reason the branches either side of it carry none:
  // there is nothing yet to search, and a search run against a list that has not been read
  // would answer "No dives match your search", which is the same lie one screen further in.
  //
  // Below the fatal `error` branch rather than above it, and it makes no difference which:
  // a failed read counts as resolved (`isResolved`, db/liveQuery.ts) precisely so that the two
  // orderings are equivalent instead of one of them silently never reporting the failure.
  if (!resolved) {
    return (
      <View style={styles.divesScreen}>
        {bar()}
        {title}
      </View>
    );
  }

  if (dives.length === 0) {
    return (
      <View style={styles.divesScreen}>
        {bar()}
        {title}
        <EmptyState scheme={scheme} onPress={logDive} />
      </View>
    );
  }

  const { planned, logged } = splitPlanned(dives);
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
          units={units}
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
        <DiveRow dive={item.dive} number={numbers.get(item.dive.id)} scheme={scheme} units={units} onPress={openDive} />
        {/* §2.4: a planned dive is one still to be dived, so it gets the one action a
            logged dive has no use for. Keyed on the dive's own `status` — never on which
            section it was rendered in, and never on the section's title, which is an
            i18next label bound for Czech (DESIGN.md §10, the same reason `splitPlanned`
            keys on status). A row of its own beneath the dive's row, not a control nested
            inside `DiveRow`'s single Pressable: two tappable objects in one row make which
            one a tap lands on a matter of pixels. */}
        {item.dive.status === 'planned' && (
          <View style={styles.plannedActions}>
            <Pressable
              style={styles.plannedAction}
              onPress={() => completeDive(item.dive.id)}
              accessibilityRole="button"
              // Names the dive it belongs to, so a screen reader moving down a queue of
              // planned dives can tell one "Complete dive" from the next — the same
              // reasoning ReorderControls.tsx's own `rowLabel` records for its arrows.
              accessibilityLabel={`Complete dive: ${diveSiteLabel(item.dive)}`}
            >
              <View style={styles.plannedActionPill}>
                <Text style={styles.plannedActionLabel}>Complete dive</Text>
              </View>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  // Everything the narrow layout renders inside `styles.divesScreen` — written once and
  // reused by both branches below, rather than kept as two copies of the same list that
  // could quietly drift apart (this file's own top docblock). It opens with the pinned bar
  // and carries the title inside its list, so on the wide layout BOTH belong to the LIST
  // COLUMN rather than to the window: `wideListColumn` renders this same fragment, and the
  // detail pane beside it gets its own heading from `DiveDetailScreen` exactly as it does
  // full-screen.
  //
  // **The two notices sit between the bar and the list, and stay pinned there** rather than
  // joining the title in the scrolling content. Both are things a diver has to actually see:
  // a reorder is started from deep in a long logbook, so a message about one that failed
  // would be reported somewhere already scrolled past, and `settingsError` is a standing
  // condition rather than a moment. Under the bar and above the title is where a banner
  // attached to a bar belongs; with neither showing — the ordinary case — the bar is
  // followed directly by the list and its title.
  const listPane = (
    <>
      {bar(capsuleActions)}
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
        // dismiss. See this file's own top docblock (Important #3) for why a failed settings
        // read must not blank the dives below, and must not fail silently either.
        //
        // **It does not clear itself, and this line used to say it did** (corrected M1f).
        // `useLiveQuery` calls `setError` only in its two failure paths and never clears it
        // (drizzle-orm/expo-sqlite/query.js), so once the settings read has failed, `error`
        // stays set for the life of this component: a later successful re-run sets `data` and
        // `updatedAt` and leaves the banner standing over numbers that are now correct. What
        // to do about that is a real decision — it needs an answer to what "recovered" means
        // given those error semantics, and possibly a wrapper around `useLiveQuery` rather
        // than a change here — so it is recorded as owed rather than invented. The comment is
        // corrected now regardless, because a comment asserting behaviour the code does not
        // have is the defect class this project keeps paying for.
        <View style={styles.settingsNotice}>
          <Text style={styles.settingsNoticeText}>
            Couldn&apos;t read your settings — dive numbers may be missing your pre-Ponor count.
          </Text>
        </View>
      )}
      {sections.length === 0 ? (
        // No list to put the title in, so it is a block here, exactly as on the two branches
        // above that return early.
        <>
          {title}
          <View style={styles.centerFill}>
            <Text style={styles.messageText}>No dives match your search.</Text>
          </View>
        </>
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
          // The large title, as CONTENT — the whole of the native arrangement (`title`
          // above). It scrolls away with the logbook, and the sticky trip headers then stick
          // to the top of this list's viewport, which is the bar's bottom edge and not the
          // capsule.
          ListHeaderComponent={title}
          contentContainerStyle={styles.listContent}
        />
      )}
    </>
  );

  if (!wide) {
    return <View style={styles.divesScreen}>{listPane}</View>;
  }

  return (
    <View style={styles.wideScreen}>
      <View style={styles.wideListColumn}>{listPane}</View>
      <View style={styles.wideDetailColumn}>
        {selectedId === null ? (
          // Composes screen + the top inset + centerFill itself (rather than
          // wideDetailColumn supplying the padding) so this placeholder lines up with
          // DiveDetailScreen's own root exactly the way a selected dive's detail does — see
          // wideDetailColumn's style comment (theme/styles.ts) for why that padding belongs
          // here, not the column. Same `screenTopInset` call the detail screen makes, so the
          // two cannot drift apart by a point.
          <View style={[styles.screen, { paddingTop: screenTopInset(insets.top) }]}>
            <View style={styles.centerFill}>
              <Text style={styles.messageText}>Select a dive to see its details.</Text>
            </View>
          </View>
        ) : (
          // `onDeleted` (M1d task 7) for the same reason `showBackButton={false}` is here:
          // deleting from this pane must not navigate anywhere — the list is already on
          // screen — it must clear the selection, or this pane would sit on "Dive not
          // found." for a dive that was just correctly removed.
          <DiveDetailScreen id={selectedId} showBackButton={false} onDeleted={() => setSelectedId(null)} />
        )}
      </View>
    </View>
  );
}

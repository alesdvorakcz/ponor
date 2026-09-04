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
import { syncEngine } from '../cloud/syncEngine';
import { useAuthSession } from '../cloud/useAuthSession';
import { usePendingChanges } from '../cloud/usePendingChanges';
import { reorderDivesForDate } from '../db/dives';
import { useDives } from '../db/useDives';
import { LOGBOOK_UNREADABLE } from '../domain/logbook';
import { useUnitSystem } from '../db/useUnitSystem';
import { logbookStats } from '../domain/logbookStats';
import { canReorder, groupIntoTrips, sameDateGroups, splitPlanned } from '../domain/trips';
import { type Dive } from '../domain/types';
import {
  diveSiteLabel,
  formatDiveCount,
  formatLogbookSummary,
  formatPendingChanges,
} from '../format/display';
import { useWideLayout } from '../hooks/useWideLayout';
import { completeDiveHref } from '../navigation/editDiveLink';
import { resolveScheme } from '../theme/resolve';
import { makeStyles, screenBottomInset, screenTopInset } from '../theme/styles';
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
 * The list column's own JSX — the notices, the section list with the large title at the head
 * of its content, and the capsule floating beside it — is identical to the narrow layout's; it
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
// Exported for one reason, and it is not a screen concern: these are the app's own
// per-platform glyph names, and `symbolName.test.tsx` is where the `android` half — which is
// also the browser's half — is checked against a real Material name. Nothing under this
// screen's own suite can see it: `ActionCapsule` renders a real `SymbolView`, and
// `SymbolView.ios.tsx` overwrites `name` with `props.name.ios` before it reaches a host node,
// so a wrong or swapped Material name is green here and everywhere else. Kept as data rather
// than moved to a shared module: which glyph this screen shows is this screen's decision,
// and only the naming of it is `components/symbolName.ts`'s.
export const SEARCH_GLYPH = { ios: 'magnifyingglass', android: 'search' } as const;
export const LOG_DIVE_GLYPH = { ios: 'plus', android: 'add' } as const;

/**
 * What a diver reads when the sync **they asked for** could not run (§7.5's pull-to-refresh).
 *
 * §1 is why there is nothing like this for an automatic cycle: "sync failures never block
 * logging", and a boat losing signal is not news. A gesture is different — a diver who pulled
 * the list down and got nothing back has no way to tell a sync that found nothing from one
 * that never happened, and an app that answers a deliberate act with silence reads as broken.
 *
 * It says what is *safe* rather than what *failed*, which is the register `SERVER_UNREACHABLE`
 * (cloud/auth.ts) already sets for the same situation one screen over: the only thing at stake
 * is whether the account has the dives yet, and the answer is that nothing was lost. It names
 * no cause, because this screen cannot know one — the engine reports `failed` and deliberately
 * carries no server text (§9's Sentry, and `cloud/sync.ts`'s rule about error messages).
 *
 * Exported so its test asserts the same string a diver reads.
 */
export const SYNC_FAILED_MESSAGE =
  'Couldn’t sync just now. Your dives are safe on this phone — try again when you’re online.';

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
  /**
   * **Whether anyone is signed in, and it gates both of this screen's §7.5 additions.**
   *
   * Without it the pending line is nonsense on the app's most common device. Every local write
   * sets the dirty flag whether or not there is an account (`db/dirty.ts` — the flag is about
   * the row, not the diver), so a guest with 128 dives has 128 pending rows, for ever, and
   * would read "128 changes waiting to sync" under a title on a phone with nothing to sync
   * *to*. And pull-to-refresh on a signed-out device is a gesture whose only possible outcome
   * is the engine refusing it, which is a control that does nothing.
   *
   * `resolved` is deliberately not read: while the session read is still out, `session` is
   * null and both of these are simply absent, which is what they are on the far more likely
   * answer. Neither states anything, so there is nothing for a not-yet-answered branch to
   * withhold (`db/liveQuery.ts` is the owner of that distinction, and `usePendingChanges.ts`
   * records why it does not bind here either).
   */
  const signedIn = useAuthSession().session !== null;
  // §7.5's "quiet indicator shows pending changes", live off the dirty flags
  // (cloud/usePendingChanges.ts). Read unconditionally — hooks are not optional — and turned
  // into a line, or into nothing, by `formatPendingChanges` below.
  const pending = usePendingChanges();
  // The device's own safe area, read for how far down this screen's content begins: this
  // screen's root (`root` below), the wide layout's list column, and the wide layout's
  // "nothing selected" pane, all three through `screenTopInset` — the one owner every screen
  // in the app asks. The Dynamic Island is the whole reason — a static inset that clears a
  // notch does not clear an island, and there is no way for a scheme-only stylesheet to know
  // which one this phone has.
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
  // §7.5's fourth trigger. `refreshing` is the platform control's own spinner; `syncMessage`
  // is set only when a sync the diver ASKED for could not run (`SYNC_FAILED_MESSAGE` above) —
  // never by an automatic cycle, which reports itself through the pending line and nothing
  // else.
  const [refreshing, setRefreshing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  /**
   * Pull-to-refresh (§7.5). One cycle, through the app's one engine, so a pull made while a
   * foreground or save-triggered cycle is already running queues behind it rather than
   * racing it (`cloud/syncEngine.ts`).
   *
   * **Undefined when signed out**, which is what removes the control rather than disabling it:
   * a spinner that appears and then reports nothing is worse than a gesture the list does not
   * answer at all, and there is genuinely nothing for it to do.
   *
   * The spinner is cleared in a `finally` for the reason every busy flag in this app is: a
   * control that silently stopped working is the failure, not the failure it was reporting.
   * `engine.request()` does not reject — §1 — so the `finally` is belt to the engine's braces.
   */
  const refresh = async () => {
    setRefreshing(true);
    setSyncMessage(null);
    try {
      const outcome = await syncEngine.request();
      // `skipped` is deliberately silent and is unreachable from here anyway: this control does
      // not exist unless a session does. `synced` says nothing either — the list itself is the
      // answer, redrawn by `useDives`'s live query as rows land.
      if (outcome.kind === 'failed') setSyncMessage(SYNC_FAILED_MESSAGE);
    } finally {
      setRefreshing(false);
    }
  };

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
   * **This screen's root, composing the one top clearance every other screen's root composes**
   * (`screenTopInset`, theme/styles.ts — §4.1's owner). Written once here rather than at each
   * of the four branch returns below, so no branch can be the one that forgets it.
   *
   * **It is what puts the title where every other screen's title is** (M1k, the owner's call,
   * DESIGN.md §0.6/§10). Until now this screen composed nothing here and a pinned bar below it
   * spent the inset instead — which cost the large title the bar's whole height, 56 pt lower
   * than "Settings" on the same phone. The bar is gone; the inset is the root's, exactly as on
   * Settings, and `divesTitle`'s `SCREEN_HEADING_TOP` is the only thing between it and the
   * first line of the page.
   *
   * **It is also what keeps the list out of the status bar**, which was the pinned bar's
   * second job (it painted an opaque ground for it). Padding on the root means the
   * SectionList's frame BEGINS below the safe area, so a row scrolling up is clipped at that
   * line rather than passing behind a translucent nothing — the arrangement Settings and the
   * form have always had. An overlay bar with the list full-bleed underneath would have needed
   * that opaque ground back; this needs no chrome at all.
   */
  const root = [styles.screen, { paddingTop: screenTopInset(insets.top) }];

  /**
   * The large title on its own — what a screen with nothing to say about its logbook draws.
   *
   * Every branch below begins with this, either directly (a failed read, a read that has not
   * answered) or inside `heading` (the empty logbook, and the list, where `heading` is handed
   * to the SectionList as its `ListHeaderComponent` — content, not chrome, which is what makes
   * it scroll away). What matters is that the screen names itself in the same words, the same
   * treatment and the same place in all four states. It lands in the same place by
   * construction rather than by a bar reserving the height: it is the first child of the root
   * on three branches and the first content of the list on the fourth, and the list's content
   * has no top padding (`listContent`).
   */
  const title = <Text style={styles.divesTitle}>Dives</Text>;

  /**
   * **§7.5's quiet indicator, or nothing** — `3 changes waiting to sync`, under the summary
   * line (`heading`, below).
   *
   * **Here, on the front door, and in one place only.** §7 asks for one indicator and §4.1 for
   * one owner of any rule; the candidates were this screen, Settings' account row, and the
   * account screen itself. The last two are behind a tap and a tap, and a diver who has to go
   * looking for a status has not been shown one — the whole point of *quiet* is that it is
   * seen without being sought, and the list is the screen a diver is already on. It also sits
   * directly under a line about the same logbook, in the same ink and face, which is what keeps
   * it from reading as an alert.
   *
   * **Only when signed in** (`signedIn`, above — a guest's rows are all flagged and none of
   * them is waiting for anything), and **only when there is something to say**
   * (`formatPendingChanges` returns null at zero, format/display.ts). A device that is up to
   * date draws no line at all, so the title block is its §0.6 self on every ordinary screen.
   *
   * **It is also the whole of what this app tells a diver about a failed sync**, and that is a
   * decision rather than an omission — see `SYNC_FAILED_MESSAGE` above for the one exception.
   * A cycle that fails leaves the flags exactly where they were, so this line simply stays,
   * saying the true thing (the account has not got these yet) instead of the alarming one (a
   * request did not complete). §1 makes that the rule: sync failures never block logging, and a
   * banner that fired every time a boat lost signal would be a failure notice a diver would
   * learn to ignore — which is worse than none, because the day it matters it is furniture.
   */
  const pendingLine = signedIn ? formatPendingChanges(pending) : null;

  /**
   * **The title with §3's three figures under it** (§0.6, M1l — the owner's sheet): `128 dives
   * · 96 h 12 min · deepest 41.2 m`, in muted mono, summarising the logbook the screen is
   * about to draw.
   *
   * **Neither the numbers nor the words are decided here.** `logbookStats`
   * (domain/logbookStats.ts) owns the three figures — including that a planned dive is
   * excluded from all of them (§2.4) and that the count is this logbook's, never
   * `dives_before` — and `formatLogbookSummary` (format/display.ts) owns the sentence and the
   * diver's units. M3's Stats screen renders the same three numbers and imports the same
   * function; a `useMemo` here would be the second computation §4.1's table exists to name.
   *
   * **Only the branches that have an answer render it.** The failed read and the not-yet-read
   * branches below get `title` alone: `logbookStats([])` reads "0 dives", which is a statement
   * about a logbook neither of those screens has managed to look at (§10 — "a screen with no
   * answer must not state one"). On the empty branch it is exactly the "0 dives" M1h put
   * there, produced by the one formatter instead of by a second call site.
   *
   * An ELEMENT rather than a `() => JSX` component, which is what the list branch requires:
   * `ListHeaderComponent` treats a function as a component TYPE, and an inline arrow is a new
   * type on every render, which remounts the header each time. As an element it simply
   * re-renders, like any other child.
   */
  const heading = (
    <>
      {title}
      <Text style={styles.divesSummary}>{formatLogbookSummary(logbookStats(dives), units)}</Text>
      {pendingLine !== null && <Text style={styles.divesPending}>{pendingLine}</Text>}
    </>
  );

  if (error) {
    return (
      <View style={root}>
        {title}
        <View style={styles.centerFill}>
          {/* One sentence, one owner (`LOGBOOK_UNREADABLE`, db/useDives.ts) — four screens
              dispatch on this hook's `error` and each carried its own copy of it until M3b. */}
          <Text style={styles.messageText}>{LOGBOOK_UNREADABLE}</Text>
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
  // What is drawn instead is the same frame the two branches around it draw — the large title
  // at the top of the root, this screen naming itself in every state — with nothing under it.
  // So the title does not move when the logbook, or the prompt, lands beneath it. No capsule
  // here, for the reason the branches either side of it carry none: there is nothing yet to
  // search, and a search run against a list that has not been read would answer "No dives
  // match your search", which is the same lie one screen further in.
  //
  // Below the fatal `error` branch rather than above it, and it makes no difference which:
  // a failed read counts as resolved (`isResolved`, db/liveQuery.ts) precisely so that the two
  // orderings are equivalent instead of one of them silently never reporting the failure.
  if (!resolved) {
    return (
      <View style={root}>
        {title}
      </View>
    );
  }

  // **"0 dives" is what makes this branch distinguishable from the one above it** (M1h, the
  // owner's design), and it arrives through `heading` now (M1l) rather than through a
  // `formatDiveCount` call of its own. The waiting branch draws the title and nothing else,
  // deliberately — §10's "a screen with no answer must not state one" — and until M1h the empty
  // branch's only extra was a sentence at the bottom of the screen, a whole thumb's reach from
  // the title it belongs to. The line says, right under the heading, that the logbook HAS been
  // read and holds nothing.
  //
  // The summary formatter produces exactly "0 dives" here without this branch asking it to: an
  // empty logbook has no duration and no depth behind it, and a figure with nothing behind it
  // is omitted (`formatLogbookSummary`). So the one owner covers both branches and there is no
  // second sentence to keep in step with this condition.
  if (dives.length === 0) {
    return (
      <View style={root}>
        {heading}
        <EmptyState scheme={scheme} system={units} onPress={logDive} />
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

  // Everything the narrow layout renders inside the root — written once and reused by both
  // branches below, rather than kept as two copies of the same list that could quietly drift
  // apart (this file's own top docblock). It carries the title inside its list and the capsule
  // floating beside that title, so on the wide layout BOTH belong to the LIST COLUMN rather
  // than to the window: `wideListColumn` renders this same fragment, and the detail pane beside
  // it gets its own heading from `DiveDetailScreen` exactly as it does full-screen.
  //
  // **The two notices stay pinned above the list** rather than joining the title in the
  // scrolling content. Both are things a diver has to actually see: a reorder is started from
  // deep in a long logbook, so a message about one that failed would be reported somewhere
  // already scrolled past, and `settingsError` is a standing condition rather than a moment.
  // With neither showing — the ordinary case — the root's inset is followed directly by the
  // list and its title, which is what puts the title at Settings' own height. **When one IS
  // showing it pushes the title down, and that is accepted rather than solved**: the capsule
  // goes down with it (it floats inside `divesListArea`, not against the screen), so nothing
  // lands on the banner, and a screen carrying a failure notice is not the state the owner
  // measured the title against.
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
        // dismiss. See this file's own top docblock (Important #3) for why a failed settings
        // read must not blank the dives below, and must not fail silently either.
        //
        // **It does clear itself once the settings read recovers, and that took a mechanism**
        // (M1g). `useLiveQuery` calls `setError` only in its two failure paths and never clears
        // it (drizzle-orm/expo-sqlite/query.js), so this banner used to stand for the life of
        // the component: a later successful re-run set `data` and `updatedAt` and left the
        // notice over numbers that were correct again. That is the same plausible lie the
        // banner exists to prevent, told from the other end — the numbers are right and the
        // screen says they may not be. `useCurrentError` (db/liveQuery.ts) is where the rule
        // lives now, and `useDives` applies it to both of its error fields; nothing on this
        // screen decides it, which is why there is no timer, no dismiss and no comparison here.
        <View style={styles.settingsNotice}>
          <Text style={styles.settingsNoticeText}>
            Couldn&apos;t read your settings — dive numbers may be missing your pre-Ponor count.
          </Text>
        </View>
      )}
      {/* The one thing this screen says about sync in words, and only ever about a pull the
          diver made themselves (`refresh` above). Pressable and dismissible like
          `reorderMessage` and unlike `settingsNotice`, because it reports one attempt rather
          than a standing condition — and pinned above the list with the other two, because a
          diver who has just pulled the list down is looking at the top of it. */}
      {syncMessage !== null && (
        <Pressable
          style={styles.syncNotice}
          onPress={() => setSyncMessage(null)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss message"
        >
          <Text style={styles.syncNoticeText}>{syncMessage}</Text>
        </Pressable>
      )}
      {/* **The region the capsule floats in**, and it is a wrapper with one job: its top edge
          is the title's top edge, so `capsuleFloat` can position against it and land
          beside the title rather than at a measured distance from the display. Both branches
          below are inside it, because both draw the title. See theme/styles.ts. */}
      <View style={styles.divesListArea}>
        {sections.length === 0 ? (
          // No list to put the title in, so it is a block here, exactly as on the two branches
          // above that return early.
          //
          // **`title`, not `heading`, and that is the rule rather than an omission**: the
          // summary describes the whole logbook, and what is beneath it here is a filtered
          // subset of it. A count of every dive over a list of the ones that matched would be
          // the two-populations-in-one-line defect `LogbookStats.dives` records, arriving
          // through the other door. (A logbook with dives always yields at least one section,
          // so this branch is unreachable today — see the "No dives match your search" message
          // it was written for, from when search filtered this screen's own list.)
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
            // **Trip headers scroll like everything else** (§0.6 and §10, owner's call, M1k).
            // The capsule floats over this list beside the title, and the owner's argument for
            // that is about a ROW: one passes under the capsule while scrolling and you scroll
            // on. It is not true of a STICKY header, which parks under the capsule for a whole
            // trip's scroll extent — §0.6's type table puts a trip's date range in exactly the
            // trailing slot the capsule occupies, and that is how `UNNAMED SITE`'s range came
            // to read `…16` on the simulator, twice. So stickiness is what gave way.
            //
            // **`={false}`, not deleted**, and the difference is the whole guarantee: RN's
            // SectionList defaults this to `Platform.OS === 'ios'` (SectionList.js:244), so
            // dropping the prop turns stickiness back ON for every diver on the platform this
            // was observed breaking on. The section list itself stays — §4 chose it for
            // sections, grouping and section headers, and stickiness was one line of that
            // reasoning rather than all of it.
            stickySectionHeadersEnabled={false}
            // The large title and the summary line under it, as CONTENT — the whole of the
            // native arrangement (`heading` above). It scrolls away with the logbook, and
            // nothing sticks in its place.
            ListHeaderComponent={heading}
            // **§7.5's fourth trigger** — the platform's own pull-to-refresh, which §0.6
            // allows for exactly this ("the platform control is fine"): it is chrome the app
            // does not draw, the same reasoning §10 already applies to a destructive
            // confirmation, so it carries no colour of ours and cannot compete with the depth
            // palette (§0.1).
            //
            // **`undefined` when signed out, which removes the control rather than disabling
            // it.** A guest has nowhere to sync to, and a spinner that spins and reports
            // nothing is a worse answer than a list that simply does not pull.
            onRefresh={signedIn ? () => void refresh() : undefined}
            refreshing={refreshing}
            // **The last row's clearance is the device's, not a number** (M1h) —
            // `screenBottomInset(insets.bottom)`, the same owner the empty state below asks and
            // the bottom-edge sibling of the `screenTopInset` this screen's root spends above.
            // Under `unstable-native-tabs` that inset already contains the tab bar: 83 pt on an
            // iPhone 17 Pro, against the flat 24 this carried, so the last dive scrolled to sat
            // 59 pt under the Liquid Glass with its site name cut mid-word. No gap is added on
            // top, unlike the empty state's button: a row's own `paddingVertical` already keeps
            // its text 10 pt off its bottom edge, and a scrolling list whose content ends exactly
            // at the bar is what iOS itself does — extra air here would read as a hole under the
            // last dive at rest rather than as breathing room.
            contentContainerStyle={[styles.listContent, { paddingBottom: screenBottomInset(insets.bottom) }]}
          />
        )}
        {/* **The capsule, floating at the title's trailing side** (§0.6, §10 — the owner's
            call, M1k). Rendered AFTER the list so it paints over it, and last inside this
            region so nothing it overlaps can cover it back.
            `styles.capsuleFloat` is the whole of its position; there is no inset
            arithmetic here, because the region's own top edge is where it belongs. */}
        <View style={styles.capsuleFloat}>
          <ActionCapsule scheme={scheme} actions={capsuleActions} />
        </View>
      </View>
    </>
  );

  if (!wide) {
    return <View style={root}>{listPane}</View>;
  }

  return (
    <View style={styles.wideScreen}>
      {/* The list column composes the top inset itself, exactly as `root` does above and as
          the detail pane beside it does — one per column, so the two line up by construction
          and neither stacks under the other (theme/styles.ts, `wideListColumn`). */}
      <View style={[styles.wideListColumn, { paddingTop: screenTopInset(insets.top) }]}>{listPane}</View>
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

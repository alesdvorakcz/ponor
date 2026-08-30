import { Pressable, View } from 'react-native';

import { db } from '../db/client';
import { type ReorderOutcome } from '../db/dives';
import { type Db } from '../db/types';
import { type Dive } from '../domain/types';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { DiveRow } from './DiveRow';

/**
 * Same shape as `reorderDivesForDate` (db/dives.ts). A parameter rather than
 * an import used directly, so `applyReorder` — and anything that calls it —
 * is testable with a plain `jest.fn()` standing in for the database.
 */
export type Reorder = (db: Db, date: string, orderedIds: string[]) => Promise<ReorderOutcome>;

/**
 * Swaps two ids, tolerating an out-of-range index by handing the array back
 * unchanged instead of throwing. Real button presses never reach an
 * out-of-range index — each `Pressable` below is `disabled` at its day's
 * first/last row — so this is only ever exercised by a caller that ignores
 * that, and "no-op" is the honest answer for a move with nowhere to go.
 */
function swapAdjacent(ids: string[], i: number, j: number): string[] {
  const a = ids[i];
  const b = ids[j];
  if (a === undefined || b === undefined) return ids;
  const next = [...ids];
  next[i] = b;
  next[j] = a;
  return next;
}

/**
 * `listOrder` is the order a day's dives are currently shown in — newest
 * first, same as `listDives`/`toDives` and this component's own rendering.
 * Moves the id at `index` one slot later in THAT order, then returns the
 * day's new order the way `reorderDivesForDate` wants it: CHRONOLOGICAL
 * (oldest first) — the reverse of `listOrder`.
 *
 * That reversal is the one thing this milestone's review flagged by name as
 * a mistake waiting to happen: feeding `reorderDivesForDate` the
 * list-order array unreversed silently inverts the day. Doing it here, once,
 * inside the one function every button press and every test in this file
 * goes through, is what keeps a second, differently-wrong copy of it from
 * ever getting written at a call site.
 */
export function moveDown(listOrder: string[], index: number): string[] {
  return [...swapAdjacent(listOrder, index, index + 1)].reverse();
}

/**
 * Moving the id at `index` up by one is the same swap as moving the id at
 * `index - 1` down by one — swapping `index - 1` and `index` either way — so
 * this is `moveDown` one slot earlier rather than a second implementation of
 * the same reversal.
 */
export function moveUp(listOrder: string[], index: number): string[] {
  return moveDown(listOrder, index - 1);
}

/**
 * Shown when a reorder request could not fully take effect. Per
 * `reorderDivesForDate`'s own docblock, that means the write still landed,
 * but a higher tier — `timeIn` — left the day sorted exactly as it was.
 * `canReorder` (domain/trips.ts) is meant to keep this branch unreachable
 * from the UI; it is handled anyway, because an unreachable branch that
 * fails silently is exactly how a later change to `canReorder` turns into a
 * mystery bug, rather than a diver seeing a message that explains what
 * happened.
 */
const NOT_APPLIED_MESSAGE = "Couldn't reorder — this day already sorts by entry time.";

export interface ApplyReorderResult {
  /** Non-null only when the day did not end up sorted the way `orderedIds`
   * asked. See `NOT_APPLIED_MESSAGE`. */
  message: string | null;
}

/**
 * Calls `reorder` — `reorderDivesForDate` in real use, a test double shaped
 * like it in tests — and turns its `ReorderOutcome` into what the UI shows.
 *
 * What the day actually looks like afterwards is deliberately NOT this
 * function's job to report: that comes back through `useDives()`'s live
 * query re-running against the write this makes, the same single read path
 * every screen already uses (DivesScreen.tsx's own docblock). This function
 * only decides whether anything needs to be SAID about it.
 */
export async function applyReorder(
  date: string,
  orderedIds: string[],
  reorder: Reorder,
): Promise<ApplyReorderResult> {
  const outcome = await reorder(db, date, orderedIds);
  return { message: outcome.applied ? null : NOT_APPLIED_MESSAGE };
}

/**
 * A per-date write guard — DivesScreen.tsx's fix for this task's review
 * finding: tapping the reorder controls rapidly fires overlapping
 * `reorderDivesForDate` calls, and an earlier tap's promise can resolve
 * `applied: true` (so no error shows) after a later overlapping write for
 * the SAME day has already landed and silently overridden it. A control
 * reporting success for an effect that was actually discarded is exactly
 * the failure shape `canReorder` (domain/trips.ts) exists to close for the
 * `timeIn` tier — this closes the same shape where it turns up again, one
 * layer down, as a write race.
 *
 * `run(date, write)` calls `write()` and returns its promise immediately,
 * UNLESS `date` already has a call in flight, in which case it returns
 * `null` and does not call `write` at all — the second request is never
 * even attempted, not merely started and left to lose a race. Whichever
 * date `write` was called for is released — eligible to run again — once
 * that promise settles, success or failure alike (`finally`), so a
 * rejected write can never leave a date stuck.
 *
 * Deliberately not a timing-based debounce: nothing here waits a fixed
 * duration or races a timer against the write. A date is released only by
 * ITS OWN call settling, so this holds regardless of how long a write
 * actually takes on a given device.
 *
 * Scoped per date on purpose, not one lock for the whole screen:
 * `reorderDivesForDate` only ever touches one day's rows
 * (`where date = day`, db/dives.ts), so two different days' writes cannot
 * conflict with each other and have no reason to wait on one another —
 * only a second call for a date that is ALREADY pending is ever blocked.
 *
 * Plain state in a closure, not React state: the check-and-set in `run`
 * has to happen synchronously, in one uninterrupted step, so that two
 * calls issued back to back — before anything has had a chance to react to
 * the first — can never both see "nothing pending" and both proceed. A
 * `useState` value read through a closure captured at the last render
 * cannot give that guarantee (see DivesScreen.tsx's own use of this for
 * why); a plain `Set` mutated directly, with no React re-render in
 * between, can.
 */
export function createReorderGate() {
  const pending = new Set<string>();
  return {
    /** True while `date` has a call started by `run` that has not yet
     * settled. DivesScreen.tsx reads this only to decide what to SHOW
     * (`ReorderControls`'s `disabled` prop) — never to decide whether a
     * write may start; `run` itself is the only thing that decides that. */
    isPending(date: string): boolean {
      return pending.has(date);
    },
    run<T>(date: string, write: () => Promise<T>): Promise<T> | null {
      if (pending.has(date)) return null;
      pending.add(date);
      return write().finally(() => pending.delete(date));
    },
  };
}

export type ReorderGate = ReturnType<typeof createReorderGate>;

/**
 * Distinguishes one row's "Move ... up/down" accessibility label from every
 * other row's — the review flagged "Move dive up"/"Move dive down" as
 * identical on every row, leaving a screen-reader user unable to tell which
 * dive a control belongs to.
 *
 * Site name alone cannot fix that here: every `Dive` this component is ever
 * given in real use shares one exact place. `dives` (this component's prop
 * doc, above) is always one `sameDateGroups` run, and `sameDateGroups` only
 * ever splits up ONE `groupIntoTrips` trip's dives (DivesScreen.tsx's
 * `toListEntries`) — and `groupIntoTrips`'s own `sameTrip` requires
 * `placeOf(a) === placeOf(b)` between every adjacent pair, which (string
 * equality being transitive) makes every dive in a trip share the identical
 * place. So in the one case this task exists for — two or more untimed
 * dives sharing a day, which is also the common case for sharing a site —
 * a label built from site name alone would read the same on every row all
 * over again and not fix anything. Position within the day always
 * distinguishes a row, so it is always included; the site name (this
 * component's own unit tests use fixtures with genuinely different names,
 * since nothing in this component's own contract forbids that either) is
 * added in front of it where there is one, because a place a diver
 * recognises is still more useful to hear than a bare index.
 */
function rowLabel(dive: Dive, index: number, total: number): string {
  const site = dive.siteName ?? dive.centerName;
  const position = `dive ${index + 1} of ${total}`;
  return site !== null ? `${site} (${position})` : position;
}

interface ReorderControlsProps {
  /** One day's dives (`domain/trips.ts`'s `sameDateGroups`), in the screen's
   * own newest-first order — the same dives, same order, `DiveRow` would
   * otherwise render individually. Must satisfy `canReorder`; this
   * component trusts that the caller (DivesScreen) already checked that,
   * the same "trust the caller's grouping" contract `groupIntoTrips`
   * documents for its own `sameTrip`. */
  dives: Dive[];
  numbers: Map<string, number>;
  scheme: ColorScheme;
  onPress: (id: string) => void;
  /**
   * Called with the day's requested new order, in CHRONOLOGICAL
   * (oldest-first) order — `reorderDivesForDate`'s own expected input, and
   * the reverse of `dives`. Typed to return `void`, not a `Promise`: this
   * component does not need to await the write, because the day's actual
   * resulting order arrives back through the next `dives` prop once
   * `useDives()`'s live query re-runs, not through this callback's return
   * value. A caller that needs to act on the outcome (`applyReorder`) is
   * free to pass an async function here regardless — its promise is simply
   * not awaited by this component.
   */
  onReorder: (orderedIds: string[]) => void;
  /**
   * True while THIS day's reorder write is in flight (DivesScreen tracks
   * that per date, not here — this component stays stateless, per its own
   * docblock below). Every button in the group is disabled on top of its
   * existing first/last rule, not just visually: `Pressable`'s own
   * `disabled` prop blocks `onPress` from firing at all, which is what
   * keeps a second press from reaching `onReorder` while the first write's
   * promise is still unsettled. Defaults to `false` so every existing
   * caller/test that never mentions this is unaffected.
   */
  disabled?: boolean;
}

/**
 * 48 dp (§0.5's own floor) minus the arrow's visible 34 x 26 box (this task's brief,
 * "Constraints"), split per edge: `(48 - 34) / 2 = 7` horizontally, `(48 - 26) / 2 = 11`
 * vertically. `hitSlop` only ever extends where a PRESS is *recognised* — unlike
 * width/height, it has no effect on layout — so the touch target can stay generous
 * without the visible box, and therefore the row it sits in, growing to fit it.
 */
const ARROW_HIT_SLOP = { top: 11, bottom: 11, left: 7, right: 7 };

/**
 * Move-up/move-down controls for one day of untimed dives (DESIGN.md §2.5).
 *
 * Arrows, not drag — chosen deliberately, not for lack of a drag library:
 * this only ever applies to a handful of untimed same-day dives (typically
 * two or three rows), arrows are accessible and testable without simulating
 * a gesture, and `reorderDivesForDate` takes an ordered id array either way,
 * so a drag implementation could replace this later without touching the
 * data layer. Do not reach for a drag gesture here.
 *
 * Stateless on purpose: every render reads `dives` fresh rather than keeping
 * its own copy, so there is exactly one source of truth for what order is
 * showing on screen — the same live query DivesScreen reads everything else
 * from. A button press computes the day's new order from THIS render's
 * `dives` and hands it to `onReorder`; the rows this component draws next
 * come from whatever `dives` it is given next, never from state it invented
 * in between.
 *
 * Reuses `DiveRow` for each row's content rather than re-drawing a dive's
 * site/depth/rating a second way — that rendering has exactly one owner
 * already, and duplicating it here is exactly the kind of drift this
 * codebase's other docblocks keep naming as the recurring mistake. M1c task 6
 * (DESIGN.md §0.6) changed WHERE the arrows sit, not that principle: they used to be a
 * separate column beside `<DiveRow>` (a `reorderButtonColumn` sibling, each of its two
 * buttons a 48 x 48 box — stacked, taller than the row itself, which forced the row to
 * grow to match). They now go through DiveRow's own `depthSlot` prop, landing in the
 * exact spot `<DepthValue />` normally occupies, so the row's height is dictated by the
 * same thing it always was — the number/site block above — never by the arrows.
 */
export function ReorderControls({
  dives,
  numbers,
  scheme,
  onPress,
  onReorder,
  disabled = false,
}: ReorderControlsProps) {
  const styles = makeStyles(scheme);
  const listOrder = dives.map((d) => d.id);

  return (
    <View>
      {dives.map((dive, index) => {
        const isFirst = index === 0;
        const isLast = index === dives.length - 1;
        const upDisabled = isFirst || disabled;
        const downDisabled = isLast || disabled;
        const arrows = (
          <View style={styles.reorderArrows}>
            <Pressable
              style={[styles.reorderButton, upDisabled && styles.reorderButtonDisabled]}
              disabled={upDisabled}
              onPress={() => onReorder(moveUp(listOrder, index))}
              accessibilityRole="button"
              accessibilityLabel={`Move ${rowLabel(dive, index, dives.length)} up`}
              accessibilityState={{ disabled: upDisabled }}
              hitSlop={ARROW_HIT_SLOP}
            >
              <View style={styles.reorderArrowUp} />
            </Pressable>
            <Pressable
              style={[styles.reorderButton, downDisabled && styles.reorderButtonDisabled]}
              disabled={downDisabled}
              onPress={() => onReorder(moveDown(listOrder, index))}
              accessibilityRole="button"
              accessibilityLabel={`Move ${rowLabel(dive, index, dives.length)} down`}
              accessibilityState={{ disabled: downDisabled }}
              hitSlop={ARROW_HIT_SLOP}
            >
              <View style={styles.reorderArrowDown} />
            </Pressable>
          </View>
        );
        return (
          <DiveRow
            key={dive.id}
            dive={dive}
            number={numbers.get(dive.id)}
            scheme={scheme}
            onPress={onPress}
            depthSlot={arrows}
          />
        );
      })}
    </View>
  );
}

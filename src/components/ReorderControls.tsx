import { Pressable, Text, View } from 'react-native';

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
}

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
 * codebase's other docblocks keep naming as the recurring mistake.
 */
export function ReorderControls({ dives, numbers, scheme, onPress, onReorder }: ReorderControlsProps) {
  const styles = makeStyles(scheme);
  const listOrder = dives.map((d) => d.id);

  return (
    <View>
      {dives.map((dive, index) => {
        const isFirst = index === 0;
        const isLast = index === dives.length - 1;
        return (
          <View key={dive.id} style={styles.reorderRow}>
            <View style={styles.reorderRowContent}>
              <DiveRow dive={dive} number={numbers.get(dive.id)} scheme={scheme} onPress={onPress} />
            </View>
            <View style={styles.reorderButtonColumn}>
              <Pressable
                style={[styles.reorderButton, isFirst && styles.reorderButtonDisabled]}
                disabled={isFirst}
                onPress={() => onReorder(moveUp(listOrder, index))}
                accessibilityRole="button"
                accessibilityLabel="Move dive up"
                accessibilityState={{ disabled: isFirst }}
              >
                <Text style={styles.reorderButtonLabel}>{'▲'}</Text>
              </Pressable>
              <Pressable
                style={[styles.reorderButton, isLast && styles.reorderButtonDisabled]}
                disabled={isLast}
                onPress={() => onReorder(moveDown(listOrder, index))}
                accessibilityRole="button"
                accessibilityLabel="Move dive down"
                accessibilityState={{ disabled: isLast }}
              >
                <Text style={styles.reorderButtonLabel}>{'▼'}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

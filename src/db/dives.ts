import { and, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { storedCalendarDate, storedTimeOfDay } from '../domain/datetime';
import { compareDiveOrder, storedManualOrder } from '../domain/diveNumber';
import { newId } from '../domain/ids';
import type { Dive } from '../domain/types';
import { dives } from './schema';
import type { Db } from './types';

/**
 * Fields nothing may set after the row is created: id is the primary key,
 * createdAt is the audit trail, updatedAt is stamped by createDive and
 * updateDive themselves, and deletedAt only ever moves through
 * softDeleteDive. The single source for NewDiveInput's Omit below and the
 * runtime strip in withoutImmutableFields, so the two cannot drift apart —
 * updatedAt used to be excluded from NewDiveInput's type but not stripped at
 * runtime, protected only by its position after a spread in an object
 * literal in createDive and updateDive. Reorder either literal for
 * readability and forging it silently reopens, with nothing to catch it.
 * M2 adds user_id to every synced table; with this in place that is one
 * edit here, not three.
 */
const IMMUTABLE_FIELDS = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const;
type ImmutableField = (typeof IMMUTABLE_FIELDS)[number];

/** Anything a caller may set. Only the date is required — DESIGN.md §6. */
export type NewDiveInput = Partial<Omit<Dive, ImmutableField>> & Pick<Dive, 'date'>;

/**
 * What `updateDive` accepts: everything a dive has except `manualOrder`.
 *
 * Hand order is excluded on purpose, and it is the one field a patch may not
 * carry. DESIGN.md §2.5 makes `manual_order` a *tie-break within a date*, not
 * a position, and hand-ordered dives sort before non-hand-ordered ones — so
 * setting it on the dragged row alone, which is exactly what a
 * `<DraggableFlatList onDragEnd>` hands you, moves that row to the **top** of
 * its group rather than to the slot it was dropped in. Executed on three
 * untimed dives: dragging the third into slot two produced `3, 1, 2` instead
 * of `1, 3, 2`. Renumbering the whole day produces the right answer, and
 * `reorderDivesForDate` is the only way to do it.
 *
 * A patch that names `manualOrder` is therefore a compile error, and a cast
 * past that is a runtime throw naming the right function — not a silent strip,
 * which would be its own "silently does nothing" bug. `createDive` still
 * accepts it: a new row cannot express a reordering of existing ones, and an
 * importer legitimately carries an initial order.
 */
export type DivePatch = Partial<Omit<NewDiveInput, 'manualOrder'>>;

/**
 * Type-level proof that the `dives` row and the `Dive` domain type describe the
 * same shape, so toDive's cast below has a contract to lean on rather than being
 * a bare escape hatch. If this stops compiling, the schema and domain/types.ts
 * have drifted apart — fix the drift, don't loosen this assertion.
 */
type Assert<T extends true> = T;
export type Mutual = Assert<
  (typeof dives.$inferSelect extends Dive ? true : false) extends true
    ? (Dive extends typeof dives.$inferSelect ? true : false)
    : false
>;

/**
 * The condition every read must apply. deleted_at is a soft delete (DESIGN.md §6):
 * rows are never removed so a deletion can propagate when sync arrives in M2, and
 * nothing at the schema level stops a query from forgetting to filter it out.
 * Exported and shared rather than repeated so there is exactly one place this
 * filter is written — a tombstoned dive reaching assignDiveNumbers would shift
 * the number of every dive after it. Every read of dives must go through
 * listDives/getDive, never a bare `db.select().from(dives)`.
 *
 * Dive-specific on purpose for now, though gear_presets also carries
 * deleted_at: generalising to a `liveRows(table)` helper with one call site
 * would be abstraction ahead of the second instance. Extract it when the
 * gear-presets repository is written (M1e, §2.1) and there are two.
 */
export const liveDives = isNull(dives.deletedAt);

const now = () => new Date().toISOString();

function toDive(row: typeof dives.$inferSelect): Dive {
  // Belt to the schema's braces. The real guard is `tanksJson`'s decoder in
  // schema.ts, which is the only thing that can catch an *unparseable* blob:
  // JSON.parse runs inside Drizzle's row mapper, before this function is ever
  // called, so a try/catch here would never have run. This shape check still
  // costs nothing and keeps the invariant stated where the type is asserted —
  // Drizzle's $type<Tank[]>() is a compile-time label, not a runtime
  // guarantee.
  return { ...row, tanks: Array.isArray(row.tanks) ? row.tanks : [] } as Dive;
}

export async function createDive(db: Db, input: NewDiveInput): Promise<Dive> {
  const timestamp = now();
  const id = newId();
  const row = {
    ...withNormalisedFields(withoutUndefinedFields(withoutImmutableFields(input))),
    id,
    status: input.status ?? 'logged',
    tanks: input.tanks ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  // Read back rather than returning `row` as-is: fields NewDiveInput left unset
  // are absent keys on this in-memory object (undefined), but a real column read
  // back from SQLite is null — the shape the rest of the app is typed against.
  //
  // RETURNING rather than a trailing getDive, so that read-back is part of the
  // same atomic statement as the INSERT rather than a second one that a
  // concurrent write could land between. Verified byte-identical to the old
  // read-back, including the undefined-vs-null normalisation it exists for.
  // This also makes createDive structurally identical to updateDive and
  // softDeleteDive, which both already use RETURNING, and avoids nesting when
  // M2's push_changes wraps batches in transactions of its own.
  const rows = await db.insert(dives).values(row).returning();
  const created = rows.at(0);
  if (created === undefined) {
    throw new Error(`createDive: insert returned no row: ${id}`);
  }
  return toDive(created);
}

export async function getDive(db: Db, id: string): Promise<Dive | null> {
  const rows = await db
    .select()
    .from(dives)
    .where(and(eq(dives.id, id), liveDives))
    .limit(1);
  // `rows.at(0)` plus an explicit undefined check rather than a length check
  // and `rows[0]`: TypeScript cannot narrow an element type from `.length`, so
  // the length form was safe but unprovable, and provable is what
  // noUncheckedIndexedAccess is on for.
  const row = rows.at(0);
  return row === undefined ? null : toDive(row);
}

/**
 * Every live dive, newest date first — the exact reverse of the order
 * assignDiveNumbers numbers them in. Planned dives are included; the list
 * pins them itself.
 *
 * Sorted in JS with compareDiveOrder (reversed), not a SQL ORDER BY: this
 * function and assignDiveNumbers both need "every live dive, in DESIGN.md
 * §2.5's order," and a second, hand-written tier list here previously drifted
 * from the real one — missing the manualOrder tier entirely, and getting
 * SQL's NULL placement backwards for timeIn, so an untimed dive sorted to
 * the wrong end of its date. No LIMIT is used here — the numbering pass
 * already reads every logged dive by definition, and DESIGN.md targets a
 * few thousand dives — so a SQL-side ordering would only be a second tier
 * list to keep in sync with the first, for no observable benefit.
 */
export async function listDives(db: Db): Promise<Dive[]> {
  const rows = await db.select().from(dives).where(liveDives);
  return rows.map(toDive).sort((a, b) => compareDiveOrder(b, a));
}

/**
 * NewDiveInput's Omit keeps IMMUTABLE_FIELDS out of patch at the type level,
 * but that guarantee is compile-time only. A caller that has bypassed it —
 * a cast, an untyped form payload — could still hand one through, and a bare
 * `{ ...patch }` would spread it straight into the SET clause: id would rename
 * the primary key out from under the very WHERE clause meant to target it,
 * createdAt would forge the audit trail, updatedAt would forge the sync clock,
 * and deletedAt would tombstone the row as a side effect of what looks like an
 * ordinary field edit. Strip all of IMMUTABLE_FIELDS so the guarantee holds
 * even when the type system has been overridden — and even if a caller later
 * reorders the object literal that sets the real values, since this no longer
 * depends on that order the way updatedAt alone used to.
 */
function withoutImmutableFields<T extends object>(patch: T): Omit<T, ImmutableField> {
  const safe = { ...patch } as Record<string, unknown>;
  for (const field of IMMUTABLE_FIELDS) delete safe[field];
  return safe as Omit<T, ImmutableField>;
}

/**
 * Drops keys carried with the value `undefined`, keeping keys set to `null`.
 *
 * A JS object literal produces a carried `undefined` constantly — `{ timeIn:
 * form.timeIn }` where the form has no `timeIn` key is the single most ordinary
 * shape M1c will write — and `'timeIn' in out` cannot tell that apart from a
 * key the caller meant. Deciding it once, here, is the whole fix: **a carried
 * `undefined` means "don't touch", and `null` is the one explicit "clear this
 * field" signal.**
 *
 * Without this, `storedTimeOfDay(undefined)` returned `null` and Drizzle wrote
 * a real NULL, so `updateDive(id, { timeIn: undefined })` silently ERASED a
 * dive's entry time — while `undefined` on every other field was correctly
 * dropped from the SET clause and left the value alone. `date` escaped only by
 * the accident of a different fallback shape. Silently deleting a
 * diver-entered field, with no error and a resolved promise, is the dangerous
 * direction.
 */
function withoutUndefinedFields<T extends object>(patch: T): T {
  const out = { ...patch } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out as T;
}

/**
 * The write boundary for the three fields whose stored form the rest of the
 * app relies on. `date` and `timeIn` are plain `text` columns and
 * `manual_order` is an INTEGER *affinity*, so nothing at the schema level makes
 * DESIGN.md §6's `YYYY-MM-DD` / `HH:MM` contract or §2.5's "nullable integer"
 * true; this is the one place that does. `domain/datetime.ts` owns what the
 * string forms are and `domain/diveNumber.ts` owns what a hand order is.
 *
 * It canonicalises rather than validates, because §1 says logging a dive is
 * never blocked: a real date or time spelled loosely ('2026-8-17', '7:30') is
 * rewritten to the canonical form, an empty timeIn becomes the null the column
 * already uses for "no time", a fractional hand order is rounded, and anything
 * else is stored exactly as given.
 *
 * Only keys carrying a real value are touched. `undefined` is checked as well
 * as `in`, so this holds for a key present with `undefined` and not merely for
 * an absent one — callers pass this through `withoutUndefinedFields` first, and
 * this repeats the condition rather than depending on that having happened.
 *
 * The cast back to T is sound because this only ever replaces a value with
 * another of a type the field already permits, and never adds or removes a key.
 */
function withNormalisedFields<T extends object>(input: T): T {
  const out = { ...input } as Record<string, unknown>;
  if (out.date !== undefined) out.date = storedCalendarDate(out.date);
  if (out.timeIn !== undefined) out.timeIn = storedTimeOfDay(out.timeIn);
  if (out.manualOrder !== undefined) out.manualOrder = storedManualOrder(out.manualOrder);
  return out as T;
}

/**
 * Scoped to liveDives, and the write itself — not a separate pre-check ahead
 * of an unscoped write — rejects when nothing matched, the same "nothing may
 * silently do nothing" rule softDeleteDive follows. A pre-check-then-write
 * split leaves a window between the two where a concurrent softDeleteDive can
 * land: the pre-check already passed, so the old unscoped write went ahead
 * regardless of the row's liveness by the time it ran, landing an edit on an
 * already-tombstoned row while telling the caller the update had failed.
 *
 * Reads the result back from the UPDATE's own RETURNING clause rather than a
 * separate trailing getDive. A second, later SELECT would reopen a race of
 * its own: a delete landing between a successful scoped write and that
 * SELECT would make a genuinely-applied edit report as rejected, even though
 * this function's own write was valid at the moment it ran. RETURNING is
 * part of the same atomic statement as the write, so there is no gap left
 * for anything else to land in between the write and reading its result.
 */
export async function updateDive(db: Db, id: string, patch: DivePatch): Promise<Dive> {
  const named = withoutImmutableFields(patch) as Record<string, unknown>;

  // A key that names no column used to be dropped by Drizzle's SET builder and
  // the update ran anyway — so a patch of entirely mistyped keys did not merely
  // fail to write, it *succeeded and bumped updated_at*. Executed:
  // `{ maxDepth: 30 }` left max_depth_m at 10, returned a row, and advanced the
  // clock. §7 is whole-row last-write-wins keyed on updated_at, so that row
  // then **wins** a sync conflict against a genuine edit made on another
  // device: the device that did nothing overwrites the device that did
  // something. A silent non-write that also destroys a good write.
  //
  // TypeScript's excess-property check already catches a fresh object literal;
  // the hole is the untyped or cast payload — an M1c form submission handed
  // through as Record<string, unknown>, or an M2 sync payload — which is
  // exactly what the next two milestones produce. §1's "never block a save" is
  // about the diver's data, not about a malformed patch object: this throw is
  // unreachable for well-formed input.
  //
  // Checked BEFORE undefined keys are dropped, and deliberately so: a key that
  // names no column is malformed whatever its value, so `{ maxDepth: undefined }`
  // is still a typo worth reporting rather than a "don't touch maxDepth"
  // instruction about a field that does not exist. Dropping it first would
  // hide the typo forever, which is the very silence this guard exists to end.
  const columns = getTableColumns(dives);
  const unknown = Object.keys(named).filter((key) => !(key in columns));
  if (unknown.length > 0) {
    throw new Error(`updateDive: unknown field(s): ${unknown.join(', ')} (${id})`);
  }

  const safe = withNormalisedFields(withoutUndefinedFields(named));

  // DivePatch already makes this a compile error; this catches the cast or
  // untyped payload that got past it. A throw rather than a silent strip,
  // because a dropped hand order looks exactly like a successful reorder.
  //
  // Checked AFTER undefined keys are dropped, unlike the unknown-key guard
  // above: manualOrder names a real column, so carrying it as `undefined` is
  // not an attempt to set it — it is the ordinary "don't touch" case, and the
  // rule has to mean the same thing for every field.
  if ('manualOrder' in safe) {
    throw new Error(
      `updateDive: manualOrder is not settable on one dive — use reorderDivesForDate (${id})`,
    );
  }

  // A patch with nothing left to write is a successful no-op, not an error.
  // It must not reach the UPDATE below, because `updatedAt: now()` would keep
  // the statement alive and advance the clock over an unchanged row — the same
  // §7 last-write-wins hazard the unknown-key guard exists to close, arriving
  // through a different door. It still reads the row rather than returning
  // early, so the caller gets exactly the accepted/rejected answer a real edit
  // would have given for the same id.
  //
  // Throwing here instead would fail an ordinary "Save" on a form the diver
  // opened and changed nothing in — a real M1c flow, and not an error.
  if (Object.keys(safe).length === 0) {
    const unchanged = await getDive(db, id);
    if (unchanged === null) throw new Error(`updateDive: dive not found: ${id}`);
    return unchanged;
  }

  const rows = await db
    .update(dives)
    .set({ ...safe, updatedAt: now() })
    .where(and(eq(dives.id, id), liveDives))
    .returning();
  const row = rows.at(0);
  if (row === undefined) throw new Error(`updateDive: dive not found: ${id}`);
  return toDive(row);
}

/**
 * Rewrites the hand order of every live dive sharing one date as 1..n, in the
 * order given. The only way `manual_order` ever changes after a dive is
 * created, and the affordance M1b's drag-to-reorder should reach for.
 *
 * It takes the *whole day* rather than the moved dive because §2.5's
 * `manual_order` is a tie-break, not a position: a dive that has been ordered
 * by hand sorts before one that has not, so writing an order onto the dragged
 * row alone lifts it to the top of its group instead of dropping it where the
 * diver let go, and dragging two *timed* dives does nothing at all, since
 * `timeIn` outranks hand order. Neither failure raises an error — both just
 * produce a plausible, wrong logbook. Renumbering the whole date is the write
 * that is actually correct, so it is the one the repository offers.
 *
 * `orderedIds` must name exactly the live dives on that date, once each. A
 * subset would leave stale orders on the dives it omitted, which is the same
 * half-applied-ordering bug one tier down; an unknown or duplicated id is a
 * caller bug. All three throw rather than writing something partly right.
 *
 * One statement, not a transaction: the whole renumber is a single UPDATE with
 * a CASE over the ids, so it is atomic on both drivers by construction, needs
 * no nested-transaction handling when M2's `push_changes` wraps batches in
 * transactions of its own, and cannot half-apply. `updated_at` moves on every
 * row it touches, because `manual_order` is a synced column and §7's whole-row
 * last-write-wins has to see the change.
 *
 * **It returns whether the requested order can actually take effect**, and a
 * caller that ignores that is the one thing this function cannot protect you
 * from. Hand order is only the *third* tier: `timeIn` outranks it, so on a day
 * of timed dives the write lands, the promise resolves, and the day sorts
 * exactly as it did before. That is correct per §2.5 and the tiers are frozen —
 * but a drag that reports success and springs back is the worst possible
 * feedback, so the outcome says so instead of leaving M1b to discover it on a
 * device. Offer the drag only where `applied` can be true; `effectiveOrder` is
 * what the day will actually show.
 */
export interface ReorderOutcome {
  /** True when the day now sorts exactly as `orderedIds` asked. */
  applied: boolean;
  /**
   * The order the day actually sorts in after the write — identical to
   * `orderedIds` when `applied`. Derived by sorting the day's rows through
   * `compareDiveOrder` with the new hand orders applied, so it reflects
   * §2.5's real tiers rather than re-deriving them here.
   */
  effectiveOrder: string[];
  /**
   * The ids whose requested position a higher tier overrides. Empty when
   * `applied`; on a day of timed dives, every id whose slot moved.
   */
  overriddenIds: string[];
}

export async function reorderDivesForDate(
  db: Db,
  date: string,
  orderedIds: string[],
): Promise<ReorderOutcome> {
  // Same normalisation the write boundary applies, so a caller holding
  // '2026-8-17' matches rows stored as '2026-08-17'.
  const day = storedCalendarDate(date);

  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length) {
    throw new Error(`reorderDivesForDate: duplicate id in the order for ${day}`);
  }

  // The ordering fields, not just the id, so the outcome below can be computed
  // from compareDiveOrder itself rather than from a second copy of §2.5's tier
  // rules — and without a second round trip.
  const live = await db
    .select({
      id: dives.id,
      status: dives.status,
      date: dives.date,
      timeIn: dives.timeIn,
      manualOrder: dives.manualOrder,
      createdAt: dives.createdAt,
    })
    .from(dives)
    .where(and(eq(dives.date, day), liveDives));
  const liveIds = new Set(live.map((row) => row.id));

  const missing = live.filter((row) => !unique.has(row.id)).map((row) => row.id);
  const unknown = orderedIds.filter((id) => !liveIds.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `reorderDivesForDate: the order must name every live dive on ${day}, once each` +
        (missing.length > 0 ? ` — missing: ${missing.join(', ')}` : '') +
        (unknown.length > 0 ? ` — not on that date: ${unknown.join(', ')}` : ''),
    );
  }
  if (orderedIds.length === 0) {
    return { applied: true, effectiveOrder: [], overriddenIds: [] };
  }

  const branches: SQL[] = [sql`(case ${dives.id}`];
  orderedIds.forEach((id, index) => branches.push(sql`when ${id} then ${index + 1}`));
  branches.push(sql`end)`);

  await db
    .update(dives)
    .set({ manualOrder: sql.join(branches, sql` `), updatedAt: now() })
    .where(and(eq(dives.date, day), liveDives, inArray(dives.id, orderedIds)));

  // What the day will actually show, computed by putting the hand orders this
  // call just wrote through compareDiveOrder — the same comparator listDives
  // and assignDiveNumbers use. Deriving it rather than re-stating "timeIn wins
  // over manualOrder" here is the point: a second copy of the tier rules is
  // precisely the drift this milestone spent itself closing.
  const reordered = live.map((row) => ({
    ...row,
    manualOrder: orderedIds.indexOf(row.id) + 1,
  }));
  const effectiveOrder = [...reordered].sort(compareDiveOrder).map((row) => row.id);
  const overriddenIds = orderedIds.filter((id, index) => effectiveOrder[index] !== id);
  return { applied: overriddenIds.length === 0, effectiveOrder, overriddenIds };
}

/**
 * Tombstones the dive. Rows are never hard-deleted (DESIGN.md §6) so the deletion
 * can propagate to other devices when sync arrives in M2.
 *
 * Scoped to liveDives and rejects when nothing matched, rather than no-op-ing on
 * an id that was never real — the same "nothing may silently do nothing" rule
 * updateDive follows. Deleting an id that is already tombstoned takes the same
 * path: from the live view it is already gone, so it is reported the same as an
 * id that never existed, rather than being treated as a successful no-op.
 */
export async function softDeleteDive(db: Db, id: string): Promise<void> {
  const timestamp = now();
  const result = await db
    .update(dives)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(and(eq(dives.id, id), liveDives))
    .returning({ id: dives.id });
  if (result.length === 0) throw new Error(`softDeleteDive: dive not found: ${id}`);
}

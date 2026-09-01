import { and, eq, getTableColumns } from 'drizzle-orm';

import { withoutPressures } from '../domain/carryOver';
import { sameTanks } from '../domain/diveFormSchema';
import { newId } from '../domain/ids';
import type { GearPreset } from '../domain/types';
import { gearPresets } from './schema';
import { liveRows } from './tombstone';
import type { Db } from './types';

/**
 * Fields nothing may set after the row is created — the same four `db/dives.ts` names, for
 * the same reasons: `id` is the primary key, `createdAt` is the audit trail, `updatedAt` is
 * stamped by the two writers below, and `deletedAt` only ever moves through
 * `softDeleteGearPreset`. The single source for `NewGearPresetInput`'s `Omit` and for the
 * runtime strip in `withoutImmutableFields`, so the type-level guarantee and the runtime one
 * cannot drift apart. M2 adds `user_id` to every synced table; with this in place that is
 * one edit here, not three.
 */
const IMMUTABLE_FIELDS = ['id', 'createdAt', 'updatedAt', 'deletedAt'] as const;
type ImmutableField = (typeof IMMUTABLE_FIELDS)[number];

/**
 * Anything a caller may set. `name` is the one required field: it is the column §6 makes
 * NOT NULL, and it is the only thing the diver ever sees a preset by — a nameless preset is
 * a chip with nothing written on it.
 *
 * `tanks` is optional and defaults to `[]`, matching the column's own default: a preset with
 * no cylinders is a legitimate row (Task 3's editor can create one before the cylinders are
 * filled in), and `[]` is already how §6 spells "no cylinders recorded".
 */
export type NewGearPresetInput = Partial<Omit<GearPreset, ImmutableField>> & Pick<GearPreset, 'name'>;

/**
 * What `updateGearPreset` accepts: a preset's two editable fields, either or both.
 *
 * **Deliberately not the untouched/cleared distinction `DivePatch` carries.** `toDivePatch`
 * exists because a dive has thirty nullable fields and "the diver did not open this group"
 * has to be told apart from "the diver emptied this box". A preset has exactly two fields
 * and both are NOT NULL, so neither can be *cleared* — only replaced — and there is nothing
 * for a diff to express that a plain "here is the new value" does not. Task 3's editor
 * therefore hands over the whole preset, and the no-op rule below is what keeps §7 safe
 * without one.
 */
export type GearPresetPatch = Partial<Omit<GearPreset, ImmutableField>>;

/**
 * Type-level proof that the `gear_presets` row and the `GearPreset` domain type describe the
 * same shape, so `toGearPreset`'s cast below has a contract to lean on rather than being a
 * bare escape hatch. Same assertion `db/dives.ts`'s `Mutual` makes for `dives`, and it is
 * what would have caught migration 0001 dropping five columns from the table while the
 * domain type still named them. If this stops compiling, `schema.ts` and `domain/types.ts`
 * have drifted apart — fix the drift, don't loosen this assertion.
 */
type Assert<T extends true> = T;
export type MutualGearPreset = Assert<
  (typeof gearPresets.$inferSelect extends GearPreset ? true : false) extends true
    ? (GearPreset extends typeof gearPresets.$inferSelect ? true : false)
    : false
>;

/**
 * The tombstone filter for this table (`liveRows`, db/tombstone.ts) — the same rule
 * `liveDives` names for `dives`, from the same owner rather than a second `isNull` written
 * here. Every read below goes through it; a tombstoned preset reaching the dive form would
 * offer the diver a cylinder set they deleted, on another device or on this one.
 */
const livePresets = liveRows(gearPresets);

const now = () => new Date().toISOString();

function toGearPreset(row: typeof gearPresets.$inferSelect): GearPreset {
  // Belt to the schema's braces, exactly as `toDive` is. The real guard is `tanksJson`'s
  // decoder in schema.ts, which is the only thing that can catch an *unparseable* blob —
  // JSON.parse runs inside Drizzle's row mapper, before this function is ever called. This
  // shape check costs nothing and keeps the invariant stated where the type is asserted:
  // Drizzle's `$type<Tank[]>()` is a compile-time label, not a runtime guarantee.
  return { ...row, tanks: Array.isArray(row.tanks) ? row.tanks : [] };
}

/**
 * **A preset stores no pressures** (DESIGN.md §10, and §2.1's own reasoning for
 * carry-over): a preset that filled in 200 bar would be inventing a reading, exactly as a
 * carried-over one would. `withoutPressures` (domain/carryOver.ts) is that rule and this is
 * its second caller — not a second copy of it. See that function for why it lives there.
 *
 * Applied **here**, at the repository, rather than at the screen that captures a preset:
 * this is the one write path, so it holds for the dive form's *Save as preset*, for Task 3's
 * editor, and for whatever M2's sync layer eventually hands in — where a strip at one call
 * site would hold only for that call site. It is also what makes the no-op comparison in
 * `updateGearPreset` honest: the editor reads cylinders back out of a form that shows
 * pressure fields, so the stripping has to happen before anything is compared, or every save
 * of an untouched preset would look like a change.
 */
function withoutStoredPressures(tanks: readonly GearPreset['tanks'][number][]): GearPreset['tanks'] {
  return tanks.map(withoutPressures);
}

export async function createGearPreset(db: Db, input: NewGearPresetInput): Promise<GearPreset> {
  const timestamp = now();
  const id = newId();
  const row = {
    ...withoutImmutableFields(input),
    id,
    name: input.name,
    tanks: withoutStoredPressures(input.tanks ?? []),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  // RETURNING rather than a trailing `getGearPreset`, for the two reasons `createDive`
  // records: the read-back is part of the same atomic statement as the INSERT rather than a
  // second one a concurrent write could land between, and a field the input left unset comes
  // back as the column's real NULL rather than as an absent key.
  const rows = await db.insert(gearPresets).values(row).returning();
  const created = rows.at(0);
  if (created === undefined) {
    throw new Error(`createGearPreset: insert returned no row: ${id}`);
  }
  return toGearPreset(created);
}

export async function getGearPreset(db: Db, id: string): Promise<GearPreset | null> {
  const rows = await db
    .select()
    .from(gearPresets)
    .where(and(eq(gearPresets.id, id), livePresets))
    .limit(1);
  // `rows.at(0)` plus an explicit undefined check rather than a length check and `rows[0]`:
  // TypeScript cannot narrow an element type from `.length`, and provable is what
  // noUncheckedIndexedAccess is on for.
  const row = rows.at(0);
  return row === undefined ? null : toGearPreset(row);
}

/**
 * The preset read, tombstone-filtered and deliberately UNSORTED — `diveRowsQuery`'s shape,
 * and the same split for the same reason: `listGearPresets` awaits it, and `useGearPresets`
 * hands it to drizzle's `useLiveQuery`, which needs a synchronous query it can re-run on
 * every database change.
 *
 * Ordering is not applied here on purpose, and this is the weaker version of `dives`'s
 * reason rather than the same one. SQL *could* express `order by name collate nocase`, so
 * nothing forces the sort out of the query the way §2.5's tiers do — but putting it here
 * would leave `toGearPresets` below sorting as well (it must: `useLiveQuery` makes no
 * ordering promise at all), and two orderings that agree today are two that can disagree
 * tomorrow. One comparator, in one place, reached by both callers.
 */
export function gearPresetRowsQuery(db: Db) {
  return db.select().from(gearPresets).where(livePresets);
}

/**
 * The name two presets are the same preset by: trimmed, and case-folded.
 *
 * One normaliser for both questions that ask it — the order presets are listed in
 * (`comparePresets`) and whether a name is already taken (`presetNamed`) — because a list
 * that sorted "Alu 80" and "alu 80" apart while the duplicate check called them the same
 * would be two answers to one question. `toLowerCase`, not `toLocaleLowerCase`: this is an
 * identity key rather than something a diver reads, and a key that changed meaning with the
 * device's locale would make the same two presets duplicates on one phone and not on
 * another.
 */
function presetNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * **Presets sort by name, case-insensitively**, and that is a decision with two rejected
 * alternatives worth recording.
 *
 * *Most-recently-used* is the tempting one, and it is wrong twice over. It needs a column §6
 * does not have, so it would cost a second migration; and it would write on every *apply*,
 * which under §7's whole-row last-write-wins means the device that merely used a preset
 * beats the device that edited it. It is also worse where it is read: the row of chips at
 * the top of the form's cylinder group is a wet-thumb target (§0.5), and a row that
 * reorders itself after every tap moves the next preset out from under the finger that just
 * pressed one.
 *
 * *Creation order* is what the rows happen to come back in, so it is what a missing
 * comparator silently produces — which is the reason this is asserted directly rather than
 * only in passing. It puts the preset a diver made first at the top for ever, which is a
 * fact about the past rather than about what they are looking for.
 *
 * A name is what the diver reads the chip by, so a name is what they look for. `localeCompare`
 * rather than `<`, so a Czech diver's `Č` sorts where Czech puts it rather than after `Z`;
 * the device's own locale is the right one here precisely because this order is *displayed*
 * and never stored, so two devices disagreeing about it is not a conflict.
 *
 * `createdAt` breaks a tie, so a list holding two presets with the same name (which
 * `presetNamed` below exists to stop the app from creating, but M2 sync can still deliver
 * from another device) has one stable order rather than whichever the sort happened to
 * settle on.
 */
function comparePresets(a: GearPreset, b: GearPreset): number {
  const byName = presetNameKey(a.name).localeCompare(presetNameKey(b.name));
  return byName !== 0 ? byName : a.createdAt.localeCompare(b.createdAt);
}

/**
 * Raw rows to sorted domain presets — `toDives`'s counterpart, and the same contract.
 *
 * Sorts what it is given rather than trusting the caller's order, because `useLiveQuery`
 * makes no ordering promise at all. Takes `unknown[]` rather than the row type for the same
 * reason `toDives` does: `useLiveQuery`'s `.data` is typed that loosely, and this function
 * existing is what stops every caller writing its own `.map(...)`. The cast is sound because
 * both callers (`listGearPresets` below, and `useGearPresets`) only ever hand it rows
 * `gearPresetRowsQuery` itself produced.
 */
export function toGearPresets(rows: unknown[]): GearPreset[] {
  return (rows as (typeof gearPresets.$inferSelect)[]).map(toGearPreset).sort(comparePresets);
}

/**
 * Every live preset, by name. A thin wrapper over `gearPresetRowsQuery` and `toGearPresets`
 * so that this async read and `useGearPresets`'s reactive one are built from the same two
 * parts and cannot diverge.
 */
export async function listGearPresets(db: Db): Promise<GearPreset[]> {
  return toGearPresets(await gearPresetRowsQuery(db));
}

/**
 * The preset already called `name`, or `null` — the app's answer to "is this name taken".
 *
 * **A duplicate name is refused, and this is where that is decided.** Two chips both reading
 * "alu 80 nitrox", holding different cylinders, is a row the diver cannot tell apart and
 * cannot fix by looking; §1's "never block a save" is about a *dive*, and a preset the diver
 * is naming is the same kind of thing `setDivesBefore` already refuses an impossible value
 * for. So the form says so in muted text instead of writing it.
 *
 * A **pure function over a list the caller already holds**, rather than a query of its own,
 * and that is what makes it one rule rather than two. Both callers — the dive form's *Save
 * as preset* and Task 3's editor — are already rendering `useGearPresets()`'s live list, so
 * asking it here needs no second read, cannot race its own render, and gives the same answer
 * the diver is looking at. A check inside `createGearPreset` would need a query, would race
 * it, and would still leave the screen with nothing to *say*.
 *
 * `exceptId` is the preset being edited: renaming a preset to the name it already has is not
 * a collision with anything, and without this exception Task 3's editor would refuse every
 * save that did not change the name.
 */
export function presetNamed(
  presets: readonly GearPreset[],
  name: string,
  exceptId?: string,
): GearPreset | null {
  const key = presetNameKey(name);
  return presets.find((preset) => preset.id !== exceptId && presetNameKey(preset.name) === key) ?? null;
}

/**
 * `NewGearPresetInput`'s `Omit` keeps `IMMUTABLE_FIELDS` out at the type level, but that
 * guarantee is compile-time only — a cast or an untyped payload (an M2 sync row) could still
 * carry one, and a bare `{ ...patch }` would spread it straight into the statement: `id`
 * would rename the primary key out from under the very WHERE clause meant to target it,
 * `createdAt` would forge the audit trail, `updatedAt` would forge the sync clock, and
 * `deletedAt` would tombstone the row as a side effect of what looks like a rename. Same
 * strip `db/dives.ts` applies, and for the same reasons.
 */
function withoutImmutableFields<T extends object>(patch: T): Omit<T, ImmutableField> {
  const safe = { ...patch } as Record<string, unknown>;
  for (const field of IMMUTABLE_FIELDS) delete safe[field];
  return safe as Omit<T, ImmutableField>;
}

/**
 * Renames a preset, replaces its cylinders, or both. Task 3's editor is its caller; it is
 * written here rather than there because the repository is one object with one set of
 * contracts, and splitting its write path across two tasks is how contracts drift.
 *
 * **A write that changes nothing must not advance `updated_at`.** §7 is whole-row
 * last-write-wins keyed on that column, so a no-op write makes the device that did nothing
 * win the conflict against the device that did something — a preset edited on a phone,
 * silently reverted by a tablet whose owner merely opened it and tapped Save. `updateDive`
 * closes this by diffing in the domain (`toDivePatch`) before it is ever called; a preset has
 * no untouched/cleared distinction to diff (see `GearPresetPatch`), so the comparison lives
 * here instead, over the values as they will actually be stored — pressures already stripped,
 * because the editor reads its cylinders back out of a form that shows pressure fields.
 *
 * The comparison is `sameTanks` (domain/diveFormSchema.ts), never `JSON.stringify`, which
 * would also compare key ORDER and report an unchanged preset as changed purely because the
 * stored blob and a freshly parsed cylinder were built in different orders.
 *
 * **What the read-then-write does and does not close.** The read and the write are both
 * scoped to `livePresets`, so the hazard `updateDive`'s docblock describes — a pre-check that
 * gates the write on *liveness*, leaving a window for a concurrent delete to land before an
 * unscoped write — does not arise here: the write carries its own liveness condition, and a
 * row tombstoned in between produces the same "not found" a missing one does. What remains is
 * that a concurrent *edit* landing between the two could make this call's "nothing changed"
 * verdict stale. That is the same window `updateDive` already has one layer up, where
 * `toDivePatch` diffs against the dive the screen loaded; there is one writer per device and
 * one screen at a time, and closing it properly needs a transaction, which this repository
 * deliberately does not open (see `reorderDivesForDate` for why M2's batched `push_changes`
 * makes nested transactions a cost worth avoiding).
 */
export async function updateGearPreset(
  db: Db,
  id: string,
  patch: GearPresetPatch,
): Promise<GearPreset> {
  const named = withoutImmutableFields(patch) as Record<string, unknown>;

  // A key that names no column is dropped by Drizzle's SET builder and the update runs
  // anyway — so a patch of entirely mistyped keys does not merely fail to write, it
  // *succeeds and bumps updated_at*, and that row then wins a sync conflict against a
  // genuine edit made on another device. `updateDive` carries the executed version of this
  // (`{ maxDepth: 30 }` left the column alone, returned a row, and advanced the clock); the
  // live source for a preset is an untyped payload — M2 sync, or a screen handing a form
  // object through — and this milestone has just deleted five columns from this very table,
  // which is exactly the shape of stale key that would arrive.
  //
  // Checked BEFORE undefined keys are dropped, deliberately: a key that names no column is
  // malformed whatever its value, so `{ weightsKg: undefined }` is still a stale field worth
  // reporting rather than a "don't touch weightsKg" instruction about a column that no
  // longer exists.
  const columns = getTableColumns(gearPresets);
  const unknown = Object.keys(named).filter((key) => !(key in columns));
  if (unknown.length > 0) {
    throw new Error(`updateGearPreset: unknown field(s): ${unknown.join(', ')} (${id})`);
  }

  const current = await getGearPreset(db, id);
  if (current === null) throw new Error(`updateGearPreset: preset not found: ${id}`);

  // A carried `undefined` means "don't touch" and is dropped; the two columns here are both
  // NOT NULL, so unlike a dive's fields there is no `null`-means-clear case for it to be
  // told apart from. The same contract `withoutUndefinedFields` states for dives, arriving
  // at a simpler answer because the shape is simpler.
  const name = patch.name ?? current.name;
  const tanks = withoutStoredPressures(patch.tanks ?? current.tanks);

  // A patch that asks for what is already stored is a successful no-op, not an error and not
  // a write. It still returns the row a real edit would have returned for the same id, so a
  // caller cannot tell "you changed nothing" from "your change was already there" — which is
  // correct, because they are the same outcome. Throwing here instead would fail an ordinary
  // Save on an editor the diver opened and changed nothing in.
  if (name === current.name && sameTanks(current.tanks, tanks)) return current;

  const rows = await db
    .update(gearPresets)
    .set({ name, tanks, updatedAt: now() })
    .where(and(eq(gearPresets.id, id), livePresets))
    .returning();
  const row = rows.at(0);
  if (row === undefined) throw new Error(`updateGearPreset: preset not found: ${id}`);
  return toGearPreset(row);
}

/**
 * Tombstones the preset. Rows are never hard-deleted (DESIGN.md §6) so the deletion can
 * propagate to the diver's other devices when sync arrives in M2.
 *
 * Scoped to `livePresets` and rejects when nothing matched, rather than no-op-ing on an id
 * that was never real — the same "nothing may silently do nothing" rule `softDeleteDive`
 * follows. Deleting an id that is already tombstoned takes the same path: from the live view
 * it is already gone, so it is reported the same as an id that never existed.
 */
export async function softDeleteGearPreset(db: Db, id: string): Promise<void> {
  const timestamp = now();
  const result = await db
    .update(gearPresets)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(and(eq(gearPresets.id, id), livePresets))
    .returning({ id: gearPresets.id });
  if (result.length === 0) throw new Error(`softDeleteGearPreset: preset not found: ${id}`);
}

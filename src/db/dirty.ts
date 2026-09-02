import { and, eq, getTableColumns, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from './types';

/**
 * The dirty flag's mechanics, shared by every table that carries one — `db/dives.ts`,
 * `db/gearPresets.ts` and `db/catalogue.ts` are the owners that *use* it, exactly as they
 * use `db/tombstone.ts`'s `liveRows`.
 *
 * DESIGN.md §7.1 is three clauses: "rows flagged dirty go up … the server stamps updated_at
 * and returns canonical rows … the client clears its flags". The first clause is
 * `stampLocalWrite` below, the third is `clearDirtyFlags`, and the second belongs to the
 * server. Nothing here talks to one.
 *
 * M2g added the three other ways the flag legitimately moves, each of them §7 as well:
 * `flagAllRows` is §7.4's adoption ("every local row is marked dirty and pushed"),
 * `applyPulledRows` is §7.2's upsert (a row that came down is a row that does not have to go
 * up), and `countPendingRows` is what §7.4's wipe is gated on. They are here rather than
 * copied into three repositories for this file's whole reason: the rules are identical on all
 * four synced tables, and the copy that got one wrong would be the one nobody looked at.
 *
 * **Every failure this file exists to prevent is silent.** A write that forgets the flag is a
 * row that never reaches the server and raises nothing, on one device, possibly for months. A
 * flag cleared for a row that changed while the push was in flight is the diver's edit gone
 * the same way. Neither shows up in a log, a screen or a gate — which is why both are held
 * structurally here rather than by remembering.
 */

/**
 * Any table §7 pushes: it has an id, a clock, and a flag. Structural rather than a union of
 * the four tables, for the reason `liveRows` takes a column rather than a table — `settings`
 * and `sync_state` have no flag, so passing one of them is a compile error rather than a
 * runtime surprise, and a fifth synced table needs no edit here.
 */
export type PushableTable = SQLiteTable & {
  readonly id: SQLiteColumn;
  readonly updatedAt: SQLiteColumn;
  readonly dirty: SQLiteColumn;
};

/**
 * The two property keys `applyPulledRows` reasons about by name, tied to the type so that
 * renaming either on `PushableTable` is a compile error rather than a sweep that quietly
 * stops excluding anything. `schema.ts`'s `DIRTY_COLUMN` is the *SQL* name of the same flag
 * and is a different fact — that one is what must never appear in a payload; this one is what
 * must never be taken from `excluded`.
 */
const ID_KEY = 'id' satisfies keyof PushableTable;
const DIRTY_KEY = 'dirty' satisfies keyof PushableTable;

/**
 * **The stamp every local write carries: the clock and the flag, produced together.**
 *
 * The two are one fact — "this device changed this row and the server has not seen it yet" —
 * and §7's whole-row last-write-wins reads one half while §7's push reads the other. Written
 * separately they can come apart in the one direction nothing notices: `updated_at` advanced
 * without the flag is a row that wins a conflict it will never be in, because it never goes
 * up. So a writer takes both from here or neither.
 *
 * Callers that need a second timestamp equal to this one — `createDive`'s `created_at`, a
 * soft delete's `deleted_at` — take it from the returned `updatedAt` rather than calling
 * `new Date()` again, so the row's stamps cannot disagree by a millisecond.
 *
 * **A write that changes nothing must not call this.** §6 states that rule for `updated_at`
 * ("a device that did nothing must not win against one that did") and the flag inherits it
 * whole: a no-op write that flagged the row would push an unchanged row and let the server
 * restamp it, which is the same conflict lost by a slower route. `updateGearPreset` compares
 * before it writes and `updateDive` returns early on an empty patch; both are tested.
 *
 * **It also announces the write** (`onLocalWrite`, below — §7.5's debounced trigger). That is
 * not a second job: the announcement says exactly what the stamp means, and it is made here
 * because here is the one place in the app where a row becomes something the server has not
 * seen.
 */
export function stampLocalWrite(): { readonly updatedAt: string; readonly dirty: true } {
  const stamp = { updatedAt: new Date().toISOString(), dirty: true } as const;
  announceLocalWrite();
  return stamp;
}

/** Told that this device has just made a change the server has not seen. Takes no argument:
 * §7.5's trigger is "after any save", and which row it was makes no difference to a cycle
 * that reads the whole push set for itself. */
export type LocalWriteListener = () => void;

const localWriteListeners = new Set<LocalWriteListener>();

/**
 * **Subscribes to "this device just wrote something the server has not seen."** DESIGN.md
 * §7.5's third trigger — "a debounced 10 s after any save" — needs to know when a save
 * happened, and this is the only honest place to learn it.
 *
 * **Here rather than in the three repositories, for this file's whole reason.** `db/dives.ts`,
 * `db/gearPresets.ts` and `db/catalogue.ts` between them hold eight writes that flag a row, and
 * a ninth arrives with every feature; a notification bolted onto each of them is eight places
 * to forget and one of them would be the one nobody looked at. `stampLocalWrite` is already
 * the single choke point — §4.1 and the docblock above make it so — and the fact it produces
 * *is* the fact §7.5 wants.
 *
 * **And it is why sync cannot trigger itself.** `applyPulledRows`, `clearDirtyFlags`,
 * `flagAllRows` and `recordPull` all write rows and none of them takes a stamp, deliberately
 * and for reasons that predate this. So a cycle's own writes announce nothing, and there is no
 * loop to break — which the obvious alternative, `expo-sqlite`'s `addDatabaseChangeListener`,
 * would have needed a filter to avoid (every pull writes `sync_state`, so every cycle would
 * have scheduled the next one, for ever).
 *
 * **The announcement comes a moment before the row lands.** The stamp is taken, announced, and
 * then used in the UPDATE or INSERT, so a listener that went and *read* the database here
 * would see the row as it was. The one subscriber schedules a cycle ten seconds out
 * (`cloud/syncEngine.ts`), which is why that is safe; anything wanting to act immediately must
 * not be wired here.
 *
 * Returns its own unsubscribe, so a caller with a lifetime — a mounted component — can end it.
 */
export function onLocalWrite(listener: LocalWriteListener): () => void {
  localWriteListeners.add(listener);
  return () => {
    localWriteListeners.delete(listener);
  };
}

/**
 * Tells every listener, and **lets none of them cost the diver their save**.
 *
 * §10 draws the line this catch sits on: a *local save* failure is shown to the diver and a
 * *sync* failure is not. A listener that threw would come back out of `createDive` as a failed
 * save — the app reporting that a dive was not written when it was about to be — which is the
 * loudest possible version of the wrong one of those two rules. The listener is a sync
 * trigger; the worst its failure can cost is a cycle, and the next trigger runs one anyway.
 *
 * **Iterated over the set itself, not a copy**, and that is a decision rather than an
 * oversight. A `Set` is well defined under both mutations during iteration — a value deleted
 * before it is reached is skipped, one added is visited — so the copy buys nothing structural,
 * and the two differ only in what happens to a listener that has *just unsubscribed*: over a
 * copy it is called anyway. Called-after-unsubscribing is the wrong answer, and a copy taken
 * "for safety" would have been a line no test could ever have failed over.
 */
function announceLocalWrite(): void {
  for (const listener of localWriteListeners) {
    try {
      listener();
    } catch {
      // Deliberately silent, and deliberately not `console`: §9 wires Sentry in M3 and turns
      // console output into breadcrumbs, and `cloud/auth.ts` records why nothing in this app
      // writes one on a path a diver's own data travels.
    }
  }
}

/**
 * The condition selecting the rows that still have to go up.
 *
 * **Deliberately not tombstone-filtered**, which is the one thing about it worth stating out
 * loud: §7 propagates a deletion as a row, so a soft-deleted dive is a dive that must be
 * pushed. Reusing `liveRows` here — the filter every *read* applies, and the obvious thing to
 * reach for — would mean deletions never left the device, and the diver's other phone would
 * keep showing a dive they deleted, with nothing raised anywhere. `db/dives.ts`'s own
 * `liveDives` docblock says every read of dives must go through `listDives`/`getDive`; this
 * is not a read of dives for the diver, it is the push set.
 */
export function pendingRows(table: PushableTable): SQL {
  return eq(table.dirty, true);
}

/** A row as it was when it went up: the id that was pushed, and the clock it was pushed at. */
export interface PushedRow {
  readonly id: string;
  readonly updatedAt: string;
}

/**
 * Clears the flag on rows that went up — **and only where the row has not changed since**.
 *
 * §7.1's last clause is "the client clears its flags", and the naive reading of it (clear
 * every flag that was set when the push started) loses data on a device that is still being
 * used: a push takes a second or two, a diver edits a dive while it is in flight, and the
 * clear sweeps away the flag for an edit the server has never seen. The dive stays on the
 * phone, correct on screen, and never syncs again — no error, nothing to notice.
 *
 * So the caller says which rows it pushed *and what their clock read at the time*, and a row
 * whose `updated_at` has moved since keeps its flag. The comparison is a plain string
 * equality on the value this device wrote, not a parse and not an ordering: `stampLocalWrite`
 * is the only producer of these strings, and any change to a row produces a new one.
 *
 * **An empty list clears nothing.** Drizzle's `and`/`or` return `undefined` for no arguments
 * and `.where(undefined)` is an UPDATE with no WHERE clause — every row in the table,
 * silently. The early return is that hazard, closed; it is tested.
 *
 * Returns the ids actually cleared, so a caller can tell what changed under it rather than
 * assuming its own list.
 */
export async function clearDirtyFlags(
  db: Db,
  table: PushableTable,
  pushed: readonly PushedRow[],
): Promise<string[]> {
  if (pushed.length === 0) return [];

  const matches = pushed.map((row) => and(eq(table.id, row.id), eq(table.updatedAt, row.updatedAt)));
  const cleared = await db
    .update(table)
    .set({ dirty: false } as Record<string, unknown>)
    .where(or(...matches))
    .returning({ id: table.id });

  return cleared.flatMap((row) => (typeof row.id === 'string' ? [row.id] : []));
}

/**
 * Flags **every** row of a table, tombstones included — DESIGN.md §7.4's adoption: "on first
 * sign-in, every local row is marked dirty and pushed". Returns the ids it flagged.
 *
 * **It sets the flag and nothing else, and that is the whole of it.** No `stampLocalWrite`
 * here, deliberately: adoption changes no dive, so advancing `updated_at` would be this
 * device claiming a write it did not make, and §6's last-write-wins would then let it beat a
 * genuine edit made on the diver's other phone a moment earlier. §7.4 says the same thing
 * from the other end — "nothing on the client changes at sign-in but the dirty flags".
 *
 * Tombstoned rows are flagged too, for `pendingRows`' reason: a deletion travels as a row, so
 * an adoption that skipped the tombstones would hand the account a logbook containing dives
 * the diver had already thrown away.
 */
export async function flagAllRows(db: Db, table: PushableTable): Promise<string[]> {
  const flagged = await db
    .update(table)
    .set({ dirty: true } as Record<string, unknown>)
    .returning({ id: table.id });
  return flagged.flatMap((row) => (typeof row.id === 'string' ? [row.id] : []));
}

/**
 * How many rows of this table the server has not acknowledged yet.
 *
 * **This is the question the wipe is gated on** (`cloud/localLogbook.ts`), which is why it is
 * a read of the database and not a number a push handed back. §7.4 promises a diver that
 * their logbook "stays in your account, and signing back in brings it back", and that is true
 * of a pushed row and false of a dirty one — so the erase has to be able to *check*, from the
 * rows themselves, rather than to trust a caller's account of what it sent. A push that threw,
 * a push that half-succeeded and a push that was never attempted all read the same here.
 *
 * The same condition `pendingRows` builds, counted rather than selected, so the gate and the
 * push set can never disagree about what "still owed" means.
 */
export async function countPendingRows(db: Db, table: PushableTable): Promise<number> {
  return (await pendingRowsQuery(db, table)).length;
}

/**
 * The same question as a query builder, for `useLiveQuery` — §7.5's quiet indicator
 * (`cloud/usePendingChanges.ts`) watching what this device still owes.
 *
 * **One builder, two readers**, which is the point: the awaited count above and the live one
 * the indicator draws must never be able to disagree about which rows are owed. It selects the
 * id alone because the count is all either reader wants, and because a `select()` of whole
 * dives re-read on every write would be the logbook coming back through a second door.
 */
export function pendingRowsQuery(db: Db, table: PushableTable) {
  return db.select({ id: table.id }).from(table).where(pendingRows(table));
}

/**
 * Writes rows the server sent, **clean**, and only where they may safely replace what is here.
 *
 * Lifted out of `db/catalogue.ts` in M2g, unchanged in intent and with one condition added
 * (see 3 below): `dives` and `gear_presets` need exactly this and the copy that got it wrong
 * would be the one nobody looked at (§4.1). The three tables' owners keep the named wrappers.
 *
 * Three rules, all of them §7.2's ("the client upserts by comparing `updated_at`"), and every
 * one of them silent when wrong:
 *
 * 1. **Never dirty.** A pulled row that arrived flagged would push itself straight back on the
 *    next sync, ask the server to restamp `updated_at`, and hand the conflict to whichever
 *    device echoed last — for ever, because every echo re-arms it. The flag is written here,
 *    from types (`PulledDive`, `PulledSite`, …) that cannot carry one.
 * 2. **Only if newer.** An older row must not overwrite a newer one. The comparison is
 *    `excluded.updated_at > <table>.updated_at`, a plain string comparison in the ISO-Z
 *    spelling §7 makes the RPCs return (M2a): the client's own `toISOString()` shape, so the
 *    two sides sort together. Both sides of it are read off the table's own column rather than
 *    spelled here, so a renamed column cannot leave this comparing something else.
 * 3. **Never over a row this device still owes the server** (M2g). This is the one that was
 *    missing, and the case is not exotic — it is the ordinary one. `push_changes` restamps
 *    `updated_at` with the *server's* clock, so the server's echo of a row can carry a later
 *    timestamp than a local edit made after the push went out, purely because the phone's
 *    clock runs behind. Rule 2 alone would then let that echo win, silently dropping an edit
 *    that exists nowhere else — the very edit `clearDirtyFlags` just went to the trouble of
 *    keeping flagged. A dirty row is therefore left alone until it has gone up; the next push
 *    sends it and the server resolves the conflict, which is where §7 puts that decision.
 *
 * **The update set is derived from the table's own columns**, never listed here. §10 records
 * why in M2b's words — "a helper is only a single owner if its output cannot lose a column" —
 * and the failure a hand-written list produces is a column that quietly stops being updated by
 * pulls: it would arrive on first insert, look right, and then never change again.
 *
 * Returns the ids actually written, so a caller can tell what landed rather than assume its
 * own list did. (A very large catalogue should be handed over in batches: §9's web-spike note
 * puts a 1 MiB ceiling on a single synchronous result in the browser.)
 */
export async function applyPulledRows(
  db: Db,
  table: PushableTable,
  rows: readonly Record<string, unknown>[],
): Promise<string[]> {
  if (rows.length === 0) return [];

  const columns = getTableColumns(table);
  const fromServer = Object.entries(columns)
    .filter(([key]) => key !== ID_KEY && key !== DIRTY_KEY)
    .map(([key, column]) => [key, sql.raw(`excluded.${column.name}`)] as const);
  const set: Record<string, unknown> = Object.fromEntries(fromServer);
  // Not from `excluded`: the server has no flag to send, and this is rule 1 — a row that came
  // down is a row that does not have to go up.
  set[DIRTY_KEY] = false;

  const written = await db
    .insert(table)
    .values(rows.map((row) => ({ ...row, [DIRTY_KEY]: false })))
    .onConflictDoUpdate({
      target: table.id,
      set,
      setWhere: and(
        sql`${sql.raw(`excluded.${table.updatedAt.name}`)} > ${table.updatedAt}`,
        eq(table.dirty, false),
      ),
    })
    .returning({ id: table.id });

  return written.flatMap((row) => (typeof row.id === 'string' ? [row.id] : []));
}

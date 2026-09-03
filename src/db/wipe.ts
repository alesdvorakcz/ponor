import { sql, type SQL } from 'drizzle-orm';

/**
 * **The condition every §7.4 sign-out erase carries — and the one line in this repository
 * that most looks like it should be deleted.**
 *
 * `delete from t` with no WHERE is not a delete of every row. It is SQLite's *truncate
 * optimisation*: `OP_Clear`, which throws the table's pages away wholesale without ever
 * visiting a row. A row that is never visited never reaches `sqlite3_update_hook` — and that
 * hook is the entire notification chain this app's screens run on:
 *
 * - `db/client.ts` and `db/client.web.ts` both open with `enableChangeListener: true`,
 * - which makes `expo-sqlite` register the hook and emit `onDatabaseChange` from inside it
 *   (`expo-sqlite/ios/SQLiteModule.swift` calls `exsqlite3_update_hook` and sends the event
 *   from the callback; the web worker does the same through wa-sqlite),
 * - and drizzle's `useLiveQuery` re-runs its query on **nothing else** — one
 *   `addDatabaseChangeListener` subscription, filtered by table name
 *   (`drizzle-orm/expo-sqlite/query.js`).
 *
 * So a bare wipe erases the logbook and every live read on screen keeps the rows it already
 * had, until the process restarts. **Observed, not deduced:** the owner signed out with three
 * dives; `select count(*) from dives` returned 0 immediately afterwards and the list went on
 * drawing all three, with the summary `3 dives · 22 min · deepest 40.0 m` sitting above rows
 * that no longer existed. A relaunch showed the correct empty state.
 *
 * §7.4's whole reason for erasing is that "a device that keeps one person's dives after they
 * have left is the only way a second account could ever see them". A signed-out phone still
 * showing that logbook is that sentence inverted, on the one screen a diver would look at to
 * check.
 *
 * ── Why `1 = 1`, which is deliberate and not the first thing that compiled ────────────────
 *
 * The optimisation is chosen on the **presence of a WHERE expression at code-generation
 * time**, before any constant is folded: `if( rcauth==SQLITE_OK && pWhere==0 && !bComplex
 * && !IsVirtual(pTab) )` in `sqlite3DeleteFrom` (verbatim in the SQLite expo-sqlite ships,
 * `expo-sqlite/ios/sqlite3.c`). Any WHERE at all defeats it, so the only real question is
 * which one cannot be *wrong* — and the failure to avoid here is the opposite of the one
 * being fixed. A predicate that quietly matches some rows and not others erases part of
 * somebody's logbook and leaves the rest on a signed-out phone, which is worse than the
 * display bug.
 *
 * `1 = 1` names no column. It therefore cannot depend on a nullable one, cannot be planned
 * as an index scan that misses rows, cannot be affected by a column being renamed or
 * dropped, and is true of a row in every state these tables have — live, tombstoned, dirty,
 * clean. `id is not null` and `deleted_at is null or deleted_at is not null` were both
 * considered and both buy the appearance of meaning at the price of naming a column that has
 * nothing to do with why the clause is here.
 *
 * Measured by opcode on the SQLite this repository tests against (3.53.4):
 *
 *     delete from t              →  Init Clear Clear Halt …            no row visited
 *     delete from t where 1 = 1  →  … Rewind Rowid … Delete Next …     every row visited
 *
 * ── What is checked, and the part that honestly is not ───────────────────────────────────
 *
 * Jest runs `better-sqlite3`, which exposes **no update hook at all**, so nothing in this
 * repository can observe the notification — only the statement that would produce it.
 * `wipe.test.ts` therefore reads the opcodes of the SQL each wipe actually executes, which is
 * the mechanism itself rather than a proxy for it, and asserts separately that the rows are
 * all gone, because a constant-false predicate produces exactly the same opcodes as this one.
 *
 * And the obvious instrument is worse than none: an `AFTER DELETE` trigger, which is the
 * natural way to watch rows go past, is itself one of the things that disables the truncate
 * optimisation (`bComplex` above). Measured — a bare `delete` emits per-row `Delete` opcodes
 * the moment such a trigger exists. It would have reported every one of these five sites as
 * healthy while they were broken.
 *
 * ── Shared, for §4.1's reason ────────────────────────────────────────────────────────────
 *
 * Five wipes need this and five copies of the explanation is five chances for one of them to
 * be shortened into a lie. It is `db/tombstone.ts`'s shape exactly: a condition owned in one
 * place and applied by each table's own repository, so `db/dives.ts` stays the only writer to
 * dives (§4.1) and `dirty.test.ts`'s sweep of who may write at all stays true as written.
 */
export const EVERY_ROW: SQL = sql`1 = 1`;

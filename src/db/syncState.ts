import { eq } from 'drizzle-orm';
import { syncState } from './schema';
import type { Db } from './types';
import { EVERY_ROW } from './wipe';

/**
 * What `sync_state` *means* — the one reader and the one writer of §7's pull watermark, and
 * the coercion contract for what a missing or unreadable row degrades to.
 *
 * This is `db/settings.ts`'s job for a different table, and it is written as a separate
 * module for the reason §4.1 gives that one: "a second key/value path is the defect this
 * table exists to name". `settings` is the diver's preferences, keyed by text and coerced on
 * the way out; this is protocol state with one meaning, one type and one row. Mixing them
 * would put the watermark within reach of anything that clears, exports or resets a
 * preference, and would make `last_pulled_at` a string that has to be told apart from
 * `dives_before` and `units` at the point of reading.
 *
 * ── The value ─────────────────────────────────────────────────────────────────────────────
 *
 * **It is the server's clock and never this phone's** (§7.3: "`last_pulled_at` comes from the
 * server's response, never the phone's clock — divers change time zones constantly"). Nothing
 * in this module produces a timestamp. There is no `new Date()` here and there must not be
 * one: a watermark invented locally on a phone whose clock runs fast skips every row the
 * server changed in between, on that device, permanently and silently.
 *
 * **A stored value is opaque.** It is handed back to `pull_changes` exactly as it arrived and
 * is never parsed, compared, or rendered. The one thing this module knows about it is that
 * §7.2 makes the whole protocol a *string* comparison in the client's own ISO-Z spelling
 * (M2a) — which is a fact about the server's rendering, not about anything happening here.
 *
 * **An obligation on whoever writes sign-out** (§7.4: "signing out wipes the local logbook"),
 * written here because it is invisible from there: **this row has to go with it.** A watermark
 * left behind belongs to the account that left, and the next account's first pull would start
 * from a moment it has never seen — so every row changed before it is skipped, on that device,
 * for ever. Losing the watermark costs one full pull; keeping somebody else's costs the
 * logbook. M2d wrote that as a sentence because there was no sign-out path to attach it to;
 * `forgetLastPulledAt` at the bottom of this file is that sentence with a caller
 * (`cloud/localLogbook.ts`) and a test.
 */

/**
 * The single row's key. `sync_state` holds exactly one row, and this is what makes that true
 * at runtime: `recordPull` upserts on it, so a second pull updates rather than inserts, and
 * `readLastPulledAt` asks for it by name rather than taking whatever row comes first. A table
 * with an unconstrained id and a reader that took `rows.at(0)` would answer differently
 * depending on SQLite's storage order the moment a second row existed.
 */
const SYNC_STATE_ROW = 'sync_state';

/** The row as a builder, for `useLiveQuery` — the shape `db/settings.ts`'s readers take. */
export function lastPulledAtQuery(db: Db) {
  return db.select().from(syncState).where(eq(syncState.id, SYNC_STATE_ROW));
}

/**
 * The watermark to hand the next `pull_changes`, or `null` for "pull everything".
 *
 * **What a missing or nonsense row degrades to, and why it is not a throw.** `db/settings.ts`
 * draws a line between the two answers, and this value falls on `readUnitSystem`'s side
 * rather than `getDivesBefore`'s: a lost watermark costs a full pull, which §7 makes free
 * because "the upsert is idempotent", and the device ends up with exactly the same rows. A
 * *wrong* watermark is the dangerous one — one that is too new skips rows for ever — and the
 * way to be wrong is to invent a value, which is precisely what a fallback other than null
 * would do. So: absent row, non-string value, or empty string all read as **never pulled**,
 * and the device re-reads the world once. Nothing about that is worth failing a diver's
 * screen over, which is why this never throws.
 *
 * `rows` is `unknown[]` rather than this query's real return type, because `useLiveQuery`'s
 * `.data` is typed that loosely — the same reason `db/settings.ts`'s readers take it.
 */
export function readLastPulledAt(rows: unknown[]): string | null {
  const row = Array.isArray(rows) ? rows.at(0) : undefined;
  const value =
    row !== null && typeof row === 'object'
      ? (row as { lastPulledAt?: unknown }).lastPulledAt
      : undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** The awaited form of the read above — one row, one meaning, one degrade rule. */
export async function getLastPulledAt(db: Db): Promise<string | null> {
  return readLastPulledAt(await lastPulledAtQuery(db));
}

/**
 * Records the watermark a pull returned.
 *
 * **Takes the server's string and stores it unread**, surrounding whitespace apart — which is
 * trimmed only so that "the server sent nothing" is a question this function can answer. It
 * does not validate what is left, because
 * nothing here can: the only authority on what a watermark means is the server that issued
 * it, and a client that rejected a spelling it did not recognise would stop syncing rather
 * than lose an hour of overlap. It does refuse an empty one, because an empty string and "no
 * watermark" are the same fact and storing the first would be a second way to say the second
 * — `readLastPulledAt` would have to know both, which is exactly the "two ways to say one
 * thing" §6 rejects for a nullable `tanks`.
 *
 * **A push must never call this** (M2c's README says the same thing about a search):
 * `push_changes` deliberately returns no watermark, and `search_sites` returns a filtered
 * subset — advancing the watermark on either would step it past rows the device has not
 * seen, which the next pull then skips for ever.
 */
export async function recordPull(db: Db, serverTimestamp: string): Promise<void> {
  const value = serverTimestamp.trim();
  if (value === '') {
    throw new Error('recordPull: the server returned no watermark; refusing to store an empty one');
  }
  await db
    .insert(syncState)
    .values({ id: SYNC_STATE_ROW, lastPulledAt: value })
    .onConflictDoUpdate({ target: syncState.id, set: { lastPulledAt: value } });
}

/**
 * Forgets the watermark — §7.4's sign-out, and the obligation this module's docblock has
 * carried since M2d as a sentence with nothing to enforce it.
 *
 * "A watermark left behind belongs to the account that left, and the next account's first pull
 * would start from a moment it has never seen — so every row changed before it is skipped, on
 * that device, for ever. Losing the watermark costs one full pull; keeping somebody else's
 * costs the logbook." There is a sign-out path in the repository now (`cloud/localLogbook.ts`),
 * so it is a function.
 *
 * Deletes the row rather than writing an empty string into it, for `recordPull`'s reason: an
 * empty value and no row are the same fact, and storing the first would be a second way to say
 * the second.
 *
 * **`EVERY_ROW` looks pointless on a table that holds one row and is not** — `db/wipe.ts` has
 * the reason, and it is the same reason on one row as on a hundred: a `delete` with no WHERE
 * is a truncate, and a truncate notifies nobody. Nothing draws the watermark today, so this is
 * the site where the missing clause would cost nothing *yet*, which is exactly how the other
 * four would come back.
 */
export async function forgetLastPulledAt(db: Db): Promise<void> {
  await db.delete(syncState).where(EVERY_ROW);
}

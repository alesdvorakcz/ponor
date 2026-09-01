import { isNull, type Column, type SQL } from 'drizzle-orm';

/**
 * The condition every read of a tombstoned table must apply.
 *
 * `deleted_at` is a soft delete (DESIGN.md §6): rows are never removed, so a deletion can
 * propagate to the diver's other devices when M2's `pull_changes` arrives — and nothing at
 * the schema level stops a query from forgetting to filter it out. What a forgotten filter
 * costs is not merely a stale row on screen: a tombstoned dive reaching `assignDiveNumbers`
 * shifts the number of every dive after it, and a tombstoned preset would offer the diver a
 * cylinder set they deleted.
 *
 * **This was `liveDives` in db/dives.ts, and it is generalised here now because there are
 * two.** That constant's own docblock said so in as many words — "generalising to a
 * `liveRows(table)` helper with one call site would be abstraction ahead of the second
 * instance. Extract it when the gear-presets repository is written (M1e, §2.1) and there
 * are two." `dives.ts` keeps exporting `liveDives`, built from this, so its existing callers
 * and the reasoning attached to that name are untouched.
 *
 * It takes the **column** rather than the table it belongs to, so a table without a
 * `deleted_at` cannot be passed at all: `settings` is local-only and has no tombstone
 * (§6), and a filter silently matching nothing on it would be a read that quietly returned
 * every row. The structural `{ deletedAt: Column }` parameter is what makes that a compile
 * error rather than a runtime surprise.
 */
export function liveRows(table: { deletedAt: Column }): SQL {
  return isNull(table.deletedAt);
}

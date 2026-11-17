import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/**
 * Every column of `table` whose SQL type is INTEGER and whose value is a plain number — on
 * `dives` today `manual_order`, `duration_min`, `rating`, `waves`, `current` and `surge`, and on
 * `dive_sites` #31's `wreck_sunk_year`.
 *
 * Read off the schema rather than typed out per table, so a column added to `schema.ts` as an
 * `integer()` is covered the day it exists instead of the day someone remembers a list. One
 * owner for both `db/dives.ts` and `db/catalogue.ts` (§4.1), moved here from the former by #31.
 *
 * **A boolean column falls out of this filter by construction, and that is worth keeping
 * written down.** Drizzle gives `integer(..., { mode: 'boolean' })` its own `columnType` —
 * `SQLiteBoolean`, not `SQLiteInteger` — even though it is INTEGER in SQL, so it never reaches
 * the rounding below, which would be nonsense for it. `hood`, `gloves` and `boots` relied on
 * that until M1h replaced them with the `equipment` token set (§10), and every table's `dirty`
 * flag relies on it now.
 */
export function integerColumns(table: SQLiteTable): readonly string[] {
  return Object.entries(getTableColumns(table))
    .filter(([, column]) => column.columnType === 'SQLiteInteger')
    .map(([name]) => name);
}

/**
 * DESIGN.md §10's `manual_order` rule — "non-integers are rounded rather than rejected, per §1"
 * — applied to every INTEGER column, because none of the reasoning recorded there was ever
 * specific to that one field.
 *
 * SQLite's INTEGER is an *affinity*, not a constraint: it converts a REAL to INTEGER only when
 * the conversion is lossless, so `1.5` written through a repository reads back as `1.5` with
 * storage class `real`. §6 puts the same schema in Postgres, where an `integer` column has no
 * such laxity, so a fractional value would round or error on its way through `push_changes` —
 * and an error there fails the diver's whole push (§7), while under whole-row last-write-wins a
 * value that changes shape in transit is a value that silently changes on the diver's other
 * device. The rounding happens here, once, where the app can see it, instead of there.
 *
 * A value that is not a number at all cannot be rounded into one and becomes null, which is
 * what the column already means by null. That includes a numeric-looking *string*: `'45'` is
 * not a number, and this is deliberately not the "lenient about spelling" boundary
 * `storedCalendarDate` is — nothing a diver types reaches an INTEGER column without going
 * through a form's own coercion first (`optionalNumber`, domain/diveFormSchema.ts). It also
 * keeps the save alive, which is the §1 half: an object or a boolean handed to better-sqlite3
 * throws, and a row lost to a bound-parameter error is a far worse trade than a tie-break or a
 * rating reading null.
 */
export function storedInteger(value: unknown): number | null {
  return Number.isFinite(value) ? Math.round(value as number) : null;
}

/**
 * `storedInteger` over every one of `columns` that a write carries, leaving the rest alone.
 *
 * Only keys carrying a real value are touched — `undefined` is checked rather than `in`, so a
 * key present with `undefined` is left exactly as absent as a missing one. The cast back to T is
 * sound because this only ever replaces a number with a number or null, which an INTEGER
 * column's field already permits, and never adds or removes a key.
 */
export function withStoredIntegers<T extends object>(columns: readonly string[], input: T): T {
  const out = { ...input } as Record<string, unknown>;
  for (const column of columns) {
    if (out[column] !== undefined) out[column] = storedInteger(out[column]);
  }
  return out as T;
}

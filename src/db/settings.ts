import { eq } from 'drizzle-orm';
import { isDiveCount } from '../domain/diveNumber';
import { settings } from './schema';
import type { Db } from './types';

/**
 * Local-only key/value settings (DESIGN.md §6). The table is deliberately
 * `text`/`text`, so every value comes back a string and every read has to
 * decide what that string means. Typed accessors live here so no caller ever
 * holds the raw one.
 *
 * That is not a stylistic preference. `dives_before` is the diver's pre-Ponor
 * dive count and it offsets *every dive number in the app* (§2.5). Handed
 * straight to `assignDiveNumbers`, the string `'247'` is silently rejected by
 * that function's own hardening guard — `Number.isInteger('247')` is false —
 * and falls back to 0, so a diver with 247 prior dives sees dive #1 instead of
 * #248, with no error, no warning and no failing test. The guard is right (a
 * raw string would otherwise turn every number into `'24701'` via `+`); it
 * just turns the most likely real mistake into silence. Reproduced against a
 * real database before this file existed: raw → 1, `Number(value)` → 248.
 *
 * So the coercion happens here, once, at the boundary where the string is
 * born — and a value that cannot be interpreted throws rather than quietly
 * becoming zero.
 */
const DIVES_BEFORE_KEY = 'dives_before';

/**
 * The diver's pre-Ponor dive count, as a real number.
 *
 * Absent means 0 — a diver who has never answered the onboarding question has
 * no prior dives, which is a genuine answer rather than a missing one. A
 * *present but uninterpretable* value is different: it means the stored count
 * has been corrupted or hand-edited, and returning 0 for it would misnumber
 * every dive in the logbook by the diver's entire history without saying so.
 * This throws instead, following the same "nothing may silently do nothing"
 * rule `updateDive` and `softDeleteDive` already apply to a missing row.
 */
export async function getDivesBefore(db: Db): Promise<number> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, DIVES_BEFORE_KEY))
    .limit(1);

  const row = rows.at(0);
  if (row === undefined) return 0;

  // Decimal digits only, checked before coercing. `Number` is far more
  // permissive than "an integer written out": Number('') is 0, and
  // Number('0x10') is 16, Number('1e3') is 1000, Number('0b101') is 5 and
  // Number('+5') is 5 — every one of which passes an isInteger check
  // afterwards, so a hand-edited or corrupted '0x10' would silently become a
  // pre-Ponor count of 16. Nothing the app writes can take those forms
  // (setDivesBefore writes String(count)), which is exactly why anything that
  // does is corruption and must be reported rather than interpreted.
  const raw = row.value.trim();
  const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!isDiveCount(parsed)) {
    throw new Error(
      `settings.${DIVES_BEFORE_KEY} is not a non-negative integer: ${JSON.stringify(row.value)}`,
    );
  }
  return parsed;
}

/**
 * Records the diver's pre-Ponor dive count.
 *
 * Rejects anything that is not a non-negative integer, so the unreadable-value
 * path in `getDivesBefore` stays unreachable through the app's own writes.
 * §1's "never block a save" is about the diver's dives; this is a settings
 * value whose only legal shape is a count, and storing a fractional or
 * negative one would produce dive numbers that cannot exist.
 */
export async function setDivesBefore(db: Db, count: number): Promise<void> {
  if (!isDiveCount(count)) {
    throw new Error(`setDivesBefore: expected a non-negative integer, got ${String(count)}`);
  }
  const value = String(count);
  await db
    .insert(settings)
    .values({ key: DIVES_BEFORE_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

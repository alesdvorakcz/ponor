/**
 * The one place in the tree that knows what a dive's `date` and `timeIn`
 * strings look like — `YYYY-MM-DD` and `HH:MM` (DESIGN.md §6, `types.ts`).
 *
 * Before this module existed the contract was asserted in three modules at
 * three different strictnesses and enforced in none: `derived.ts` matched a
 * strict `/^(\d{2}):(\d{2})$/` and called `Date.parse` on the date,
 * `diveNumber.ts` compared both as raw strings, and the schema stored them as
 * plain `text`. The same stored value therefore got three different verdicts —
 * `'7:30'` sorted *after* `'19:00'` in the dive list (lexicographically '1'
 * precedes '7') while `timeOut('7:30', 45)` returned null, and `'2026-8-17'`
 * was numbered after `'2026-08-18'` while `surfaceIntervalMin` refused to read
 * it at all. Both inputs are ordinary: an untouched react-hook-form TextInput
 * yields `''`, and free-text time entry yields `'7:30'` as readily as
 * `'07:30'`. The result was a wrong number printed next to a dive with no
 * error anywhere. That is the same one-rule-written-twice defect class that
 * produced the `#2, #1, #3` ordering bug earlier in M1a, and it is closed the
 * same way: by construction, with a single owner every other module calls.
 *
 * The strictness is one rule now: **lenient about spelling, strict about
 * meaning.** A value that denotes exactly one real time or date is accepted
 * and canonicalised, however it was spelled — `'7:30'` is 07:30 and
 * `'2026-8-17'` is 2026-08-17, since a 24-hour field admits no other reading.
 * A value that denotes no real time or date at all is refused — `'25:00'`,
 * `'08:60'`, `'2026-02-30'`, `''`, and anything that is not a string. Nothing
 * here ever guesses: a minute must be two digits, so `'8:1'` is refused rather
 * than read as either 08:01 or 08:10.
 *
 * Nothing here rejects a save. DESIGN.md §1 is explicit that logging a dive
 * must never be blocked, so the write boundary (`storedCalendarDate` /
 * `storedTimeOfDay` below, applied by `db/dives.ts`) canonicalises what it
 * can and stores the rest unchanged. The goal is that a malformed value cannot
 * silently mis-sort or mis-compute, not that the diver is turned away.
 */

/**
 * Deliberately 1-2 digits for the hour and the day/month, so a non-canonical
 * but unambiguous spelling parses; deliberately exactly 2 for the minute, so
 * nothing has to guess whether `'8:1'` meant 08:01 or 08:10, and exactly 4 for
 * the year so `'26-08-17'` is not silently read as the year 26.
 */
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/**
 * Both public date functions come from here so the canonical spelling and the
 * epoch millisecond value can never disagree about the same input.
 *
 * `Date.parse` range-checks the month but **rolls the day**: `'2026-02-30'`
 * parses happily and comes back as 2026-03-02, and `'2026-02-31'` as
 * 2026-03-03. Parsing successfully is therefore not the same as naming a real
 * calendar date, and only a round-trip through `toISOString` proves it. That
 * distinction is not academic — before this check existed,
 * `surfaceIntervalMin(prev '2026-02-28', next '2026-02-30')` returned a
 * surface interval overstated by exactly 24 hours, and overstating is the
 * direction that function's own docblock names as unsafe next to a diver's
 * nitrogen-loading judgement.
 */
function canonicalCalendarDate(value: unknown): { canonical: string; utcMs: number } | null {
  if (typeof value !== 'string') return null;
  const match = DATE_PATTERN.exec(value.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Number.isInteger is false for NaN, which is what an absent capture group
  // would produce — the regex guarantees all three, but this way the guard
  // does not depend on that guarantee holding after a future edit.
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const canonical = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  const utcMs = Date.parse(`${canonical}T00:00:00.000Z`);
  if (Number.isNaN(utcMs)) return null;
  if (new Date(utcMs).toISOString().slice(0, 10) !== canonical) return null;
  return { canonical, utcMs };
}

/** Both public time functions come from here, for the same reason. */
function canonicalTimeOfDay(value: unknown): { canonical: string; minutes: number } | null {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return { canonical: `${pad(hours, 2)}:${pad(minutes, 2)}`, minutes: hours * 60 + minutes };
}

/**
 * The canonical `YYYY-MM-DD` spelling of a real calendar date, or null if the
 * value names no such date. `'2026-8-17'` normalises; `'2026-02-30'` does not.
 */
export function normaliseCalendarDate(value: unknown): string | null {
  return canonicalCalendarDate(value)?.canonical ?? null;
}

/**
 * The canonical `HH:MM` spelling of a real wall-clock time, or null if the
 * value names no such time. `'7:30'` normalises; `'25:00'` and `''` do not.
 */
export function normaliseTimeOfDay(value: unknown): string | null {
  return canonicalTimeOfDay(value)?.canonical ?? null;
}

/** True only for a value already written in the canonical form, and real. */
export function isCalendarDate(value: unknown): value is string {
  return normaliseCalendarDate(value) === value;
}

/** True only for a value already written in the canonical form, and real. */
export function isTimeOfDay(value: unknown): value is string {
  return normaliseTimeOfDay(value) === value;
}

/**
 * Milliseconds since the epoch at UTC midnight on that calendar date, or null.
 * UTC throughout: `date` is a local calendar date, not a timestamp, so the
 * only thing this is ever used for is subtracting one date from another to
 * count whole days between them — a job any fixed zone does correctly and the
 * device's own zone does not, since divers change time zones constantly
 * (DESIGN.md §7).
 */
export function calendarDateToUtcMs(value: unknown): number | null {
  return canonicalCalendarDate(value)?.utcMs ?? null;
}

/** Minutes since midnight, or null if the value names no real time of day. */
export function timeOfDayToMinutes(value: unknown): number | null {
  return canonicalTimeOfDay(value)?.minutes ?? null;
}

/**
 * The write-boundary policy for a stored `date`, applied by `db/dives.ts`.
 * Canonicalises a real date however it was spelled, and otherwise returns the
 * value untouched — never null, since the column is NOT NULL, and never a
 * rejection, per §1.
 *
 * A value this cannot canonicalise still sorts deterministically:
 * `compareDiveOrder` falls back to comparing it as a raw string, which places
 * it where the diver typed it rather than nowhere.
 *
 * Overloaded so a caller holding a `string` gets a `string` back rather than
 * `unknown`. That is not sugar: without it every typed call site needs an
 * `as string`, and such a cast would go on silently satisfying the compiler if
 * the fallback here ever stopped returning the input unchanged.
 */
export function storedCalendarDate(value: string): string;
export function storedCalendarDate(value: unknown): unknown;
export function storedCalendarDate(value: unknown): unknown {
  return normaliseCalendarDate(value) ?? value;
}

/**
 * The write-boundary policy for a stored `timeIn`, applied by `db/dives.ts`.
 *
 * Blank means *no time*, not a time: an untouched TextInput hands back `''`,
 * and an empty string stored as-is used to sort before every real time
 * (`'' < '08:00'`), putting an untimed dive at the head of its day instead of
 * the tail where DESIGN.md §2.5 puts it. Mapping it to null is what the column
 * already means by null, not a discarded value.
 *
 * Anything else that names a real time is canonicalised, and anything that
 * does not is stored unchanged — the diver typed it, so it is not this
 * function's to throw away, and the comparator treats an uninterpretable time
 * as no time rather than mis-sorting it.
 */
export function storedTimeOfDay(value: string | null): string | null;
export function storedTimeOfDay(value: unknown): unknown;
export function storedTimeOfDay(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return normaliseTimeOfDay(value) ?? value;
}

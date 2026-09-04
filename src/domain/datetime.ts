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
function canonicalCalendarDate(
  value: unknown,
): { canonical: string; utcMs: number; year: number; month: number; day: number } | null {
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
  // The three integers come back out alongside the string so `calendarDateToLocalDate`
  // below can build a LOCAL date from them without re-parsing what this function has
  // already parsed — the same one-owner reasoning that put `utcMs` here rather than in a
  // second parser next to `calendarDateToUtcMs`.
  return { canonical, utcMs, year, month, day };
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

/** Milliseconds in one day, used only to turn a difference of two UTC midnights into days. */
const MS_PER_DAY = 86_400_000;

/**
 * **How many whole days apart two calendar dates are**, counted from `from` to `to` — positive
 * when `to` is the later of the two, `0` when they are the same day, negative when `to` is
 * earlier. `null` when either value names no real date, which is the caller's cue to say
 * nothing rather than to show a number it made up.
 *
 * §3's *currency* is what wanted it (M3a: *"days since your last dive"*), and it belongs here
 * rather than beside that figure because §4.1 gives this module **every** reading of a
 * `YYYY-MM-DD` string. Counting days is a reading of two of them.
 *
 * **Both dates go through `calendarDateToUtcMs`, and that is the whole of the correctness.** A
 * calendar date is not an instant, so the difference between two of them has to be measured
 * from somewhere; UTC midnight is a fixed frame, where the device's own zone is not — and a
 * diver changes zone on every trip (§7). It is also what makes a DST transition invisible: a
 * local day is 23 or 25 hours twice a year, and 25 hours over `MS_PER_DAY` floors to one day
 * only by luck. The subtraction here is exact whole days by construction, which is why it needs
 * no rounding at all.
 *
 * An impossible date that `Date.parse` would silently roll forward — `'2026-02-30'` — is
 * refused rather than counted two days late, because `canonicalCalendarDate` refuses it
 * (`normaliseCalendarDate`'s own rule). That is the same refuse-rather-than-guess stance
 * `surfaceIntervalMin` (domain/derived.ts) and `carryOverDate` (domain/carryOver.ts) already
 * take about a date they cannot read.
 *
 * **`carryOverDate` does this same subtraction inline and predates this function** (§2.1's
 * today-or-yesterday window, which compares `todayMs - previousMs` against its own `DAY_MS`).
 * It is not converted here only because that file was owned by another task in the milestone
 * that added this; it is the same rule and should read this instead — recorded rather than
 * left for someone to rediscover as two copies (§4.1).
 */
export function daysBetweenCalendarDates(from: unknown, to: unknown): number | null {
  const fromMs = calendarDateToUtcMs(from);
  const toMs = calendarDateToUtcMs(to);
  if (fromMs === null || toMs === null) return null;
  return (toMs - fromMs) / MS_PER_DAY;
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

/**
 * ---------------------------------------------------------------------------
 * THE LOCAL-CALENDAR BOUNDARY (M1d) — a JS `Date` in, this module's strings out, and back.
 *
 * Named for the picker it was written for, but it is not only the picker's: `todayCalendarDate`
 * below answers "what day is it where the diver is", which is the same conversion asked
 * without a `Date` to convert, and it lives here for exactly that reason.
 *
 * DESIGN.md §10: "the stored form is still the `YYYY-MM-DD` / `HH:MM` string —
 * `domain/datetime.ts` remains its only owner, and the `Date` the picker returns is
 * converted there from LOCAL components, never `toISOString()`."
 *
 * Every function below reads or writes `getFullYear()`/`getMonth()`/`getDate()` and
 * `getHours()`/`getMinutes()` — the calendar the diver is actually looking at — and none of
 * them goes near `toISOString()` or `new Date('2026-08-31')`, both of which are UTC:
 *
 *   - `toISOString()` on a picked date stores the UTC day. East of Greenwich a local
 *     midnight is still yesterday in UTC, so a dive picked for 31 Aug is logged as the 30th.
 *   - `new Date('2026-08-31')` parses as UTC midnight, which is 31 Dec-style *previous* day
 *     west of Greenwich, so a picker seeded that way opens on the day before the stored one.
 *
 * Both are the same defect this codebase has now hit three times (`formatDiveDate`'s own
 * docblock, `carryOverDate`'s, and this block). They are correct in UTC and wrong
 * everywhere else, which is exactly why they survive an ordinary test suite —
 * `datetime.utc-plus-14.test.ts` and `datetime.utc-minus-11.test.ts` force a zone on either
 * side of Greenwich so that a naive spelling reddens instead of passing.
 *
 * Nothing here invents a value: every function returns null rather than a guess when it is
 * handed something that is not a real moment (a dismissed picker's `undefined`, an invalid
 * `Date`) or not a real date/time string, and the caller decides what "not set" looks like.
 * `todayCalendarDate` is the one exception and says why on itself — "no answer" is not a
 * thing a caller asking what today is can do anything with.
 * ---------------------------------------------------------------------------
 */

/**
 * The one guard the two `localDateTo*` functions share. A picker's `onChange` is typed
 * `(event, date?: Date)`, so `undefined` is its ordinary dismissed-without-choosing value,
 * and an invalid `Date` reads back as `NaN` from every getter — which a template string
 * would happily spell as `'NaN-NaN-NaN'`, a value that looks like a date all the way into
 * the database.
 */
function realDate(value: unknown): Date | null {
  if (!(value instanceof Date)) return null;
  return Number.isFinite(value.getTime()) ? value : null;
}

/**
 * The canonical `YYYY-MM-DD` of the day a `Date` falls on **in the device's own zone**, or
 * null if it is not a real moment. This is what a date picker's chosen value is stored as.
 */
export function localDateToCalendarDate(value: unknown): string | null {
  const date = realDate(value);
  if (date === null) return null;
  // Built and then re-read through this module's own parser rather than returned directly:
  // that is what guarantees the result is a spelling `isCalendarDate` accepts, and it is
  // the same reason `storedCalendarDate` routes through `normaliseCalendarDate` instead of
  // trusting its input. A year outside 1000-9999 has no canonical spelling here and comes
  // back null rather than as a string the rest of the app would then refuse.
  return normaliseCalendarDate(
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`,
  );
}

/**
 * Only reachable from `todayCalendarDate` below when the device's own clock reads a year
 * `YYYY-MM-DD` has no room for — `localDateToCalendarDate` refuses years outside 1000-9999,
 * and no clock an app can run on is there. Named rather than inlined so the branch that
 * returns it is obviously the impossible one.
 */
const UNSPELLABLE_CLOCK_DAY = '1970-01-01';

/**
 * Today's date on the device's own calendar, canonical `YYYY-MM-DD` — the answer to "what
 * day is it where the diver is", as opposed to `localDateToCalendarDate`, which answers
 * "what day does this particular moment fall on".
 *
 * This exists because the obvious spelling, `new Date().toISOString().slice(0, 10)`, is the
 * UTC day, and it was written out twice — once for the dive form's default date and once
 * for `carryOverDate`'s "otherwise today" — where a diver in Prague logging a night dive at
 * 00:30 got yesterday's date, twice over. `toISOString` is right for an `updated_at`
 * timestamp (`db/dives.ts`) and wrong for a calendar day, and the difference is not visible
 * in a UTC test run, which is why it survived. There is one owner of the conversion now and
 * every caller goes through it.
 *
 * **`now` is injectable and never trusted.** `carryOverDate` passes its own injected clock
 * so the 48-hour rule stays testable without mocking `Date`. A value that names no real
 * moment — an invalid `Date`, or anything that is not a `Date` at all — falls back to the
 * real current time rather than returning null or throwing: unlike everywhere else in this
 * module, where null means "the diver's value could not be read and the caller decides what
 * to show", a caller asking what today is always needs a real answer, and a broken injected
 * clock is a test artefact rather than something a diver typed. Refusing would only push
 * an invented date into the caller.
 *
 * The conversion itself is not repeated here, and neither is the check for what counts as a
 * real moment: both are `localDateToCalendarDate`'s, which reads local calendar components
 * and rejects a `NaN` time through `realDate`. A second copy of either is the exact defect
 * this function was added to close.
 */
export function todayCalendarDate(now: Date = new Date()): string {
  return localDateToCalendarDate(now) ?? localDateToCalendarDate(new Date()) ?? UNSPELLABLE_CLOCK_DAY;
}

/**
 * The canonical `HH:MM` a `Date` reads as on **the device's own wall clock**, or null if it
 * is not a real moment. This is what a time picker's chosen value is stored as.
 */
export function localDateToTimeOfDay(value: unknown): string | null {
  const date = realDate(value);
  if (date === null) return null;
  return normaliseTimeOfDay(`${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}`);
}

/**
 * Local midnight on a stored calendar date — what a date picker is *seeded* with so it
 * opens on the day already recorded. Null when the value names no real date, which is the
 * caller's cue to open the picker on today instead of on an invented day.
 */
export function calendarDateToLocalDate(value: unknown): Date | null {
  const parsed = canonicalCalendarDate(value);
  if (parsed === null) return null;
  const date = new Date(parsed.year, parsed.month - 1, parsed.day);
  // `new Date(99, 0, 1)` is 1999, not the year 99 — the constructor's legacy two-digit-year
  // mapping, which applies to every year under 100. `setFullYear` is the documented way out
  // of it, and this is not purely theoretical: `'0099-01-01'` is a spelling this module's
  // own parser accepts, so a row carrying one must open the picker in its own century.
  date.setFullYear(parsed.year);
  return date;
}

/**
 * A stored `HH:MM` as a real moment on `base`'s own day — what a time picker is *seeded*
 * with. Null when the value names no real time, which is the caller's cue to open the
 * picker on the current time rather than on an invented one.
 *
 * **`base` must be the dive's own date, and a caller that leaves it out is asking for
 * today's.** Its date half never reaches storage — `localDateToTimeOfDay` above reads only
 * the clock back off it — but that does not make it arbitrary, because a wall-clock time is
 * not a fact independent of the day it falls on. `new Date(y, m, d, 2, 30)` on a
 * spring-forward date is 03:30: 02:30 did not happen that day, so the constructor
 * normalises past the gap, and the picker then opens on 03:30 over a stored 02:30. On
 * Android confirming that picker without touching it writes 03:30 back, and a dive's entry
 * time is silently moved an hour.
 *
 * Seeded from `new Date()` — which is what this used to do at every call site
 * (`DateTimeField.tsx` passed no base) — the day being asked about is TODAY, so the dive
 * whose time gets rewritten is not the one on the transition date but any dive edited ON
 * one: two Sundays a year, every dive in the logbook has a 02:30 that reads as 03:30. Seeded
 * from the dive's own date the case shrinks to what it actually is — a dive that claims a
 * time its own day did not have, which is a value no clock ever showed and which this
 * function cannot invent an answer for.
 *
 * The default remains for callers that genuinely have no date to offer, and because
 * `carryOverFrom`'s `now` is injectable for the same testability reason.
 */
export function timeOfDayToLocalDate(value: unknown, base: Date = new Date()): Date | null {
  const minutes = timeOfDayToMinutes(value);
  if (minutes === null) return null;
  const day = realDate(base) ?? new Date();
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
}

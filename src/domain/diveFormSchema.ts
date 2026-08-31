import { z } from 'zod';
import { isCalendarDate } from './datetime';
import type { Dive, DiveStatus, Tank } from './types';

/**
 * A comma read as the decimal point it is on this form.
 *
 * **This is deliberately not a locale-aware parser, and must not become one.**
 * A locale parser has to decide whether `1,234` is one thousand two hundred
 * and thirty-four or one point two three four, and it decides it from a
 * locale tag that has nothing to do with which key the diver actually
 * pressed. Here the question does not arise: no value this form takes needs a
 * thousands separator — depth, average depth, duration, visibility, water and
 * air temperature, pressures, cylinder size, count, gas percentages, weights,
 * rating and the 0-3 condition scales are every one of them far below 1000 in
 * the SI unit DESIGN.md §6 stores (latitude and longitude are bounded by ±180)
 * — and `decimal-pad`, the only keyboard this form gives a numeric field
 * (`FormField.tsx`), offers no grouping key at all. So a comma in one of
 * these fields can only ever be a decimal point, and reading it as one is
 * unambiguous rather than a guess.
 *
 * Applied to every comma, not just the first, purely so the failure is
 * consistent: `'1,2,3'` names no number either way and comes back `NaN`,
 * which the transform below maps to `null`.
 */
function normaliseDecimalSeparator(value: string): string {
  return value.replace(/,/g, '.');
}

/**
 * The coercion contract (DESIGN.md §10, derived.ts's COERCION CONTRACT block).
 *
 * An empty numeric field must reach the domain as null — never 0. `derived.ts`
 * treats 0 as *contradictory* data for sizeL and count and voids the whole
 * dive's gas figure, where absent data merely skips that cylinder. A bare
 * `z.coerce.number()` would do exactly the wrong thing, because
 * `Number('') === 0`.
 *
 * This is the one helper every optional numeric field in this schema goes
 * through — depths, duration, temperatures, visibility, weights, pressures,
 * cylinder size, count, gas percentages — so the rule exists in exactly one
 * place. It also has to accept an already-numeric input, not just a string:
 * carry-over prefill (`carryOverFrom`, M1d task 3) hands the form a real
 * number as a default value, and react-hook-form only turns it into a string
 * once the diver's `TextInput` re-renders it — so this schema is what both
 * `DiveFormValues` (the parsed output type) and the raw, pre-parse form state
 * are built from.
 *
 * `.default(null)`, not `.optional()`: Zod only treats a key as safe to omit
 * from the input when the field schema is itself declared optional/defaulted
 * — a union that merely accepts `undefined` as one of its members is not
 * enough, so a form object that never mentions `maxDepthM` at all would
 * otherwise fail with "expected nonoptional, received undefined" before this
 * transform ever ran. `.optional()` alone would fix that parse failure but
 * make a genuinely absent field disappear from the output object entirely
 * (an absent key, not a key holding `null`), which breaks the one contract
 * this whole file exists for. `.default(null)` is the one spelling that
 * makes an absent key and a present-but-empty one produce the identical
 * `null` this file's callers can rely on.
 *
 * **A comma is a decimal point here** (`normaliseDecimalSeparator` below), and
 * that is the second half of the same contract: the contract promised "never
 * `0`", and honoured it by mapping `Number('18,4')`'s `NaN` to `null` — which
 * is the correct reading of "this is not a number" and the wrong reading of
 * what the diver did. Every numeric field on this form uses the `decimal-pad`
 * keyboard, and on a Czech, German or French device that keypad's separator
 * key types `,`. Ponor ships `cs` and its first diver is Czech, so `18,4` in
 * Max depth is the ordinary spelling, not an edge case — and it silently
 * saved nothing on entry, while on the edit path it emitted
 * `patch.maxDepthM = null` and **cleared a depth that was already there**.
 */
const optionalNumber = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((raw) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(normaliseDecimalSeparator(trimmed));
    return Number.isFinite(parsed) ? parsed : null;
  })
  .default(null);

/**
 * Free text (title, notes, names, ids). Blank or whitespace-only becomes
 * null, matching the numeric rule's "empty means absent, not a value" —
 * everything else passes through untouched, including its own surrounding
 * whitespace, since this is text a diver is actively typing, not a number
 * this file has any business reformatting. `.default(null)` for the same
 * reason as `optionalNumber` above: a key this form never mentions must
 * still parse, and must still come out as `null`, not a missing key.
 */
const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((raw) => {
    if (raw === null || raw === undefined) return null;
    return raw.trim() === '' ? null : raw;
  })
  .default(null);

/** Optional checkbox/switch field, normalised to null rather than undefined when unset. */
const optionalBoolean = z
  .union([z.boolean(), z.null(), z.undefined()])
  .transform((raw) => raw ?? null)
  .default(null);

/**
 * A picker-backed field restricted to a fixed option set (entry, salinity,
 * water body, suit, cylinder material). `''` is accepted alongside
 * null/undefined as "nothing picked" — some native picker controls report an
 * empty string rather than either of those — and all three collapse to null
 * so a never-touched picker looks the same as a numeric field left blank.
 *
 * Unlike `date`, an out-of-range value here is never something a diver could
 * type — these are taps on a fixed list, not free text — so rejecting one is
 * catching a real bug upstream, not "arguing with a diver on a boat".
 */
function optionalPicked<T extends string>(values: readonly T[]) {
  const literal = values as [T, ...T[]];
  return z
    .union([z.enum(literal), z.literal(''), z.null(), z.undefined()])
    .transform((raw) => (raw === null || raw === undefined || raw === '' ? null : raw))
    .default(null);
}

/**
 * Logged or planned (DESIGN.md §2.4) — the two-state control the form carries in its
 * header row, and deliberately **not** part of §2.2's core strip (date, site, centre,
 * max depth, duration): a dive's status is not one of its measurements.
 *
 * A field of this schema rather than a piece of screen state, and that is the whole
 * mechanism: `toDivePatch` below diffs it exactly as it diffs every other field, so the
 * patch names `status` precisely when the value the diver is looking at differs from the
 * one the dive is stored with, and never otherwise. Editing a planned dive's site name
 * therefore leaves it planned, while flipping the control to Logged *is* completing it —
 * one control doing both jobs, with no second rule anywhere else deciding what an edit
 * means. (There was one, keyed on the stored status inside `DiveFormScreen`, and it
 * silently logged any planned dive whose typo a diver came back to fix.)
 *
 * `'logged'` is the default and the only default: §2.4 plans are the exception, so a form
 * that never mentions status is logging a dive. null and undefined collapse to it for the
 * same "an absent key and a present-but-empty one must mean the same thing" reason
 * `optionalNumber` above gives — except that the shared meaning here is `'logged'` rather
 * than `null`, because `status` is one of the three columns DESIGN.md §6 makes
 * non-nullable. A value outside the two is still refused, exactly as `optionalPicked`
 * refuses one and for the same reason: these are taps on a two-state control, never
 * something a diver could type, so rejecting one catches a real bug upstream.
 */
const optionalStatus = z
  .union([z.enum(['logged', 'planned']), z.null(), z.undefined()])
  .transform((raw): DiveStatus => raw ?? 'logged')
  .default('logged');

/**
 * One cylinder's form fields. Every field goes through the same
 * absent-vs-typed rule as the rest of the form — see `optionalNumber` above —
 * so a blank size or count reaches `derived.ts` as null (that cylinder is
 * skipped) rather than 0 (the whole dive's gas figure would be voided).
 */
const tankFormSchema = z.object({
  material: optionalPicked(['steel', 'alu'] as const),
  sizeL: optionalNumber,
  count: optionalNumber,
  workingBar: optionalNumber,
  o2Pct: optionalNumber,
  hePct: optionalNumber,
  startBar: optionalNumber,
  endBar: optionalNumber,
});

/**
 * Every key one cylinder has, read off `tankFormSchema` itself rather than typed out a
 * second time — the same "no hand-maintained second list" rule `carryOver.ts`'s
 * `FRESH_FIELDS` follows, and what keeps `toDivePatch` below comparing a cylinder field
 * that is added later without anyone remembering to come here. The cast is safe because
 * `TankFormFieldsMatchTank` (just below) already proves the two shapes are the same.
 */
const TANK_FIELDS = Object.keys(tankFormSchema.shape) as (keyof Tank)[];

/**
 * Type-level proof that a parsed cylinder has exactly `Tank`'s shape — same
 * reasoning as `Mutual` in `db/dives.ts`: if a field is ever added to `Tank`
 * and this schema is not updated to match, that is a compile error here
 * rather than a field the diver silently has no way to fill in.
 */
type Assert<T extends true> = T;
export type TankFormFieldsMatchTank = Assert<
  (z.infer<typeof tankFormSchema> extends Tank ? true : false) extends true
    ? (Tank extends z.infer<typeof tankFormSchema> ? true : false)
    : false
>;

/**
 * The same proof for the status control's two states: `optionalStatus` above spells them
 * out as a Zod enum, which is the one shape `z.enum` accepts, so this is what keeps that
 * literal list and `DiveStatus` from drifting. A third status added to the domain without
 * being added here would be a compile error rather than a value the form silently has no
 * way to hold — and, worse, one `toDivePatch` would report as a change on every save.
 */
export type StatusFormValuesMatchDive = Assert<
  (z.infer<typeof optionalStatus> extends DiveStatus ? true : false) extends true
    ? (DiveStatus extends z.infer<typeof optionalStatus> ? true : false)
    : false
>;

/**
 * The dive-entry form (DESIGN.md §2.2), over the form's **string** values —
 * `optionalNumber`'s input side also accepts a bare `number` so that
 * carry-over defaults (already-typed values) and diver-typed `TextInput`
 * strings can flow through the same fields. `DiveFormValues` below is this
 * schema's *output* type: every field a real, already-coerced value or null,
 * exactly like `Dive` itself.
 *
 * `date` is the only required field (§2.2) and the only one whose format is
 * enforced here: `isCalendarDate` is the single owner of what a valid date
 * string is (`domain/datetime.ts`), so this schema does not re-implement that
 * check, only calls it. Every other field accepts anything that survives
 * `optionalNumber`/`optionalText` — including a negative depth or an
 * out-of-range rating — because §1 never lets validation refuse a save; the
 * one thing this app insists on is that a dive have a real date.
 *
 * `timeIn` is deliberately just `optionalText`, not format-checked against
 * `isTimeOfDay` here: `storedTimeOfDay` (the write boundary in `db/dives.ts`)
 * already owns canonicalising a leniently-spelled time and passing through
 * one it cannot parse, exactly as the diver typed it, per §1 — checking it a
 * second time here would either duplicate that ownership or (if it rejected)
 * block a save over a field that was never the one required one.
 */
export const diveFormSchema = z.object({
  // The header-row control (§2.4), not a core-strip field — see `optionalStatus` above.
  status: optionalStatus,

  // Core strip (§2.2) — always visible.
  date: z.string().refine(isCalendarDate, { message: 'Enter a real date (YYYY-MM-DD).' }),
  siteId: optionalText,
  siteName: optionalText,
  centerId: optionalText,
  centerName: optionalText,
  maxDepthM: optionalNumber,
  durationMin: optionalNumber,

  // Times & depth.
  timeIn: optionalText,
  avgDepthM: optionalNumber,

  // Conditions.
  waterTempC: optionalNumber,
  airTempC: optionalNumber,
  visibilityM: optionalNumber,
  waves: optionalNumber,
  current: optionalNumber,
  surge: optionalNumber,
  entry: optionalPicked(['shore', 'boat', 'other'] as const),
  salinity: optionalPicked(['salt', 'fresh', 'brackish'] as const),
  waterBody: optionalPicked(['ocean', 'lake', 'river', 'quarry', 'cave', 'pool'] as const),
  latitude: optionalNumber,
  longitude: optionalNumber,

  // Gas & cylinders. Defaults to [] rather than null: `tanks` is the one
  // Dive field that is never nullable (DESIGN.md §6) — an empty array
  // already means "no cylinders recorded".
  tanks: z.array(tankFormSchema).default([]),

  // Equipment.
  suit: optionalPicked(['none', 'shorty', 'wet', 'semidry', 'dry'] as const),
  hood: optionalBoolean,
  gloves: optionalBoolean,
  boots: optionalBoolean,
  weightsKg: optionalNumber,

  // People.
  buddy: optionalText,
  guide: optionalText,

  // Notes & rating.
  title: optionalText,
  notes: optionalText,
  rating: optionalNumber,
});

export type DiveFormValues = z.infer<typeof diveFormSchema>;

/**
 * The single place form values become a domain object, for `createDive`
 * (`db/dives.ts`). Deliberately typed from `Dive` alone rather than
 * importing `db/dives.ts`'s `NewDiveInput`: `domain/` is the lower layer and
 * `db/` already depends on it, so a `db` import here would run that
 * dependency backwards. The shape below is structurally the same thing
 * `NewDiveInput` names (every field but the four the database owns:
 * `id`/`createdAt`/`updatedAt`/`deletedAt` — this schema has no field for
 * any of them, so they can never appear in the result), which is what makes
 * a call like `createDive(db, toNewDiveInput(values))` typecheck at the call
 * site without this file needing to know that type exists.
 *
 * Fields the diver left empty are omitted here rather than carried through
 * as explicit nulls, so a freshly logged dive that is mostly blank does not
 * turn into a wall of `field: null` — and so this stays compatible with
 * `db/dives.ts`'s wider "a carried undefined means don't touch, null means
 * clear this field" contract, even though creation has nothing yet to not
 * touch. `date` and `tanks` are the two fields every parsed `DiveFormValues`
 * always carries a real value for — required and defaulted respectively —
 * so they are set unconditionally rather than passing through the same
 * null-check as everything else.
 *
 * `status` needs no such exemption and gets none: it is never `null` either
 * (§2.4's control always holds one of its two states), so the loop below copies
 * it every time and a created dive states plainly which one it is, rather than
 * leaning on `createDive`'s own `?? 'logged'` fallback to fill the gap.
 */
export function toNewDiveInput(values: DiveFormValues): Partial<Dive> & Pick<Dive, 'date'> {
  const { date, tanks, ...rest } = values;
  const input: Partial<Dive> & Pick<Dive, 'date'> = { date, tanks };
  for (const [key, value] of Object.entries(rest) as [keyof typeof rest, (typeof rest)[keyof typeof rest]][]) {
    if (value !== null) {
      (input as Record<string, unknown>)[key] = value;
    }
  }
  return input;
}

/**
 * Whether a cylinder records anything at all.
 *
 * `[]` and `[{ every field null }]` are the same claim — "no cylinders recorded"
 * (DESIGN.md §6) — and the form shows exactly one cylinder whether or not the dive it is
 * editing has one, so an untouched cylinder group must not read as an edit in either
 * direction: not "the diver added a blank cylinder" for a dive stored with `[]`, and not
 * "the diver removed one" for a dive stored with a blank one (which is what `createDive`
 * writes today for a form whose Gas & cylinders group was never opened). `toDivePatch`
 * therefore normalises BOTH sides with this before comparing them.
 */
function isRecordedTank(tank: Tank): boolean {
  return TANK_FIELDS.some((field) => tank[field] !== null);
}

/** Field-by-field equality over `TANK_FIELDS` — never `JSON.stringify`, which would also
 * compare key ORDER and so report a stored blob and a freshly parsed cylinder as different
 * purely because the two were built in different orders. */
function sameTanks(before: readonly Tank[], after: readonly Tank[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((tank, index) => {
    const other = after[index];
    return other !== undefined && TANK_FIELDS.every((field) => Object.is(tank[field], other[field]));
  });
}

/**
 * The **changed** half of a dive-entry form, for `updateDive` (`db/dives.ts`) — the
 * editing counterpart of `toNewDiveInput` above, and typed from `Dive` alone for the same
 * layering reason that function's own docblock gives: `domain/` is the lower layer, so the
 * shape returned here is structurally what `db/dives.ts` calls `DivePatch` without this
 * file having to know that type exists.
 *
 * The repository's contract is the entire point of the diff: **a field the patch does not
 * mention is left untouched; a field it carries as `null` is cleared.** Those are two
 * different instructions, and only a comparison against the stored dive can tell them
 * apart. Sending every field instead would overwrite whatever a field the diver never
 * opened happens to hold — and would do it while advancing `updated_at`, so under §7's
 * whole-row last-write-wins the device that changed nothing beats the device that changed
 * something. Sending nothing for an emptied field is the opposite failure: the diver
 * deletes a value, the app says "saved", and the old value is still there.
 *
 * **`status` goes through that same diff, and through nothing else.** It is a form field
 * now (`optionalStatus` above), so completing a planned dive (§2.4) is simply the case
 * where the control the diver was looking at says `logged` and the stored dive says
 * `planned` — a change like any other, named in the patch for the same reason a changed
 * depth is. It is emphatically NOT inferred from the stored status: a caller that added
 * `patch.status = 'logged'` whenever the dive was planned would complete a dive whose
 * site name the diver only came back to correct, which is the bug this replaced.
 */
export function toDivePatch(
  original: Dive,
  values: DiveFormValues,
): Partial<Omit<Dive, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'manualOrder'>> {
  const patch: Record<string, unknown> = {};
  const { tanks, ...rest } = values;
  const before = original as unknown as Record<string, unknown>;

  for (const key of Object.keys(rest) as (keyof typeof rest)[]) {
    // `Object.is`, not `===`: identical semantics for every value this schema can produce
    // (strings, finite numbers, booleans, null) and no `NaN !== NaN` surprise if one ever
    // slips through, which would otherwise report an unchanged field as changed on every
    // single save.
    if (!Object.is(rest[key], before[key])) patch[key] = rest[key];
  }

  const nextTanks = tanks.filter(isRecordedTank);
  const currentTanks = original.tanks.filter(isRecordedTank);
  if (!sameTanks(currentTanks, nextTanks)) patch.tanks = nextTanks;

  return patch;
}

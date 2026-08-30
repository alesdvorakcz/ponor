import { z } from 'zod';
import { isCalendarDate } from './datetime';
import type { Dive, Tank } from './types';

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
 */
const optionalNumber = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((raw) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
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

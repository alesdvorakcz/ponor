import { z } from 'zod';
import {
  displayValueFor,
  diveFieldQuantity,
  storedValueFor,
  tankFieldQuantity,
  type Quantity,
  type UnitSystem,
} from '../format/units';
import { isCalendarDate } from './datetime';
import {
  ENTRY_VALUES,
  SALINITY_VALUES,
  SUIT_VALUES,
  TANK_MATERIAL_VALUES,
  WATER_BODY_VALUES,
  type Dive,
  type DiveStatus,
  type Tank,
} from './types';

/**
 * A comma read as the decimal point it is on this form.
 *
 * **This is deliberately not a locale-aware parser, and must not become one.**
 * A locale parser has to decide whether `1,234` is one thousand two hundred
 * and thirty-four or one point two three four, and it decides it from a
 * locale tag that has nothing to do with which key the diver actually
 * pressed. Here the question does not arise: no value this form takes needs a
 * thousands separator, and no keyboard it offers can even produce one.
 * `decimal-pad` and `number-pad` (`FormField.tsx`) have no grouping key at
 * all, so a comma reaching this function came from the decimal key on a
 * Czech, German or French device and can only have meant a decimal point.
 *
 * The magnitudes back that up rather than carrying it. Every figure this form
 * takes is under a thousand in the SI unit DESIGN.md §6 stores — depth,
 * duration, visibility, temperatures, pressures, cylinder size, count, gas
 * percentages, weights, rating and the 0-3 scales, with latitude and longitude
 * bounded by ±180 — **with one exception since §3's unit setting landed: a
 * cylinder pressure typed in psi is in the thousands** (a 232 bar cylinder is
 * 3365 psi). That does not weaken the rule, because the keyboard argument
 * above never depended on the size of the number; it is recorded here because
 * this docblock used to claim "far below 1000" of every field without
 * exception, and that sentence is no longer true.
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
 * The coercion contract read from the other end: what a stored or seeded value looks like in
 * a field the diver types into. Always a string, because `FormField`'s `value` is one —
 * that component's own docblock states why ("this component never has to hold or format a
 * `number | null` itself") and leaves the bridge to whoever wires it up.
 *
 * **Here, because there are two who wire it up.** The dive form's `Controller` render props
 * and §3's cylinder-preset editor both bridge a nullable form value to that string, and a
 * second copy is free to disagree — `String(null)` is the text `"null"`, which is what a
 * field would then show a diver in place of an empty box. It sits beside `optionalNumber`
 * and `optionalText` above deliberately: those two turn `''` back into `null` at the write
 * boundary, so this is the same rule's other direction and the pair has to stay honest.
 *
 * `unknown` rather than a narrower type: react-hook-form's `field.value` is typed by path
 * and a preset editor holds raw `TankFormInput` fields, which may already be strings — both
 * arrive here, and neither needs a cast to do so.
 */
export function toInputString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * A numeric field that counts things rather than measuring them — today the
 * cylinder `count` (DESIGN.md §6: "count (twinset = 2)") and nothing else.
 *
 * Everything `optionalNumber` above does, then rounded. A fractional count is
 * not merely odd, it is *contradictory* in `derived.ts`'s sense: `countGas`
 * classifies a non-integer count exactly as it classifies a zero or negative
 * one, and a contradictory field on any cylinder voids **the whole dive's** gas
 * figure rather than skipping that cylinder. So 1.5 cylinders costs a diver
 * their RMV and gas-used figures with nothing on screen to say why — the same
 * silent-blanking failure the coercion contract above exists to prevent,
 * arriving through a different door. The form asks for a whole-number keypad
 * (`DiveFormScreen.tsx`), which is what stops a diver typing one; this is what
 * stops carry-over, an M2 sync row, or a device whose keypad offers a separator
 * anyway from doing it behind the keypad's back.
 *
 * Rounds rather than rejects, per §1 and on the same reasoning DESIGN.md §10
 * records for `manual_order`: a value moved half a place is a far better trade
 * than a save turned away.
 */
const wholeNumber = optionalNumber.transform((value) =>
  // `Math.round(-0.4)` is `-0`, which `Object.is` reports as different from `0`
  // — enough on its own to make `toDivePatch` write a "change" on every save of
  // a dive whose count JSON round-tripped through `JSON.stringify`, which
  // spells both as `0`.
  value === null ? null : Math.round(value) + 0,
);

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

/**
 * What a diver reads next to a yes/no field holding something that is not one, and next to a
 * fixed-choice field holding a value this client has never heard of.
 *
 * **They are notes, not refusals** (DESIGN.md §10, settled after M1d): "a value outside the
 * expected range is saved and can be flagged; it is not refused", and §1 binds the form as
 * hard as it binds the database. These two fields used to reject such a value, which
 * `handleSubmit` turns into a refusal to call `onValid` for the WHOLE form — so a diver who
 * opened a dive to fix a typo in its notes found a Save button that did nothing, over a
 * value they never entered and cannot see. A row written by a newer client, arriving through
 * M2 sync and then through carry-over, is the live source.
 *
 * Both say the same three things: where the value came from, that it is kept, and what to do
 * about it. "Kept" is the half that makes the note honest rather than alarming — nothing is
 * dropped and nothing is silently rewritten.
 */
export const UNKNOWN_OPTION_NOTE =
  'This value came from a newer version of Ponor. It is saved as it is — pick one of the options to replace it.';
export const UNKNOWN_BOOLEAN_NOTE =
  'This value came from a newer version of Ponor. It is saved as it is — this is a yes/no field, so tap it to replace it.';

/**
 * The note for one fixed-choice field's current value, or `undefined` when there is nothing
 * to say — which is every value this form's own chips can produce, plus "nothing picked".
 *
 * A plain function rather than a Zod issue, and that is the whole point: Zod has one verdict
 * per value and it is accept-or-reject, while §10 asks for a third answer — accepted, kept,
 * and flagged. The schema does the accepting; this does the flagging; `DiveFormScreen`'s
 * `FieldNote` shows it in the same place a blocking message would have appeared.
 */
export function unknownOptionNote<T extends string>(options: readonly T[], value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return (options as readonly unknown[]).includes(value) ? undefined : UNKNOWN_OPTION_NOTE;
}

/** The same, for hood/gloves/boots. */
export function unknownBooleanNote(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value === 'boolean') return undefined;
  return UNKNOWN_BOOLEAN_NOTE;
}

/**
 * Optional checkbox/switch field, normalised to null rather than undefined when unset.
 *
 * **It refuses nothing** (§1, §10 — see `UNKNOWN_BOOLEAN_NOTE` above). Anything that is not
 * `null`/`undefined` passes through exactly as it arrived, so a value this client cannot
 * represent survives the round trip instead of blocking the save or being quietly dropped;
 * `unknownBooleanNote` is what tells the diver it is there.
 *
 * The cast is the same one `db/dives.ts`'s `toDive` already makes and for the same reason:
 * the type is a label on what this client can produce, not a runtime guarantee about what
 * the network delivers. Typing it as `unknown` instead would push that cast out to every
 * reader of a `Dive`, which is the opposite trade — DESIGN.md §10 makes exactly this call
 * for `rating` and the 0-3 scales.
 */
const optionalBoolean = z
  .unknown()
  .transform((raw) => (raw === null || raw === undefined ? null : (raw as boolean)))
  .default(null);

/**
 * A picker-backed field restricted to a fixed option set (entry, salinity,
 * water body, suit, cylinder material). `''` is accepted alongside
 * null/undefined as "nothing picked" — some native picker controls report an
 * empty string rather than either of those — and all three collapse to null
 * so a never-touched picker looks the same as a numeric field left blank.
 *
 * **A value outside the list is kept, not refused** (§1, §10 — see `UNKNOWN_OPTION_NOTE`
 * above). It is still never something a diver could type: these are taps on a fixed list.
 * But rejecting one made `handleSubmit` refuse to call `onValid` for the whole form, so an
 * `entry` written by a newer client — delivered by M2 sync, and carried into a fresh dive by
 * carry-over — turned Save into a dead button on a dive the diver had opened to change
 * something else entirely. It passes through exactly as it arrived, and
 * `unknownOptionNote` flags it beside the chips.
 *
 * `values` is still read, and still matters: it is what makes a KNOWN value parse as the
 * union's own enum member rather than as a bare string, and it is what
 * `unknownOptionNote` compares against. The cast on the way out is the one `db/dives.ts`'s
 * `toDive` already makes for the same reason — the domain type says what this client can
 * produce, not what the network delivers.
 *
 * **Every caller passes one of `domain/types.ts`'s own `*_VALUES` arrays**, never a
 * literal list written out here. Those arrays are what the matching union types are
 * derived FROM, so a member added to `Entry` reaches this schema and the form's chips
 * by construction. Same rule `TankFormFieldsMatchTank` and `StatusFormValuesMatchDive` below
 * enforce for the two shapes that genuinely do have to exist twice.
 */
function optionalPicked<T extends string>(values: readonly T[]) {
  const literal = values as [T, ...T[]];
  return z
    .union([z.enum(literal), z.literal(''), z.null(), z.undefined(), z.unknown()])
    .transform((raw) => (raw === null || raw === undefined || raw === '' ? null : (raw as T)))
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
  material: optionalPicked(TANK_MATERIAL_VALUES),
  sizeL: optionalNumber,
  // The one field on this form that counts rather than measures — see `wholeNumber`.
  count: wholeNumber,
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
 *
 * **Exported for the dive form's preset row**, which needs the typed key list to build the
 * `tanks.<n>.<field>` paths it drops `carried` marks on after applying a preset — the same
 * "no hand-maintained second list" rule, one call site over. Typed as `(keyof Tank)[]` and
 * not `string[]`, which is what makes those paths a `FieldPath` without a cast.
 */
export const TANK_FIELDS = Object.keys(tankFormSchema.shape) as (keyof Tank)[];

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
  entry: optionalPicked(ENTRY_VALUES),
  salinity: optionalPicked(SALINITY_VALUES),
  waterBody: optionalPicked(WATER_BODY_VALUES),
  latitude: optionalNumber,
  longitude: optionalNumber,

  // Gas & cylinders. Defaults to [] rather than null: `tanks` is the one
  // Dive field that is never nullable (DESIGN.md §6) — an empty array
  // already means "no cylinders recorded".
  tanks: z.array(tankFormSchema).default([]),

  // Equipment.
  suit: optionalPicked(SUIT_VALUES),
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
 * The form's own **input** shape — every numeric/text field as the raw string (or
 * already-typed value) a `TextInput`/carry-over default can hold, before
 * `zodResolver(diveFormSchema)` coerces it — as opposed to `DiveFormValues` above, this
 * schema's *output* type of real numbers and nulls. The docblock on the schema itself
 * draws exactly this line: "this schema... over the form's **string** values." Derived
 * with `z.input<>` rather than hand-typed, so it cannot drift from the schema the moment
 * a field is added.
 *
 * It lived in `DiveFormScreen.tsx` until `toDisplayUnits` below needed to name it too;
 * declaring a schema's input type beside its output type is where it belonged anyway.
 */
export type DiveFormInput = z.input<typeof diveFormSchema>;

/** One cylinder as the form holds it, before coercion — see `DiveFormInput`. */
export type TankFormInput = NonNullable<DiveFormInput['tanks']>[number];

/**
 * Type-level proof that every field this form has is also a field a `Dive` has, so the two
 * functions below may look a form field's name up in `format/units.ts`'s exhaustive
 * `Dive`-keyed quantity map — and so `DiveFormScreen`'s `diveToFormValues` may copy a
 * dive's values across by name. A field added to the schema above that `Dive` does not
 * carry is a compile error here rather than a field that silently converts as nothing (or
 * silently seeds as `undefined`).
 *
 * Declared here rather than at either call site because this is where both types are
 * defined; it used to live in `DiveFormScreen.tsx` alone, guarding only one of the two
 * casts that rest on it.
 */
export type FormFieldsExistOnDive = Assert<keyof DiveFormValues extends keyof Dive ? true : false>;

/**
 * One form figure back in the SI the database stores, or the value unchanged when the
 * field measures nothing §3 gives a pair for (`durationMin`, `rating`, a gas percentage,
 * a latitude...) or is not a number at all (a site name, a status, a boolean).
 *
 * `stored` is the value the dive being edited already holds for this field, and it is what
 * lets an untouched field come back bit-for-bit — see `storedValueFor` (format/units.ts)
 * for why converting `81 ft` straight back to metres on every save would quietly
 * re-quantise a dive's stored depth. `undefined` for a dive that does not exist yet.
 */
function storedFieldValue(
  quantity: Quantity | null,
  value: unknown,
  stored: unknown,
  units: UnitSystem,
): unknown {
  if (quantity === null || typeof value !== 'number') return value;
  return storedValueFor(quantity, value, typeof stored === 'number' ? stored : null, units);
}

/**
 * One cylinder's figures back in SI, paired against the cylinder that currently sits at the
 * same index of the stored dive (`undefined` when there is none).
 *
 * Index-wise, because that is already how `sameTanks` below compares the two arrays: the
 * form binds `tanks.0.*` and the array is positional, so cylinder 1 is cylinder 1. A
 * carried-over working pressure the diver never touched therefore stays exactly the number
 * the previous dive recorded, rather than making every second dive of a trip differ from
 * the first by a fraction of a bar.
 */
function toStoredTank(tank: Tank, stored: Tank | undefined, units: UnitSystem): Tank {
  const next = { ...tank } as Record<string, unknown>;
  for (const field of TANK_FIELDS) {
    next[field] = storedFieldValue(tankFieldQuantity(field), tank[field], stored?.[field], units);
  }
  return next as unknown as Tank;
}

/**
 * The form's cylinders as the database stores them: parsed through this file's own coercion
 * contract, then converted to SI. What a **cylinder preset** saves (DESIGN.md §2.1, M1e).
 *
 * **This is the trap this task exists inside, and it is why there is no second conversion.**
 * The form holds what the diver reads — a working pressure of `3365` in a field labelled
 * `psi` — while §6 stores SI and nothing else. `toNewDiveInput` below records the same rule
 * for a whole dive ("`units` is what the diver typed in, and this is where it stops being
 * true of the data"), and an imperial diver's preset silently stored in psi would be that
 * failure with no dive attached to notice it by: it would then be applied to every later
 * dive, converting a psi number a second time on the way in.
 *
 * `units` is required rather than defaulted, for exactly the reason `toNewDiveInput`'s own
 * docblock gives: a defaulted `'metric'` "would let a call site that forgot it write feet
 * into a metres column with nothing failing anywhere".
 *
 * Takes the form's RAW cylinders (`DiveFormInput['tanks']` — strings, as typed) rather than
 * parsed ones, because the only thing a screen can read out of react-hook-form mid-form is
 * the raw values; `toNewDiveInput` gets its parsed by `handleSubmit`, and saving a preset is
 * not a submit. Parsing here is `diveFormSchema`'s own `tanks` field, not a second schema,
 * so `optionalNumber`'s "empty means null, never 0" contract holds identically. A value that
 * is not an array at all cannot be parsed into cylinders and comes back `[]` — which is what
 * the column already means by "no cylinders recorded", and which the form's own
 * empty-cylinder refusal then catches before anything is written.
 *
 * **`stored` is the cylinders these are being saved OVER, and omitting it is a real
 * instruction rather than a default nobody thought about.** Capturing a preset from the dive
 * form is a creation — there is nothing stored to preserve a figure against — so that caller
 * passes none and every recorded figure simply converts, exactly as `toNewDiveInput` does.
 * §3's preset editor is the other case: it seeds its fields from a preset that already
 * exists, so it passes that preset's own cylinders, and an imperial diver who merely opened
 * the editor gets their stored figure back byte-for-byte instead of the 232.00858… that
 * 3365 psi converts to. DESIGN.md §10 is explicit that this is not a nicety — "a display
 * rounding may never rewrite stored data", because the rewrite also advances `updated_at`,
 * and under §7's whole-row last-write-wins the device that changed nothing then beats the
 * device that changed something.
 *
 * Paired **index-wise**, which is the pairing `toDivePatch` and `sameTanks` already use for
 * these arrays: the form binds `tanks.0.*` and the array is positional, so cylinder 1 is
 * cylinder 1. A stored array shorter than the form's simply leaves the extra cylinders with
 * nothing to preserve against, which is the creation case again.
 */
export function toStoredTanks(
  tanks: DiveFormInput['tanks'],
  units: UnitSystem,
  stored?: readonly Tank[],
): Tank[] {
  const parsed = diveFormSchema.shape.tanks.safeParse(tanks);
  return (parsed.success ? parsed.data : []).map((tank, index) => toStoredTank(tank, stored?.[index], units));
}

/**
 * One stored cylinder as the figures a diver working in `units` expects to find in the
 * fields — `toStoredTank`'s mirror, and the cylinder half of `toDisplayUnits` below.
 *
 * Extracted so that applying a **cylinder preset** to the form (DiveFormScreen.tsx) converts
 * through the same code the form's own seeding does. A preset holds SI, the form holds the
 * diver's own numbers, and the conversion between them is one rule: an imperial diver who
 * taps "twin 12 steel" must see `3365` in a field labelled `psi`, not `232`.
 */
export function toDisplayTank(tank: Tank, units: UnitSystem): TankFormInput {
  const converted = { ...tank } as Record<string, unknown>;
  for (const field of TANK_FIELDS) {
    converted[field] = displayFieldValue(tankFieldQuantity(field), converted[field], units);
  }
  return converted as TankFormInput;
}

/**
 * The form's SEED values, converted the other way: a dive's stored SI figures as the
 * numbers a diver working in `units` expects to find in the fields — `24.7` in a metres
 * form, `81` in a feet one.
 *
 * The counterpart of `toNewDiveInput`/`toDivePatch` below, and the reason the form can be
 * said to work in the diver's own units at all: everything between this call and those two
 * — what the box shows, what carry-over marks, what react-hook-form calls dirty, what Zod
 * coerces — sees only the diver's own numbers, and SI exists on either side of it. That is
 * still "converted at display" (§6): the value in the database never leaves SI, and the
 * only thing this changes is what a text field is seeded with.
 *
 * Takes and returns `DiveFormInput` — the seed, not the parsed output — because that is
 * what `blankFormValues()`/`carryOverFrom` produce and what `useForm`'s `values` option
 * takes. Non-numeric fields (a site name, the date, a boolean, a status) pass through
 * untouched, as do the numeric fields §3 gives no pair: `storedFieldValue` and
 * `displayFieldValue` share exactly that rule, one per direction.
 */
export function toDisplayUnits(values: DiveFormInput, units: UnitSystem): DiveFormInput {
  const next = { ...values } as Record<string, unknown>;
  for (const key of Object.keys(diveFormSchema.shape) as (keyof DiveFormValues)[]) {
    if (key === 'tanks') continue;
    next[key] = displayFieldValue(diveFieldQuantity(key), next[key], units);
  }
  // `toDisplayTank` above, not a private loop here: applying a cylinder preset converts the
  // same direction for the same reason, and two copies of "which cylinder field is a
  // pressure" is precisely the drift §4.1 exists to stop. The cast is the same one that loop
  // already made — a raw `TankFormInput` may hold strings, which `displayFieldValue` passes
  // through untouched.
  next.tanks = values.tanks?.map((tank) => toDisplayTank(tank as unknown as Tank, units));
  return next as DiveFormInput;
}

/** `storedFieldValue`'s mirror — see `toDisplayUnits`. */
function displayFieldValue(quantity: Quantity | null, value: unknown, units: UnitSystem): unknown {
  if (quantity === null || typeof value !== 'number') return value;
  return displayValueFor(quantity, value, units);
}

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
 *
 * **`units` is what the diver typed in, and this is where it stops being true of the
 * data.** A `DiveFormValues` holds the figures the diver actually read and typed —
 * `81` in a field labelled `ft` — while §6 stores SI and nothing else, so every
 * unit-bearing field is converted here on its way out. Passed rather than looked up, for
 * the same reason `format/display.ts`'s formatters take it: one place decides, and this
 * stays a pure function. And required rather than defaulted, deliberately: a defaulted
 * `'metric'` would let a call site that forgot it write feet into a metres column with
 * nothing failing anywhere — the silent-wrong-number failure this codebase keeps paying
 * for. Which field converts into what is `format/units.ts`'s exhaustive map, never a list
 * kept here.
 */
export function toNewDiveInput(
  values: DiveFormValues,
  units: UnitSystem,
): Partial<Dive> & Pick<Dive, 'date'> {
  const { date, tanks, ...rest } = values;
  // No stored cylinder to preserve against — nothing is stored yet — so every recorded
  // figure simply converts.
  const input: Partial<Dive> & Pick<Dive, 'date'> = {
    date,
    tanks: tanks.map((tank) => toStoredTank(tank, undefined, units)),
  };
  for (const [key, value] of Object.entries(rest) as [keyof typeof rest, (typeof rest)[keyof typeof rest]][]) {
    if (value !== null) {
      (input as Record<string, unknown>)[key] = storedFieldValue(
        diveFieldQuantity(key),
        value,
        undefined,
        units,
      );
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
 *
 * **Exported for `presetRefusal`** (domain/presets.ts), which asks the same question of the
 * cylinders a preset is about to store — for the dive form's *Save as preset* and §3's editor
 * alike: a preset captured from an untouched cylinder block stores nothing useful, and a chip
 * that fills a dive with nothing is worse than no chip. That caller asks it of the cylinders
 * **after** the pressures are stripped (§10 — a preset keeps none), which is why the question
 * has to be "does this record anything" rather than "did
 * the diver type anything": a block holding nothing but a gauge reading is a full-looking
 * form and an empty preset.
 */
export function isRecordedTank(tank: Tank): boolean {
  return TANK_FIELDS.some((field) => tank[field] !== null);
}

/** Field-by-field equality over `TANK_FIELDS` — never `JSON.stringify`, which would also
 * compare key ORDER and so report a stored blob and a freshly parsed cylinder as different
 * purely because the two were built in different orders.
 *
 * **Exported for `db/gearPresets.ts`**, which asks the identical question for the identical
 * reason: DESIGN.md §7's whole-row last-write-wins is keyed on `updated_at`, so a save that
 * changed no cylinder must not advance it, and "changed no cylinder" is this comparison. A
 * second copy over there would be free to reach for `JSON.stringify` again, which is the
 * exact failure this function's name is a warning about. */
export function sameTanks(before: readonly Tank[], after: readonly Tank[]): boolean {
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
 *
 * **`units` converts each figure back to SI *before* it is compared, and the order is the
 * whole point.** The form holds what the diver read — `81 ft` over a dive stored as
 * 24.6 m — and 81 ft converts to 24.6888 m, so a naive diff would report every
 * unit-bearing field on every imperial dive as changed, on a save that only corrected a
 * buddy's name. `storedValueFor` (format/units.ts) closes that by asking the question that
 * actually matters — does the stored value still *read* as the figure in the box? — and
 * handing back the stored value itself when it does. `Object.is` then sees no change and
 * the patch stays empty, which is exactly right: the diver changed nothing, so nothing is
 * written, `updated_at` does not move, and M2's whole-row last-write-wins has nothing to
 * carry to their other devices.
 */
export function toDivePatch(
  original: Dive,
  values: DiveFormValues,
  units: UnitSystem,
): Partial<Omit<Dive, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'manualOrder'>> {
  const patch: Record<string, unknown> = {};
  const { tanks, ...rest } = values;
  const before = original as unknown as Record<string, unknown>;

  for (const key of Object.keys(rest) as (keyof typeof rest)[]) {
    const next = storedFieldValue(diveFieldQuantity(key), rest[key], before[key], units);
    // `Object.is`, not `===`: identical semantics for every value this schema can produce
    // (strings, finite numbers, booleans, null) and no `NaN !== NaN` surprise if one ever
    // slips through, which would otherwise report an unchanged field as changed on every
    // single save.
    if (!Object.is(next, before[key])) patch[key] = next;
  }

  // Converted against the cylinder sitting at the same index of the STORED array, not
  // against the filtered one below: `isRecordedTank` can drop a blank cylinder from either
  // side and shift the pairing, and the value being preserved belongs to a position in the
  // stored dive, not to a position in a filtered view of it.
  const nextTanks = tanks
    .map((tank, index) => toStoredTank(tank, original.tanks[index], units))
    .filter(isRecordedTank);
  const currentTanks = original.tanks.filter(isRecordedTank);
  if (!sameTanks(currentTanks, nextTanks)) patch.tanks = nextTanks;

  return patch;
}

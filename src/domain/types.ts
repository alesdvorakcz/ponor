export type DiveStatus = 'logged' | 'planned';

/**
 * The closed vocabularies a dive form offers as a fixed list of chips, as **values**
 * — and each one's type derived from its own list rather than written beside it.
 *
 * A union and the array of its members are the same fact, and this codebase had them
 * written out twice each: once as the type here, once as a Zod `optionalPicked([...])` in
 * `domain/diveFormSchema.ts`, and once more as an `ENTRY_OPTIONS`-style const in
 * `DiveFormScreen.tsx` — three copies, none tied to the others by anything a compiler
 * checks. Adding `'liveaboard'` to `Entry` bought a save-blocking Zod rejection for a value
 * the domain says is legal, plus a chip the diver never sees to pick it, and nothing
 * anywhere would have failed to build.
 *
 * Deriving rather than asserting is what closes it: `Entry` cannot disagree with
 * `ENTRY_VALUES` because it *is* `ENTRY_VALUES`. (`db/dives.ts`'s `Mutual` and
 * `diveFormSchema.ts`'s `TankFormFieldsMatchTank` assert the same kind of agreement where
 * two shapes genuinely have to exist separately; here only one does.)
 *
 * **The order is the order the chips appear in**, so it is part of what these declare:
 * commonest first for entry and salinity, warmest-to-coldest for suits, best-to-worst for
 * weather and visibility, and under → good → over for the weighting judgement, so its
 * neutral value is not at an end of the row where a diver's thumb lands by accident.
 * That is how a diver reads down a list, rather than alphabetically.
 *
 * **`brackish` is gone from `SALINITY_VALUES`, deliberately and by name** (M1h, §10). The
 * diver's real question is salt or fresh; the estuary case did not earn a third chip. It is
 * recorded here as well as in §10 because it is the one value in this file that was ever
 * *shipped and then removed* — a column already held it — as opposed to never built.
 *
 * **Every member is one lowercase word that means itself, and `WEATHER_VALUES` was made to
 * obey that rather than excused from it** (M1h). It shipped from Task 1 holding `partly`,
 * which is half a phrase: a diver means *partly cloudy*, and the chip reading "Partly" beside
 * one reading "Cloudy" only makes sense because of what stands next to it. Two ways out were
 * rejected. A lookup table in `formatWeather` puts the missing word in the *formatter*, which
 * is the per-value map `capitalize`'s own docblock exists to avoid and would leave the stored
 * value still meaning nothing on its own. Storing `'partly cloudy'` — with the space — shapes
 * the vocabulary so that `capitalize` happens to work, which is the tail wagging the dog, and
 * every other member here is a single token. So the SCALE changed instead: the two cloud
 * levels are `cloudy` (some cloud, what `partly` was reaching for) and `overcast` (solid
 * grey). `semidry` is the precedent — a two-word concept compressed into one token rather
 * than spelled out with a separator.
 *
 * `as const` on each, so the arrays are readonly tuples of literals — without it every
 * member widens to `string` and the derived type says nothing at all.
 */
export const ENTRY_VALUES = ['shore', 'boat', 'other'] as const;
export const SALINITY_VALUES = ['salt', 'fresh'] as const;
export const WATER_BODY_VALUES = ['ocean', 'lake', 'river', 'quarry', 'cave', 'pool'] as const;
export const TANK_MATERIAL_VALUES = ['steel', 'alu'] as const;
export const CONFIGURATION_VALUES = ['single', 'twinset', 'sidemount'] as const;
export const WEATHER_VALUES = ['sunny', 'cloudy', 'overcast', 'rainy', 'windy', 'foggy'] as const;
export const VISIBILITY_VALUES = ['high', 'average', 'low'] as const;
export const SUIT_VALUES = ['none', 'shorty', 'wet', 'semidry', 'dry'] as const;
export const WEIGHTS_FEEL_VALUES = ['under', 'good', 'over'] as const;
export const EQUIPMENT_VALUES = ['hood', 'gloves', 'boots', 'torch', 'camera'] as const;

/**
 * The 0–3 scale `waves`, `current` and `surge` are recorded on — **as chips to offer**, which
 * is a different question from what the column holds, and the difference is the whole reason
 * this constant needs a paragraph.
 *
 * **One list for three fields, because the values are one fact.** The three scales are
 * 0–3 alike; what differs is the *words* — 0 is "Flat" for waves and "None" for current and
 * surge — and words are `format/display.ts`'s (§4.1), not this file's. Three identical
 * `[0, 1, 2, 3]`s here would be three chances to widen one and forget the others.
 *
 * **`ConditionLevel` is not the storage type, and must never become it.** DESIGN.md §10 rules
 * that `Dive['waves']` stays `number | null` rather than a `0|1|2|3` literal union, and the
 * reason is live rather than theoretical: there is no DB CHECK constraint, so M2 sync can
 * deliver a `waves: 7` from a client whose scale is wider, and typing it as impossible would
 * make `db/dives.ts`'s row-to-domain cast a lie. This union is the narrower claim that a chip
 * row can honestly make — *these are the levels this build offers a thumb* — and the two
 * co-exist deliberately, exactly as §4.1's "a deliberate near-duplicate names its siblings"
 * requires. **A reader who "unifies" them by narrowing `Dive` has undone a settled decision;
 * one who widens this to `number` has offered the diver an infinite chip row.**
 *
 * The out-of-scale value that follows from keeping the column wide is not swallowed: it is
 * kept, saved and flagged in words beside the control (`outOfScaleNote`,
 * `domain/diveFormSchema.ts` — a function of the vocabulary and the value, since the sentence
 * has to quote the number; there is no constant of that name, and the earlier
 * `OUT_OF_SCALE_NOTE` written here named nothing that exists), which is the half §10 recorded
 * as still owed until M1h.
 *
 * **The order is the order the chips appear in**, ascending, because these are the one
 * vocabulary in this file with an order that is not an editorial choice: 2 is more than 1.
 * That is also what lets §0.6's marks work — the marks *encode the scale in themselves*, and
 * a mark that accumulates has to accumulate in the direction the row is read.
 */
export const CONDITION_SCALE_VALUES = [0, 1, 2, 3] as const;

export type ConditionLevel = (typeof CONDITION_SCALE_VALUES)[number];

/**
 * The scale a dive's `rating` is offered on — 1–5, its sibling above's other half, and
 * everything that paragraph says about `ConditionLevel` applies here word for word:
 * `Dive['rating']` stays `number | null` (§10), this is only what a thumb is offered, and
 * neither should be turned into the other.
 *
 * Two differences from the condition scales, both deliberate. It **starts at 1**, because
 * there is no zero-star dive — an unrated dive is `null`, "not recorded", which is a
 * different claim from "bad". And it is drawn rather than lettered (§0.6: "`●` and `○` are
 * different sizes in almost every typeface, so a rating rendered from glyphs looks broken"),
 * so unlike every other vocabulary in this file it has no `format/display.ts` labels: what a
 * diver sees is five circles, and what a screen reader hears is composed from the numbers
 * themselves ("Rating: 3 of 5").
 */
export const RATING_VALUES = [1, 2, 3, 4, 5] as const;

export type RatingLevel = (typeof RATING_VALUES)[number];

/**
 * The top of that scale — **derived from the list, never written beside it** (§4.1: "a list
 * that can be computed from another is computed").
 *
 * It is the length only because the levels are 1…n with no gaps, which is what the list above
 * declares; if that ever stopped being true this would have to read the last member instead.
 * Deriving it matters because two things count on it in two files — `RatingDots` draws this
 * many marks, and the form offers this many targets — and "5" typed in either of them is how
 * a row of five ends up over a control offering four.
 */
export const RATING_MAX = RATING_VALUES.length;

export type Entry = (typeof ENTRY_VALUES)[number];
export type Salinity = (typeof SALINITY_VALUES)[number];
export type WaterBody = (typeof WATER_BODY_VALUES)[number];
export type TankMaterial = (typeof TANK_MATERIAL_VALUES)[number];
export type Configuration = (typeof CONFIGURATION_VALUES)[number];
export type Weather = (typeof WEATHER_VALUES)[number];
export type Visibility = (typeof VISIBILITY_VALUES)[number];
export type Suit = (typeof SUIT_VALUES)[number];
export type WeightsFeel = (typeof WEIGHTS_FEEL_VALUES)[number];
export type Equipment = (typeof EQUIPMENT_VALUES)[number];

/**
 * How many cylinders each rig is, and **the one place that says so** (§4.1).
 *
 * A `Record` keyed by `Configuration` rather than a `switch` or a lookup written where it is
 * needed: TypeScript requires every member, so a fourth rig added to `CONFIGURATION_VALUES`
 * above is a compile error here until somebody states how many cylinders it means. That is
 * §4.1's "derive, or tie at compile time" — and this is precisely the kind of list that
 * would otherwise be written a second time inside `derived.ts`'s gas arithmetic and then
 * disagree with the chips.
 *
 * Twinset and sidemount are both two, and that is not a reason to merge them: §10 settles
 * that they are different rigs recording different facts, and only the *count* they imply
 * coincides.
 */
const CYLINDERS_PER_CONFIGURATION: Record<Configuration, number> = {
  single: 1,
  twinset: 2,
  sidemount: 2,
};

/**
 * How many cylinders a rig is, or `null` when the rig was never recorded.
 *
 * **This is the replacement for `Tank.count`, which M1h removed** (§10: "material and
 * configuration are two facts, and `count` is derived from the second"). Nobody types a
 * count any more, because the configuration says it — so the count has to be *derived*
 * from the configuration in exactly one place, and this is it. `derived.ts`'s
 * `gasUsedLitres` is the caller; it must never re-state `twinset === 2` itself.
 *
 * **`null` in means `null` out, and that is the load-bearing half.** A cylinder whose rig
 * was never recorded is one whose count is *unknown*, and `derived.ts` classifies unknown
 * as `absent` — a bucket that is deliberately distinct from a known `1`, even though the
 * gas arithmetic then falls back to one cylinder (see `gasUsedLitres`, which states why
 * count is the one field where absent does not skip the cylinder). Returning `1` here
 * instead would collapse "we do not know this rig" into "we know it is a single", and the
 * whole absent-vs-contradictory policy in that file is built on those staying apart.
 *
 * A value outside the vocabulary — an M2 sync row from a client whose `Configuration` has a
 * member this build has never heard of — is unknown for the same reason and comes back
 * `null`, not a guess. The `?? null` is what makes that true at runtime: the parameter's
 * type is a label on what this client can produce, not a guarantee about what the network
 * delivers, exactly as `db/dives.ts`'s `toDive` already assumes for every other field.
 */
export function cylinderCount(configuration: Configuration | null): number | null {
  if (configuration === null) return null;
  return CYLINDERS_PER_CONFIGURATION[configuration] ?? null;
}

/**
 * One cylinder. Stored as an entry in the dive row's `tanks` JSON array, first
 * entry = the main cylinder. Every field is nullable: a diver may know the size
 * and pressures but not the working pressure, or nothing but the gas mix.
 */
export interface Tank {
  material: TankMaterial | null;
  /**
   * The rig: one cylinder, a twinset, or sidemount. **This replaced `count`** (§10) — a
   * cylinder is steel or alu and a rig is single, twinset or sidemount, which are two facts
   * that were bundled into one; and nobody types a count any more, because the
   * configuration says it. `cylinderCount` above is the one place that converts.
   */
  configuration: Configuration | null;
  /** Water capacity in litres. */
  sizeL: number | null;
  workingBar: number | null;
  /** 21 is air. */
  o2Pct: number | null;
  hePct: number | null;
  startBar: number | null;
  endBar: number | null;
}

/**
 * A dive as the app sees it. Mirrors the `dives` table; SI units throughout.
 * Everything is nullable except id, date and status — see DESIGN.md §6.
 *
 * `tanks` and `equipment` are the two further exceptions, and deliberately so:
 * an empty array already means "nothing recorded", so a nullable field would
 * add a second way to say the same thing and force every reader to handle
 * both. §6 states that rule for `tanks`; `equipment` is the same shape of
 * value and inherits it word for word.
 *
 * Note what is absent: no dive number, no used pressure, no RMV, no MOD, no
 * time out, no surface interval. Those six are computed from this data, never
 * stored — the same six DESIGN.md §6 lists under "Computed in the app".
 */
export interface Dive {
  id: string;
  status: DiveStatus;
  /** ISO date, `YYYY-MM-DD`. Local calendar date of the dive, not a timestamp. */
  date: string;
  /** Local wall-clock `HH:MM`, or null when unknown. */
  timeIn: string | null;
  /**
   * Hand-assigned order for same-day dives with no recorded time, set by the
   * diver. A tie-break within one date only — never read on its own. See
   * DESIGN.md §2.5 and `diveNumber.ts`.
   */
  manualOrder: number | null;
  durationMin: number | null;
  title: string | null;
  notes: string | null;
  rating: number | null;

  siteId: string | null;
  siteName: string | null;
  centerId: string | null;
  centerName: string | null;
  entry: Entry | null;
  salinity: Salinity | null;
  waterBody: WaterBody | null;
  latitude: number | null;
  longitude: number | null;

  maxDepthM: number | null;
  avgDepthM: number | null;
  waterTempC: number | null;
  airTempC: number | null;
  /**
   * The visibility a diver actually judges — high, average or low — and the primary of the
   * two (§10). `visibilityM` beside it is the optional refinement for divers who estimate a
   * distance.
   *
   * **These are two encodings of one subject and that is intended.** §4.1's instinct is to
   * unify look-alikes, and a later reader who unifies these deletes the half that carries
   * the meaning: nobody measures visibility, so the scale is the fact and the metres are the
   * embellishment. The same pairing exists one cluster down for `weightsKg`/`weightsFeel`,
   * where it is sharper still — `6 kg` means nothing on its own, and "6 kg, and I was over"
   * is what a diver uses to dial in the next dive.
   */
  visibility: Visibility | null;
  visibilityM: number | null;
  waves: number | null;
  current: number | null;
  surge: number | null;
  weather: Weather | null;

  tanks: Tank[];

  suit: Suit | null;
  /**
   * Millimetres, and a **number rather than a token** (§10): a list offering 3 mm and 7 mm
   * makes a 5 mm suit unsayable, and a diver forced to pick the nearest wrong value is the
   * failure §1 exists to prevent.
   */
  suitThicknessMm: number | null;
  /**
   * Hood, gloves, boots, torch, camera — a **token set**, never one boolean column each
   * (§10, and §6's own reason for `tanks`): adding "camera" must not cost a column. It is
   * also what splits the exclusive choice from the non-exclusive one — you wear one suit and
   * any number of accessories, so `suit` above is a picked value and this is a set.
   *
   * Never null, for the reason `tanks` is never null: an empty array already means "no
   * accessories recorded".
   *
   * Note what this cannot say, since the three booleans it replaced could: a token that is
   * absent from the set means "not worn OR not recorded", where `hood: false` used to mean
   * "recorded, and no hood". §10 took that trade knowingly — a set is what an accessory list
   * is, and nobody logs the absence of a torch.
   */
  equipment: Equipment[];
  weightsKg: number | null;
  /** Under, good or over — see `visibility` above for why a judgement sits beside a number. */
  weightsFeel: WeightsFeel | null;
  buddy: string | null;
  guide: string | null;

  importSource: string | null;
  importId: string | null;

  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * A named cylinder set — "twin 12 steel", "alu 80 nitrox" — applied to a dive in one tap
 * (DESIGN.md §2.1). Mirrors the `gear_presets` table; SI units throughout, exactly as a
 * dive's own `tanks` are.
 *
 * **Cylinders and gas, and nothing else** (§10). Suit, its thickness, the equipment set and
 * weights are deliberately absent: carry-over already fills every one of them from the previous dive, so
 * a preset holding them too would be a second, staler source for fields something else
 * already fills correctly. What genuinely varies inside one diver's habits is the cylinder.
 *
 * **The pressures inside `tanks` are always null.** `startBar`/`endBar` describe what was
 * left in a cylinder on one dive, which a preset cannot know and must not invent — the same
 * rule carry-over applies, and one implementation of it (`withoutPressures`,
 * domain/carryOver.ts). The type cannot say so, because `tanks` is `Tank[]` and a `Tank` has
 * both fields; `db/gearPresets.ts` is the one write path and is where it is enforced.
 *
 * `tanks` is `Tank[]` and never nullable, for the reason §6 gives for a dive's: an empty
 * array already means "no cylinders recorded", so a nullable column would be a second way to
 * say the same thing.
 */
export interface GearPreset {
  id: string;
  name: string;
  tanks: Tank[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

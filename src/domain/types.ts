export type DiveStatus = 'logged' | 'planned';

/**
 * The five closed vocabularies a dive form offers as a fixed list of chips, as **values**
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
 * commonest first for entry and salinity, and warmest-to-coldest for suits, which is how a
 * diver reads down the list rather than alphabetically.
 *
 * `as const` on each, so the arrays are readonly tuples of literals — without it every
 * member widens to `string` and the derived type says nothing at all.
 */
export const ENTRY_VALUES = ['shore', 'boat', 'other'] as const;
export const SALINITY_VALUES = ['salt', 'fresh', 'brackish'] as const;
export const WATER_BODY_VALUES = ['ocean', 'lake', 'river', 'quarry', 'cave', 'pool'] as const;
export const TANK_MATERIAL_VALUES = ['steel', 'alu'] as const;
export const SUIT_VALUES = ['none', 'shorty', 'wet', 'semidry', 'dry'] as const;

export type Entry = (typeof ENTRY_VALUES)[number];
export type Salinity = (typeof SALINITY_VALUES)[number];
export type WaterBody = (typeof WATER_BODY_VALUES)[number];
export type TankMaterial = (typeof TANK_MATERIAL_VALUES)[number];
export type Suit = (typeof SUIT_VALUES)[number];

/**
 * One cylinder. Stored as an entry in the dive row's `tanks` JSON array, first
 * entry = the main cylinder. Every field is nullable: a diver may know the size
 * and pressures but not the working pressure, or nothing but the gas mix.
 */
export interface Tank {
  material: TankMaterial | null;
  /** Water capacity in litres. */
  sizeL: number | null;
  /** 2 for a twinset, 1 otherwise. */
  count: number | null;
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
 * `tanks` is the one further exception, and deliberately so: an empty array
 * already means "no cylinders recorded", so a nullable field would add a
 * second way to say the same thing and force every reader to handle both.
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
  visibilityM: number | null;
  waves: number | null;
  current: number | null;
  surge: number | null;

  tanks: Tank[];

  suit: Suit | null;
  hood: boolean | null;
  gloves: boolean | null;
  boots: boolean | null;
  weightsKg: number | null;
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
 * **Cylinders and gas, and nothing else** (§10). Suit, hood, gloves, boots and weights are
 * deliberately absent: carry-over already fills every one of them from the previous dive, so
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

export type DiveStatus = 'logged' | 'planned';
export type Entry = 'shore' | 'boat' | 'other';
export type Salinity = 'salt' | 'fresh' | 'brackish';
export type WaterBody = 'ocean' | 'lake' | 'river' | 'quarry' | 'cave' | 'pool';
export type TankMaterial = 'steel' | 'alu';
export type Suit = 'none' | 'shorty' | 'wet' | 'semidry' | 'dry';

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

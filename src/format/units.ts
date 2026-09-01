import type { Dive, Tank } from '../domain/types';

/**
 * The four unit pairs DESIGN.md §3 gives Settings — **m/ft · bar/psi · °C/°F · kg/lb** —
 * and nothing else. This module owns the arithmetic, the unit words, and the precision
 * each pair is read to; `format/display.ts` (§4.1's owner of "every conversion of a stored
 * value into diver-facing text") owns the sentence those pieces are assembled into and
 * calls this rather than converting anything itself. One owner, split by what it decides:
 * this file decides *what number and which word*, that file decides *what string*.
 *
 * **SI is what is stored, always** (§6: "SI units stored, converted at display"). Nothing
 * here is called on the way into the database except `storedValueFor` below, whose entire
 * job is to put a diver-entered imperial figure *back* into SI before it reaches
 * `db/dives.ts`. A value in this file's imperial units exists only between the screen and
 * the diver's eyes.
 *
 * **The scale is not one of the four pairs.** DESIGN.md §0.1's depth bands are defined in
 * metres because they follow the order in which water removes colour — a physical fact
 * about water, not about the diver's preference — so `theme/depth.ts` reads the stored
 * metre value and never anything this file returns. A dive shown as `81 ft` must land in
 * the same band as the `24.7 m` it is; computing the band from a converted number would
 * put every imperial dive in band 6.
 *
 * **Four quantities the app displays have no pair here, deliberately.** Duration stays
 * minutes in both systems (a dive is 47 minutes long wherever you dive it). A cylinder's
 * size stays litres, and gas used and RMV stay litres and l/min with it: the imperial
 * cylinder unit is the *cubic foot*, which measures the free gas a cylinder holds at its
 * working pressure rather than the water capacity litres measure — an 80 cf cylinder is
 * an 11.1 L one — so "l → cf" is not a unit conversion at all but a different quantity
 * needing a pressure this app does not require anyone to record. And a **suit's thickness
 * stays millimetres**: a 5 mm suit is a 5 mm suit wherever it is sold, dived or talked
 * about, because that is the number printed on it — every manufacturer, including every
 * American one, states neoprene thickness in mm, so converting it to inches would render a
 * figure no diver has ever read on a label. §3 lists four pairs; this is why it lists four.
 */

/**
 * `as const` so the type below is derived from the list rather than written beside it —
 * the same reason `domain/types.ts` derives `Entry` from `ENTRY_VALUES`. The order is the
 * order Settings will offer them in, metric first (see `DEFAULT_UNIT_SYSTEM`).
 */
export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;

export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

/**
 * What a diver who has never opened Settings reads. Metric, per this task's brief and
 * §3's onboarding step ("pick units"), which offers the choice but does not force it.
 *
 * Deliberately a separate constant from `SI_SYSTEM` below even though the two hold the
 * same string: that they coincide is a convenience, not a rule. If the default ever
 * changed, only this would move.
 */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'metric';

/**
 * The system whose units *are* the stored ones (§6). Every conversion in this system is
 * the identity, which is what lets `storedValueFor` return a metric diver's typed value
 * completely untouched — no rounding, no round trip, byte-identical to what this app wrote
 * before units existed.
 */
const SI_SYSTEM: UnitSystem = 'metric';

/** A physical quantity one of §3's four pairs measures. */
export type Quantity = 'depth' | 'pressure' | 'temperature' | 'weight';

/**
 * Exact defining constants, not rounded factors, so the arithmetic is as good as the
 * float it lands in and a round trip through one of them is exact wherever it can be.
 * The international foot is *defined* as 0.3048 m and the avoirdupois pound as
 * 0.45359237 kg; the pound-force per square inch is defined by its own two constants
 * (4.4482216152605 N over 0.00064516 m²), which is why it is written as that division
 * rather than as the 6894.757… anyone would otherwise have to trust a copy of.
 */
const METRES_PER_FOOT = 0.3048;
const KILOGRAMS_PER_POUND = 0.45359237;
const PASCALS_PER_PSI = 4.4482216152605 / 0.00064516;
const PASCALS_PER_BAR = 100000;

/**
 * One half of one pair: the word, the precision, and the arithmetic both ways.
 *
 * `decimals` is `null` only where the figure is shown exactly as recorded — see the
 * weight spec below, which is the one case and states why.
 */
interface UnitSpec {
  /** The unit's diver-facing word, as a suffix and as an empty field's placeholder (§0.6). */
  unit: string;
  /** Decimal places the figure is read to, or `null` for "exactly as recorded". */
  decimals: number | null;
  /** Stored SI value -> this unit. */
  fromSi: (si: number) => number;
  /** This unit -> the stored SI value. */
  toSi: (value: number) => number;
}

const identity = (value: number): number => value;

/**
 * **The precision of each pair, decided per pair rather than mirrored across it.**
 *
 * *Depth — `24.6 m` / `81 ft`.* A metre gauge reads to the decimetre and a decimetre is
 * meaningful, so metric keeps one decimal. Imperial gets **whole feet**, which is what
 * every imperial depth gauge and dive computer reads to. `80.7 ft` would claim a
 * resolution of about 3 cm, finer than the instrument that produced the number and finer
 * than the metric side of the same pair — false precision in the literal sense. The cost
 * is real and bounded: up to 0.15 m of *display* resolution, below the accuracy of any
 * depth gauge, and it costs the stored value nothing at all (the metre figure is untouched
 * and comes straight back on switching to metric).
 *
 * *Pressure — `208 bar` / `3016 psi`.* Whole units both sides, and here that is the
 * conservative choice rather than the coarse one: one bar is 14.5 psi, so whole psi is
 * **fourteen times finer** than the whole bar the metric side already shows — no precision
 * is invented relative to the data. Rounding psi to the nearest 10 was considered and
 * rejected: an imperial diver who types `2895 psi` would be shown `2900 psi` back, a
 * quietly-wrong reading of their own entry, which is the failure mode `derived.ts` argues
 * against throughout ("a diver who sees no figure goes back and fixes the typo; one who
 * sees a plausible, quietly-wrong figure does not").
 *
 * *Temperature — `4 °C` / `39 °F`.* Whole degrees both sides, same reasoning: one Celsius
 * degree is 1.8 Fahrenheit degrees, so whole °F is finer than the whole °C already shown,
 * and both are how a diver says a water temperature out loud.
 *
 * *Weight — `6.5 kg` / `14 lb`.* Metric shows the figure **exactly as recorded** — the
 * decision `formatWeight` already carried before this file existed, because weighting is
 * set in half-kilos and a fixed decimal count would render a plain `6 kg` as `6.0 kg`.
 * Imperial gets whole pounds: a pound is 0.45 kg, finer than the half-kilo the metric side
 * works in, and weights are cast, sold and stated in whole pounds. Half a pound would be
 * finer than any belt is actually assembled.
 */
const SPECS: Record<Quantity, Record<UnitSystem, UnitSpec>> = {
  depth: {
    metric: { unit: 'm', decimals: 1, fromSi: identity, toSi: identity },
    imperial: {
      unit: 'ft',
      decimals: 0,
      fromSi: (m) => m / METRES_PER_FOOT,
      toSi: (ft) => ft * METRES_PER_FOOT,
    },
  },
  pressure: {
    metric: { unit: 'bar', decimals: 0, fromSi: identity, toSi: identity },
    imperial: {
      unit: 'psi',
      decimals: 0,
      fromSi: (bar) => (bar * PASCALS_PER_BAR) / PASCALS_PER_PSI,
      toSi: (psi) => (psi * PASCALS_PER_PSI) / PASCALS_PER_BAR,
    },
  },
  temperature: {
    metric: { unit: '°C', decimals: 0, fromSi: identity, toSi: identity },
    imperial: {
      unit: '°F',
      decimals: 0,
      fromSi: (c) => (c * 9) / 5 + 32,
      toSi: (f) => ((f - 32) * 5) / 9,
    },
  },
  weight: {
    metric: { unit: 'kg', decimals: null, fromSi: identity, toSi: identity },
    imperial: {
      unit: 'lb',
      decimals: 0,
      fromSi: (kg) => kg / KILOGRAMS_PER_POUND,
      toSi: (lb) => lb * KILOGRAMS_PER_POUND,
    },
  },
};

/** The unit's diver-facing word — the suffix beside a figure and the placeholder in an
 * empty field that has none (§0.6). The one place a screen may get `'ft'` or `'psi'` from;
 * a literal typed into a screen is exactly the drift §4.1 exists to end. */
export function unitLabel(quantity: Quantity, system: UnitSystem): string {
  return SPECS[quantity][system].unit;
}

/**
 * A converted figure rounded to a pair's own precision, as a **number**.
 *
 * `displayFigure` below then calls `.toFixed()` on this result rather than on the raw
 * converted value, and that second step is load-bearing rather than redundant: `toFixed`
 * applied straight to a small negative value emits a negative zero as text —
 * `(-0.4).toFixed(0)` is the string `"-0"`, so a water temperature of −0.4 °C would read
 * "-0 °C", which is not a temperature anyone writes. Applied to the rounded *number* it
 * cannot, because `(-0).toFixed(0)` is `"0"`. The app already printed `0 °C` for that
 * input before this file existed, via a `Math.round` whose `-0` vanished inside a template
 * string; rounding first is what keeps that true now that `toFixed` does the rounding.
 *
 * (An earlier draft added `+ 0` here to flip `-0` to `+0`. It was removed as dead: nothing
 * downstream distinguishes the two — `storedValueFor` compares with `===`, which reports
 * `-0 === 0` as true — and a mutation deleting it changed no test, which is the definition
 * of code that is not doing anything.)
 */
function roundToDecimals(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/**
 * The **number** a stored SI value reads as in `system` — converted and rounded to that
 * pair's own precision, with no unit word attached.
 *
 * Exported because two callers need the figure rather than the text: `displayFigure` below
 * builds the string from it, and `storedValueFor` compares it against what the diver's form
 * currently holds to decide whether they actually changed anything. Rounding in one place
 * is what makes that comparison sound — a second rounding rule would let an untouched field
 * read as edited.
 */
export function displayNumber(quantity: Quantity, si: number, system: UnitSystem): number {
  const spec = SPECS[quantity][system];
  const converted = spec.fromSi(si);
  return spec.decimals === null ? converted : roundToDecimals(converted, spec.decimals);
}

/**
 * A stored SI value split into the numeral a diver reads and the unit word beside it, e.g.
 * `{ value: '24.6', unit: 'm' }` or `{ value: '81', unit: 'ft' }`.
 *
 * Split rather than joined because `DepthValue` styles the two differently (§0.6 sets the
 * unit quieter than the number) and must never get there by splitting a formatted string on
 * a space it happens to contain — see `formatDepthParts` (format/display.ts) for the bug
 * that cost. Everything else joins them with a single space, which `formatDepth` and its
 * siblings do in one place.
 *
 * No guards: this takes a real, finite number, because every caller is a `format/display.ts`
 * formatter that has already applied that module's own `isFiniteNumber` check.
 */
export function displayFigure(
  quantity: Quantity,
  si: number,
  system: UnitSystem,
): { value: string; unit: string } {
  const spec = SPECS[quantity][system];
  const converted = spec.fromSi(si);
  const value =
    spec.decimals === null
      ? String(converted)
      : roundToDecimals(converted, spec.decimals).toFixed(spec.decimals);
  return { value, unit: spec.unit };
}

/**
 * A figure the diver typed on the form, back in the SI the database stores — **or the
 * value already stored, untouched, when the diver did not actually change what the field
 * showed.**
 *
 * That second half is the whole reason this is not a bare `toSi` call. A dive stored as
 * `24.6 m` shows an imperial diver `81 ft`; converting that 81 straight back gives
 * 24.6888 m, so merely opening a dive and saving an unrelated typo would quietly re-quantise
 * its depth to the nearest foot — on every dive that diver ever edits, with `updated_at`
 * advancing behind it and M2's whole-row last-write-wins carrying the drift to their other
 * devices. Comparing in *display* space instead ("does the stored value still read as the
 * figure in the box?") answers the only question that matters — did the diver change this
 * field — and leaves an untouched one bit-for-bit as it was. `toDivePatch` (diveFormSchema.ts)
 * then sees no change and writes nothing at all.
 *
 * **Metric returns `entered` unchanged, always**, before anything else is considered. Metric
 * *is* the stored form, so there is no conversion to undo and no rounding to preserve
 * against: a metric diver's `24.63` is stored as `24.63`, exactly as it was before this
 * module existed. (This is also why the form shows a metric diver their raw stored value
 * while showing an imperial diver a rounded one — there is nothing to round when nothing is
 * converted, and the diver's own figure beats a tidied one.)
 *
 * A non-finite `entered` passes straight through rather than being converted or refused:
 * §1's "never block a save" binds here as everywhere, and `diveFormSchema.ts`'s coercion
 * contract already decides what an empty or unreadable field means.
 */
export function storedValueFor(
  quantity: Quantity | null,
  entered: number | null,
  stored: number | null | undefined,
  system: UnitSystem,
): number | null {
  if (quantity === null || system === SI_SYSTEM) return entered;
  if (entered === null || !Number.isFinite(entered)) return entered;
  if (
    typeof stored === 'number' &&
    Number.isFinite(stored) &&
    displayNumber(quantity, stored, system) === entered
  ) {
    return stored;
  }
  return SPECS[quantity][system].toSi(entered);
}

/**
 * The exact inverse of `storedValueFor`: a stored SI value as the **figure a diver working
 * in `system` should find in a form field**, ready to be typed over.
 *
 * The pair is what makes the form's round trip safe, and each half states the same rule
 * from its own side: `storedValueFor(q, displayValueFor(q, x, s), x, s)` is `x` for every
 * finite `x`, because the value the diver did not touch is exactly the value the form put
 * in front of them.
 *
 * **Metric returns the stored value untouched, with no rounding at all** — where
 * `displayFigure` above *does* round a metric depth to one decimal for the dive detail and
 * the row. That is not an inconsistency: a form field is a value about to be written back,
 * and metric is what is written, so showing a metric diver their own stored `24.63` beats
 * showing them a tidied `24.6` that would then overwrite it. Imperial has no such choice —
 * the figure has to be converted, so it has to be rounded, and `storedValueFor` is what
 * stops that rounding from reaching the database.
 */
export function displayValueFor(
  quantity: Quantity | null,
  stored: number | null,
  system: UnitSystem,
): number | null {
  if (quantity === null || system === SI_SYSTEM) return stored;
  if (stored === null || !Number.isFinite(stored)) return stored;
  return displayNumber(quantity, stored, system);
}

/**
 * Which physical quantity each stored column holds — the fact that decides whether a field
 * converts at all, and into what.
 *
 * A **mapped type over `Dive` itself**, not a hand-kept list of the six fields that happen
 * to convert today: TypeScript requires every key, so adding a column to `Dive` is a
 * compile error here until somebody says what it measures. §4.1's "derive, or tie at compile
 * time", and the shape `TankFormFieldsMatchTank` already establishes one file over. The
 * alternative — a list of unit-bearing fields — is precisely the "hand-maintained option
 * list" that produced "a save-blocking rejection and a missing chip, silently".
 *
 * `tanks` is `null` here because the array itself measures nothing; its cylinders are
 * classified by `TANK_FIELD_QUANTITY` below.
 *
 * Note `visibilityM`: a distance in metres, so it takes the same m/ft pair a depth does —
 * which is what `DiveDetailScreen` already assumed by formatting it through `formatDepth`.
 */
const DIVE_FIELD_QUANTITY: { readonly [K in keyof Dive]: Quantity | null } = {
  id: null,
  status: null,
  date: null,
  timeIn: null,
  manualOrder: null,
  durationMin: null,
  title: null,
  notes: null,
  rating: null,

  siteId: null,
  siteName: null,
  centerId: null,
  centerName: null,
  entry: null,
  salinity: null,
  waterBody: null,
  latitude: null,
  longitude: null,

  maxDepthM: 'depth',
  avgDepthM: 'depth',
  waterTempC: 'temperature',
  airTempC: 'temperature',
  visibility: null,
  visibilityM: 'depth',
  waves: null,
  current: null,
  surge: null,
  weather: null,

  tanks: null,

  suit: null,
  // Millimetres in both systems — see this module's own top docblock, which names it as the
  // fourth quantity with no pair rather than as an omission. A `'depth'` here would put a
  // 5 mm suit on the m/ft pair and render it as 0.02 ft.
  suitThicknessMm: null,
  equipment: null,
  weightsKg: 'weight',
  weightsFeel: null,
  buddy: null,
  guide: null,

  importSource: null,
  importId: null,

  createdAt: null,
  updatedAt: null,
  deletedAt: null,
};

/**
 * The same map for one cylinder, and exhaustive over `Tank` for the same reason.
 *
 * `sizeL` is `null` — see this module's own top docblock for why a cylinder's size has no
 * imperial counterpart here rather than being an oversight. `o2Pct`/`hePct` are percentages
 * and `configuration` names a rig; none of the three is a measurement in any system.
 */
const TANK_FIELD_QUANTITY: { readonly [K in keyof Tank]: Quantity | null } = {
  material: null,
  configuration: null,
  sizeL: null,
  workingBar: 'pressure',
  o2Pct: null,
  hePct: null,
  startBar: 'pressure',
  endBar: 'pressure',
};

/** What one of a dive's own stored columns measures, or `null` when it measures nothing
 * §3 gives a pair for. */
export function diveFieldQuantity(field: keyof Dive): Quantity | null {
  return DIVE_FIELD_QUANTITY[field];
}

/** What one of a cylinder's stored fields measures — see `diveFieldQuantity`. */
export function tankFieldQuantity(field: keyof Tank): Quantity | null {
  return TANK_FIELD_QUANTITY[field];
}

/**
 * Whether a value read back out of the local `settings` table names a unit system.
 *
 * The table is `text`/`text` (db/schema.ts), so every read has to decide what the string
 * means — `db/settings.ts`'s own docblock draws that line for `dives_before` and this is
 * the same boundary for `units`. Anything else (an older key, a hand-edited row, a value
 * from a future build that offers a third system) is not a system this build can honour,
 * and `readUnitSystem` falls back to the default rather than guessing.
 */
export function isUnitSystem(value: unknown): value is UnitSystem {
  return typeof value === 'string' && (UNIT_SYSTEMS as readonly string[]).includes(value);
}

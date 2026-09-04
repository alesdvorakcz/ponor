import { timeOut } from '../domain/derived';
import { isCalendarDate } from '../domain/datetime';
// **A type, and `import type` is what keeps that true.** `domain/logbookStats.ts` imports
// `isDisplayableDepth` from this module — the app's one owner of "can this depth be shown" —
// so a value import back the other way would be a real runtime cycle. This specifier is erased
// at compile time, which is exactly what the two modules' split requires: the figures are
// computed there and worded here, and only the shape of the answer crosses.
import type { LogbookStats } from '../domain/logbookStats';
// A type, on the same terms and for the same reason as `LogbookStats` above: `domain/
// mapSites.ts` imports `diveSiteLabel` from this module (a map place is called what a dive row
// calls it), so only the shape of its answer may come back the other way.
import type { WaterTempRange } from '../domain/mapSites';
import {
  type ConditionLevel,
  type Configuration,
  type Dive,
  type DiveSite,
  type DiveStatus,
  type Entry,
  type Equipment,
  type Salinity,
  type Suit,
  type Tank,
  type TankMaterial,
  type Visibility,
  type WaterBody,
  type Weather,
  type WeightsFeel,
} from '../domain/types';
import { displayFigure, displayNumber, unitLabel, type UnitSystem } from './units';

/**
 * The SI-to-diver-facing conversion boundary (DESIGN.md §6: "SI units
 * stored, converted at display"). §4.1 names this module the one owner of
 * that conversion, and the unit *setting* §3 gives Settings — m/ft,
 * bar/psi, °C/°F, kg/lb — has landed here rather than in the screens, so
 * exactly one place decides what a stored number reads as.
 *
 * **The unit system is a parameter, never a lookup.** Every formatter below
 * that has a pair takes `system` from its caller and reads nothing —
 * no context, no hook, no settings row — from inside itself. That is what
 * keeps these pure functions testable as pure functions, and it keeps the
 * decision of *which* system in one place per screen (`useUnitSystem`)
 * rather than scattered down every formatter in the file. The arithmetic,
 * the unit words and the precision of each pair live one file over in
 * `format/units.ts`; this module joins the pieces into the sentence a
 * diver reads and guards what may not be shown at all.
 *
 * A formatter with no `system` parameter has no pair, and that is a
 * decision rather than an omission: duration is minutes in both systems,
 * and litres/l-per-min have no imperial counterpart that is the same
 * quantity — see `format/units.ts`'s top docblock, which states why §3
 * lists exactly four pairs.
 *
 * Every formatter returns null for a field that was never recorded (null)
 * or cannot be a real reading (NaN, ±Infinity — e.g. a value that reached
 * the database from an older or buggy client). §1's "only the fields you
 * use" / no-form-shaming stance applies to reading as much as to writing:
 * a caller gets null so it can omit the element entirely, never a
 * placeholder like "— m" and never the literal string "NaN m".
 */

/**
 * Same finiteness guard every numeric formatter below uses. `typeof value
 * === 'number'` is what lets this double as a type predicate; the
 * behaviour that actually matters is Number.isFinite, which — unlike a
 * bare typeof check — also rejects NaN (typeof NaN === 'number' is true)
 * and ±Infinity.
 */
function isFiniteNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Depth split into its numeral and unit, e.g. `{ value: '32.4', unit: 'm' }`.
 *
 * M1c task 1 review, Important: `DepthValue` needs the unit styled more quietly than the
 * number, and used to get there by taking `formatDepth`'s string and splitting it on the
 * space it happened to always contain — a parse with no fallback, so a future formatDepth
 * change (this file's own top docblock names the m/ft unit setting arriving "in M1c" —
 * this exact function, this same milestone) could silently turn a missing unit into the
 * literal text "undefined" on screen. This is the structured form instead: a caller that
 * wants the two pieces separately takes them from here, never by re-parsing a formatted
 * string. `formatDepth` below is now defined in terms of this, not the other way round, so
 * there remains exactly one place — this one — that decides a depth's numeral and unit;
 * whatever formatDepth ends up being ("32.4 m", "106.3 ft", ...) is only ever this value
 * and this unit joined with a space.
 *
 * M1c closing fixes, Important #3: also refuses a negative depth, which `isFiniteNumber`
 * alone does not catch (unlike temperature, a depth cannot physically be below the
 * surface). This function used to disagree here with `depthColorOrNull` (theme/depth.ts),
 * which already rejected negative — two independently-coded answers to "can this depth be
 * shown?" that only visibly differed on this one input: a screen gating on
 * `formatDepth(...) !== null` (DiveDetailScreen.tsx, DiveRow.tsx's accessibility label)
 * said yes, while `DepthValue` — which renders from `depthColorOrNull` — said no, so a
 * negative max depth drew a dangling "Max depth" label with nothing beside it, and an
 * accessibility label naming a depth the screen never actually drew. `depthColorOrNull` now
 * defers its own finiteness/sign check to this function instead of re-deriving it, so there
 * is exactly one owner of "is this depth displayable" and a future edit here can't quietly
 * desync the two again. This matters beyond that one screen: M1d's form is what will
 * actually produce out-of-range numeric input, and negative is the third case after NaN
 * and 0.
 */
export function formatDepthParts(
  metres: number | null,
  system: UnitSystem,
): { value: string; unit: string } | null {
  if (!isDisplayableDepth(metres)) return null;
  return displayFigure('depth', metres, system);
}

/**
 * Whether a stored depth can be shown at all — finite, and not below the surface.
 *
 * Split out of `formatDepthParts` above when that function gained its `system` parameter,
 * and the split is load-bearing rather than tidying. `depthColorOrNull` (theme/depth.ts)
 * asks exactly this question and used to ask it *by calling `formatDepthParts` and checking
 * for null* — see that function's own docblock for the dangling-"Max depth"-label bug that
 * arrangement was introduced to fix. It could not keep doing so once formatting needed a
 * unit system, because the depth SCALE has no unit system: §0.1's bands are metres, colour
 * is computed from the stored value, and handing `depthColorOrNull` a `UnitSystem` would
 * say otherwise in the one place that must never believe it.
 *
 * So the predicate is what both read, and `formatDepthParts` is defined in terms of it —
 * there is still exactly one owner of "can this depth be shown", and it is still impossible
 * for the two answers to drift apart: whatever this accepts, the screen colours *and*
 * prints; whatever it refuses, neither does.
 *
 * Negative is refused as well as non-finite, and that is not the same check: unlike a
 * temperature, a depth cannot physically be above the surface. (`-0` is not negative and is
 * accepted, printing as `0.0 m` — a dive that never left the surface is a legal, if sad,
 * reading.)
 */
export function isDisplayableDepth(metres: number | null | undefined): metres is number {
  return metres !== undefined && isFiniteNumber(metres) && !(metres < 0);
}

/** Depth as one string, e.g. "32.4 m" or "106 ft" — `formatDepthParts` joined with a
 * space, never assembled any other way. */
export function formatDepth(metres: number | null, system: UnitSystem): string | null {
  const parts = formatDepthParts(metres, system);
  return parts === null ? null : `${parts.value} ${parts.unit}`;
}

/**
 * One band of the depth scale as its label on the first-run legend — `"0–6"`, `"12–20"`,
 * `"40+ m"` in metric; `"0–20"`, `"39–66"`, `"131+ ft"` in imperial.
 *
 * **The numbers arrive in metres and are never typed here.** `theme/depth.ts` owns the
 * boundaries (`depthBandRanges`) because §0.1's bands follow the order water removes
 * colour, which is a fact about water; this function owns only how a diver reads them,
 * which is §4.1's split between the two modules exactly as it already runs for a dive's own
 * depth. Move a boundary in `tokens.js` and the legend moves; retype one here and there is a
 * second scale.
 *
 * **The figures go through `displayNumber`, not `displayFigure`.** Both convert and round to
 * §3's own precision for the pair — whole feet in imperial, per §10 — but `displayFigure`
 * then pads to the pair's decimal count, and a metric legend reading `0.0–6.0` claims a
 * resolution the boundaries do not have. A boundary is a whole number of metres by
 * construction, so the number is what belongs here and the padding is not.
 *
 * **The unit word appears once, on the deepest band, and that is a layout decision made here
 * rather than in the component** — because it is the open-ended band that has to say what
 * the numbers are, and because it is already the one label that is not a range. Six labels
 * each carrying `ft` is the version that was rejected: `98–131 ft` at mono 10.5 does not fit
 * a sixth of a phone's width, so the labels would wrap and the legend would stop reading as
 * one scale. The component therefore never joins a figure to a unit itself, which is the
 * whole reason this module exists.
 *
 * The en dash is unpadded, matching `dateRangeOf` (domain/trips.ts) rather than
 * `formatTimeRange` above, which pads its own. Both spellings are deliberate and this is the
 * compact one: a numeric span in a narrow slot, where `0 – 6` would read as two figures with
 * something between them rather than as one range. Named here so a later reader finds two
 * dashes and a reason rather than an inconsistency.
 */
export function formatDepthBandRange(fromM: number, toM: number | null, system: UnitSystem): string {
  const from = String(displayNumber('depth', fromM, system));
  if (toM === null) return `${from}+ ${unitLabel('depth', system)}`;
  return `${from}–${String(displayNumber('depth', toM, system))}`;
}

/**
 * A single band boundary with its unit — `"6 m"`, `"20 ft"`. `formatDepthBandRange`'s sibling,
 * and its only other caller is the sentence directly under that legend: "red fades out by 6 m,
 * blue carries past 40 m" (EmptyState.tsx), which states the two depths §0.1's own prose is
 * about.
 *
 * **Not `formatDepth`**, and the difference is the point rather than an oversight. That one
 * shows a *dive's* depth to the precision a gauge reads — `6.0 m` — because it is reporting a
 * measurement. A band boundary is not a measurement: it is a whole number by construction, and
 * `6.0 m` in a sentence explaining why the palette is what it is would claim a decimetre of
 * significance the boundary has never had. Same rounding rule as the legend beside it, for the
 * same reason: the sentence and the labels must not disagree about where a band ends.
 */
export function formatDepthBoundary(metres: number, system: UnitSystem): string {
  return `${String(displayNumber('depth', metres, system))} ${unitLabel('depth', system)}`;
}

/** Duration to the whole minute, e.g. "72 min" — how divers log it, never h:mm. Minutes in
 * both systems: a dive is 47 minutes long wherever it is dived, so this takes no `system`. */
export function formatDuration(minutes: number | null): string | null {
  if (!isFiniteNumber(minutes)) return null;
  return `${Math.round(minutes)} min`;
}

/** Water or air temperature, e.g. "-1 °C" or "30 °F" — whole degrees in both systems, sign
 * kept for sub-zero water. */
export function formatTemperature(celsius: number | null, system: UnitSystem): string | null {
  if (!isFiniteNumber(celsius)) return null;
  const parts = displayFigure('temperature', celsius, system);
  return `${parts.value} ${parts.unit}`;
}

/**
 * The water a place has been dived in, as a span — `"18–24 °C"`, or `"21 °C"` when every
 * reading rounds to the same figure. Null when there is no range to show.
 *
 * `formatTemperature`'s sibling, and the *temp* half of §3's *"depth/temp summary"* on the Map
 * tab. It is a span rather than an average because an average is a reading no dive took
 * (`waterTempRange`, domain/mapSites.ts, has the argument); this function only decides how the
 * two figures read.
 *
 * **The unit is written once, after the pair**, exactly as `formatDepthBandRange` writes it
 * once for the deepest band: `18 °C–24 °C` says the same thing twice in a slot that is already
 * one figure among three. The en dash is unpadded, which is the compact spelling this module
 * splits on — `formatDepthBandRange` and `dateRangeOf` (domain/trips.ts) use it for a numeric
 * span in a narrow slot, `formatTimeRange` pads its own for two clock times.
 *
 * **Equal figures collapse to one**, and the comparison is on the CONVERTED, rounded text
 * rather than on the stored Celsius: two dives at 21.2 °C and 21.4 °C both print `21`, and
 * `21–21 °C` is a range with nothing in it. In Fahrenheit the boundary lands elsewhere, which
 * is correct — the figures a diver reads are what may or may not differ.
 */
export function formatTemperatureRange(range: WaterTempRange | null, system: UnitSystem): string | null {
  if (range === null) return null;
  const { coldestC, warmestC } = range;
  if (!isFiniteNumber(coldestC) || !isFiniteNumber(warmestC)) return null;
  const coldest = displayFigure('temperature', coldestC, system);
  const warmest = displayFigure('temperature', warmestC, system);
  if (coldest.value === warmest.value) return `${coldest.value} ${coldest.unit}`;
  return `${coldest.value}–${warmest.value} ${warmest.unit}`;
}

/**
 * **What a map site adds up to** — `"4 dives · deepest 18.2 m · 18–24 °C"`, the sentence §3
 * asks the Map tab for when a site is tapped: *"tapping a site shows your dives there with a
 * depth/temp summary"*.
 *
 * **Neither figure is computed here.** The count and the depth come from `logbookStats`
 * (domain/logbookStats.ts) — the same owner the Dives header asks, so "how many dives" cannot
 * mean one thing on one screen and another here — and the temperatures from `waterTempRange`
 * (domain/mapSites.ts). This function owns only the words and the order.
 *
 * **Not `formatLogbookSummary`, and the difference is one figure.** That line is §3's Stats
 * triple — count, hours underwater, deepest — said about a whole logbook. This one is §3's
 * *depth/temp* pair said about one place, so the hours drop out and the water comes in. They
 * are near-duplicates that answer different questions (§4.1), and unifying them would mean one
 * of the two screens showing a figure its own section never asked for.
 *
 * The standing rules of this module both hold: a figure with nothing behind it is **omitted**
 * rather than drawn as a dash (this line reserves no slots, so there is nothing for a dash to
 * sit in), and the count is always present — including `0 dives`, which cannot occur here since
 * a site exists only because a dive is at it, but which is the formatter's rule rather than
 * this caller's luck.
 *
 * **The depth in it takes no band colour**, and the caller's style is where that is enforced
 * (`mapSiteSummary`, theme/styles.ts), exactly as §0.6 requires of the Dives header for the
 * identical reason: `deepest` is an aggregate over the dives at a place, and one band would be
 * a claim about a set no single band is true of.
 *
 * The non-breaking spaces `formatLogbookSummary` sets inside its figures are **deliberately not
 * set here**. That rule exists because the Dives header has a measure — a column capped against
 * a floating capsule — and has to choose where it folds. This line sits in a sheet the full
 * width of the screen with nothing floating over it, so there is no fold to place, and copying
 * the mechanism would be copying a constraint rather than a rule.
 */
export function formatSiteSummary(
  stats: LogbookStats,
  temperatures: WaterTempRange | null,
  system: UnitSystem,
): string {
  const parts: string[] = [formatDiveCount(stats.dives)];

  const deepest = formatDepth(stats.deepestM, system);
  if (deepest !== null) parts.push(`deepest ${deepest}`);

  const water = formatTemperatureRange(temperatures, system);
  if (water !== null) parts.push(water);

  return parts.join(METADATA_SEPARATOR);
}

/**
 * **What the catalogue knows about a site**, as one middot line under its name on the Map
 * tab's community layer — `"Croatia · shore · salt · 24 m"`, or null when the row carries
 * nothing but a name.
 *
 * Every element is one of this module's existing formatters (§4.1: a site's `entry` reads the
 * same word here as on the dive that was logged there), and every one of them is omitted when
 * absent rather than drawn as a placeholder — the same rule `formatSiteSummary` above and
 * `formatCylinderSpec` further down already follow. Null, not `''`, so a caller renders no line
 * at all rather than an empty one: §5 asks a new site only for a name, so a row with nothing
 * else is the *expected* shape rather than a degraded one.
 *
 * The depth is the SITE's own (§6: *"`max_depth_m` (site depth)"*), not any dive's, which is
 * why it comes last and carries no `deepest` — that word belongs to `formatSiteSummary`, where
 * the figure really is the deepest of something.
 */
export function formatSiteFacts(
  site: Pick<DiveSite, 'country' | 'entry' | 'salinity' | 'waterBody' | 'maxDepthM'>,
  system: UnitSystem,
): string | null {
  const parts: string[] = [];
  if (site.country !== null && site.country !== '') parts.push(site.country);

  const entry = formatEntry(site.entry);
  if (entry !== null) parts.push(entry);

  const salinity = formatSalinity(site.salinity);
  if (salinity !== null) parts.push(salinity);

  const waterBody = formatWaterBody(site.waterBody);
  if (waterBody !== null) parts.push(waterBody);

  const depth = formatDepth(site.maxDepthM, system);
  if (depth !== null) parts.push(depth);

  return parts.length === 0 ? null : parts.join(METADATA_SEPARATOR);
}

/** Cylinder pressure, e.g. "208 bar" or "3016 psi" — whole units in both systems. */
export function formatPressure(bar: number | null, system: UnitSystem): string | null {
  if (!isFiniteNumber(bar)) return null;
  const parts = displayFigure('pressure', bar, system);
  return `${parts.value} ${parts.unit}`;
}

/**
 * Review task 7, Important #1: the formatters below close the gap that let
 * `DiveDetailScreen.tsx` build seven fields' worth of unit-suffixed strings
 * itself, inline, bypassing every guard above — and rendering the literal
 * string "NaN" for exactly the input DESIGN.md §10's COERCION CONTRACT
 * requires M1d's form to produce (an empty numeric field reaching the domain
 * as `NaN`, never `0`). Each one is the same `isFiniteNumber` guard the
 * formatters above already use, so a `NaN`, `Infinity`, or wrong-typed value
 * disappears the same way an absent one does, rather than reaching the
 * screen as text. None of these round or clamp beyond what the screen was
 * already doing — this closes WHERE the string is built, not what precision
 * it's built at; that is a separate decision for whoever adds the M1c/M3
 * unit-conversion setting this module's own top docblock already earmarks
 * this file for.
 */

/**
 * A weight belt's load, e.g. "6.5 kg" or "14 lb".
 *
 * Metric stays unrounded, since weighting is often set in half-kilos and a fixed decimal
 * count would render a plain 6 kg as "6.0 kg"; imperial reads to the whole pound, which is
 * finer than that half-kilo and is how weights are cast and stated. Both halves of that
 * decision, and why they are not the same rule, live in `SPECS` (format/units.ts).
 */
export function formatWeight(kg: number | null, system: UnitSystem): string | null {
  if (!isFiniteNumber(kg)) return null;
  const parts = displayFigure('weight', kg, system);
  return `${parts.value} ${parts.unit}`;
}

/**
 * A cylinder's water capacity, e.g. "12 l" or "11.1 l" — unrounded, since a real cylinder
 * size can be fractional.
 *
 * **Litres in both systems, and this is a decision rather than a gap.** The imperial
 * cylinder unit is the cubic foot, which measures the *free gas* a cylinder holds at its
 * working pressure — an "80 cf" cylinder is an 11.1 L one — so l → cf is a different
 * quantity, not a conversion, and it needs a working pressure this app never insists a
 * diver record. §3 lists four pairs and this is one of the reasons it lists four. The same
 * holds for `formatGasUsed` and `formatRmv` below, which are litres of that same gas.
 */
export function formatVolume(litres: number | null): string | null {
  if (!isFiniteNumber(litres)) return null;
  return `${litres} l`;
}

/**
 * Total gas used across every cylinder (derived.ts's `gasUsedLitres`), to the whole litre —
 * unlike `formatVolume` above, this is a computed aggregate rather than a diver-recorded
 * spec, so it gets the same whole-unit treatment `formatPressure` gives an aggregate
 * reading. `gasUsedLitres` itself already guards its own `Number.isFinite`, so this guard
 * is a second, independent line of defence rather than the only one — the same belt-and-
 * braces stance every other formatter in this file takes toward its input.
 */
export function formatGasUsed(litres: number | null): string | null {
  if (!isFiniteNumber(litres)) return null;
  return `${Math.round(litres)} l`;
}

/** Respiratory minute volume, e.g. "18.4 l/min". */
export function formatRmv(litresPerMin: number | null): string | null {
  if (!isFiniteNumber(litresPerMin)) return null;
  return `${litresPerMin.toFixed(1)} l/min`;
}

/** A gas fraction, e.g. "32 %" — O₂ or He content, unrounded. */
export function formatPercent(pct: number | null): string | null {
  if (!isFiniteNumber(pct)) return null;
  return `${pct} %`;
}

/**
 * What a cylinder's two gas fractions are CALLED — the same words on the form a diver fills
 * in and on the detail they land on. `UNNAMED_SITE` above is the precedent: a word shared by
 * two call sites lives here, where §4.1 puts diver-facing text, rather than being retyped at
 * each of them.
 *
 * They arrive because the pair had already drifted, in the same shape and for the same
 * reason as `formatTankMaterial`'s "Steel"/"steel" below: `DiveFormScreen` labelled the
 * fields `O2 %` and `He %` while `DiveDetailScreen` labelled them `O₂` and `He`. One
 * cylinder, four names, one screen apart.
 *
 * **The subscript wins, and the unit moves to the value.** Two separate calls:
 *
 * - `O₂` over `O2` is simply correct typography for a chemical formula, and it is what every
 *   docblock in this tree and DESIGN.md §2.1 itself already write. The form was the only
 *   place spelling it with an ASCII digit.
 * - The `%` leaves the label because a label is a field's NAME and the unit belongs to the
 *   figure — which is what every other numeric field on this same form already does (`Size`
 *   with `l`, `Working pressure` with `bar`, `Max depth` with `m`). So the form's two fields
 *   gain `unit="%"`, which §0.6 draws as the empty field's placeholder and as a muted suffix
 *   beside a filled one. Nothing is lost in the move: the detail screen's value has always
 *   carried its unit through `formatPercent` above, and now the form's does too, so both
 *   screens read `O₂ · 32 %`.
 *
 * Only these two, deliberately, and this is the gap worth naming: roughly twenty-five field
 * labels are still typed out in both screens as bare literals. They agree today, and every
 * one of them is one edit away from being this defect again. Unifying the whole set is a
 * real change with a natural moment attached — i18next (en + cs, §4) has to give every one
 * of them a key, and that is the pass that should place them — so this fixes the pair that
 * actually drifted rather than pre-empting it.
 */
export const O2_LABEL = 'O₂';

/** The other half of the mix, and the other half of the same drift — see `O2_LABEL`. */
export const HE_LABEL = 'He';

/**
 * **The middot this app puts between small facts on one line**, and the one place it is
 * spelled.
 *
 * §0.6 makes it the treatment for a row's metadata — "Time · duration · rating,
 * middot-separated" — and everything that lists facts inline follows it: a dive row's
 * metadata, the detail screen's own inline list, a cylinder's fields, an accessory set. Three
 * of those already said in prose that they were obeying one rule, which is precisely how a
 * rule ends up written five times and changed in four places: the WORDS on either side of this
 * had an owner and the separator between them did not. Found in review, on the two functions
 * that had just been split apart — `formatCylinderSpec` and `formatCylinder` state the same
 * join one line of code apart.
 *
 * The spaces are part of it. `12 l Steel·232 bar` is a different mark from `12 l Steel · 232
 * bar`, and a caller that had to remember to pad it would be the same defect one character
 * over.
 */
export const METADATA_SEPARATOR = ' · ';

/**
 * U+00A0, and it is here so that the one place that needs it can be read (`formatLogbookSummary`,
 * M1m). A middot list is normally set on a line that cannot wrap — a dive row's metadata, a
 * cylinder spec — and the header summary is the exception: §0.6 caps its column at the floating
 * capsule, so the line has a measure and the platform's own line-break rule decides where it
 * folds. This is what takes that decision back: joined into a figure's own spaces it makes the
 * figure one word, so the only places left to break are the separator above.
 *
 * **Named, and written as the escape.** Typed as itself it is one invisible character, identical
 * to a space in every editor and in every diff — which is the one thing a reader of this rule has
 * to be able to see. Both test files import this name for the same reason.
 */
export const NON_BREAKING_SPACE = '\u00A0';

/**
 * The third fraction, which is never stored and never typed — `derived.ts`'s `nitrogenPct`
 * computes it as 100 − O₂ − He (§10). It joins the two above because it is the same kind of
 * string for the same reason: a label for a gas fraction, spelled once so two screens cannot
 * spell it two ways, and subscripted for the same typography rule that made `O₂` beat `O2`.
 */
export const N2_LABEL = 'N₂';

/**
 * A wetsuit or drysuit's neoprene thickness, e.g. "5 mm" — unrounded, since 2.5 mm and
 * 3.5 mm suits are real.
 *
 * **Millimetres in both systems, and that is a decision rather than a gap** — the fourth
 * such decision, alongside `formatDuration`, `formatVolume` and the two litre-based gas
 * figures below it. Neoprene is sold, printed and talked about in millimetres everywhere
 * on earth, so a diver reading "0.2 in" would be reading a number no label has ever
 * carried. `format/units.ts`'s top docblock is where the four are declared together, so
 * that the next reader adding a pair looks there rather than adding a fifth here.
 */
export function formatSuitThickness(mm: number | null): string | null {
  if (!isFiniteNumber(mm)) return null;
  return `${mm} mm`;
}

/**
 * **What kind of cylinder this is, and nothing about what is in it** — `Twinset 12 l Steel ·
 * 232 bar`. The four fields a diver sets once and reuses: rig, size, material, working
 * pressure.
 *
 * Deliberately not `startBar`/`endBar`. Those two are gauge readings: they describe one
 * dive's consumption, not the cylinder, which is why a preset stores neither (DESIGN.md
 * §10) and why a summary of "what kind of cylinder is this" has nothing to say about them.
 * Every field goes through this module's own per-field formatter — `formatVolume`,
 * `formatTankMaterial`, `formatConfiguration`, `formatPressure` — the same ones
 * `DiveDetailScreen`'s `tankFields` reads, so the two screens cannot spell one cylinder two
 * ways. What is decided *here*, and nowhere else, is the order and the separators.
 *
 * **The rig leads the phrase, and it is always shown.** It used to be a multiplier —
 * `2 × 12 l Steel`, from the `count` field M1h removed — and the rule that came with it was
 * that a count of `1` said nothing, because "1 × 12 l Steel" is a word of noise. That rule
 * does not carry over, for two reasons. §10 makes twinset and sidemount *different rigs*
 * that merely imply the same number, so a bare `2 ×` would render both identically and lose
 * exactly the distinction the ruling established; and `single` is a fact the diver chose to
 * record about their rig, not arithmetic — suppressing it would also let a cylinder that
 * records nothing but its rig summarise to nothing at all, silently losing the only thing it
 * has to say. `Twinset 12 l Steel` is how the design's own example preset names ("twin 12
 * steel") already read.
 *
 * **`Single` was re-examined in M1h, once the dive form began showing this line back to the
 * diver, and kept.** The objection is real — `Single 12 l Steel` puts a word in front of the
 * cylinder that most divers would not say out loud — but suppressing it needs a fallback and
 * has no good one: a cylinder that records nothing but its rig would summarise to nothing at
 * all, so the form would draw an empty labelled row for a cylinder that does hold a fact. The
 * example in the paragraph above also read `12 l steel` until M1h and was simply wrong about
 * what this function produces: `formatTankMaterial` capitalises, so the line has always ended
 * `Steel`. Corrected rather than accommodated — if sentence case is wanted it belongs in that
 * formatter, where the material chips read it too.
 *
 * **Exported because the dive form reads back the spec on its own** (M1h, §2.2): the four
 * fields collapse into one row there and expand when a diver wants to correct them on this
 * dive, while the gas and the two pressures stay directly editable beside it — they are
 * per-dive facts, and a summary that restated them would put the same value on screen twice
 * with only one of the two editable. That split is why this is a function rather than a
 * paragraph inside `formatCylinder` below: the whole-cylinder line and the spec-only line are
 * two callers of ONE statement of the order and the separators, not two spellings of it.
 *
 * `null` when the cylinder records no specification at all — including a cylinder holding
 * nothing but gas and gauge readings, which looks full on a form and has no spec to show. A
 * caller shows something else entirely for that (the form shows the fields themselves), so an
 * empty string here would draw a blank line rather than let it.
 */
export function formatCylinderSpec(tank: Tank, system: UnitSystem): string | null {
  const parts: string[] = [];

  // Rig, then size, then material — `Twinset 12 l Steel`, the order a diver names a cylinder
  // in, and the order `tankFields` already lists the fields in one screen over.
  const spec = [formatConfiguration(tank.configuration), formatVolume(tank.sizeL), formatTankMaterial(tank.material)]
    .filter((part) => part !== null)
    .join(' ');
  if (spec !== '') parts.push(spec);

  const working = formatPressure(tank.workingBar, system);
  if (working !== null) parts.push(working);

  return parts.length === 0 ? null : parts.join(METADATA_SEPARATOR);
}

/**
 * One whole cylinder on a single line — `Twinset 12 l Steel · 232 bar · O₂ 32 %`: its
 * specification (`formatCylinderSpec` above) plus the gas in it.
 *
 * The gas is here rather than in the spec because a mix is a fact about **this dive**, not
 * about the cylinder: the same twinset holds air on one dive and 32 % on the next. §3's
 * preset list is the caller that wants both halves — a preset stores a mix (§2.1: "gas mixture
 * per cylinder"), so a chip named "alu 80 nitrox" has to be able to say so.
 *
 * `null` when the cylinder records nothing this line can show, on `formatCylinderSpec`'s own
 * reasoning.
 */
function formatCylinder(tank: Tank, system: UnitSystem): string | null {
  const parts: string[] = [];

  const spec = formatCylinderSpec(tank, system);
  if (spec !== null) parts.push(spec);

  // The two label constants, never bare percentages: a trimix cylinder shows both fractions,
  // and `32 % · 21 %` says which is which to nobody. `O2_LABEL`/`HE_LABEL` exist because
  // exactly these two labels had already drifted between the form and the detail.
  const o2 = formatPercent(tank.o2Pct);
  if (o2 !== null) parts.push(`${O2_LABEL} ${o2}`);
  const he = formatPercent(tank.hePct);
  if (he !== null) parts.push(`${HE_LABEL} ${he}`);

  return parts.length === 0 ? null : parts.join(METADATA_SEPARATOR);
}

/**
 * A whole set of cylinders on one line — what §3's preset list shows under a preset's name
 * (M1e), and the only caller today.
 *
 * **Two separators, because there are two levels.** Fields inside one cylinder are
 * middot-separated, which is §0.6's own treatment for a row's metadata; cylinders are joined
 * with ` + `, which is how a diver writes a bottom mix and a deco gas ("12 l steel + alu 80")
 * and which keeps the middots readable as belonging to the cylinder on their left. One
 * separator for both levels would flatten a two-cylinder preset into an unreadable run.
 *
 * A cylinder that summarises to nothing is dropped rather than joined as a gap, and `null`
 * comes back when none of them had anything to say — `[]` and `[{ every field null }]` are
 * the same claim under §6 ("no cylinders recorded"), so they must produce the same answer.
 */
export function formatCylinders(tanks: readonly Tank[], system: UnitSystem): string | null {
  const summaries = tanks.map((tank) => formatCylinder(tank, system)).filter((part) => part !== null);
  return summaries.length === 0 ? null : summaries.join(' + ');
}

/**
 * The words the three 0–3 condition scales are read in — one table each, and the one place in
 * this module where a per-value table is the right answer rather than the drift `capitalize`'s
 * docblock warns about.
 *
 * The reason is simply that there is no word to capitalise: the stored value is an integer, so
 * *something* has to say that a waves 2 is "Medium". What the tables are not is a second
 * vocabulary — `CONDITION_SCALE_VALUES` (domain/types.ts) is still the source of which levels
 * exist, and `Record<ConditionLevel, string>` makes TypeScript demand a word for every one of
 * them, so widening that list is a compile error here until somebody names the new level. That
 * is §4.1's "derive, or tie at compile time" doing the work a shared `capitalize` does for the
 * string vocabularies.
 *
 * **Three tables, not one, and the differences are the point.** Level 0 is *Flat* water and
 * *no* current; level 1 is a *Small* wave, a *Light* current and *Some* surge. A single shared
 * scale would have to pick one wording and be wrong about two subjects — and these words are
 * what a diver actually says, which is the whole reason §0.6 stopped asking them to type a
 * digit.
 *
 * M1h added these. Until then the three fields were text boxes and this module rendered the
 * bare number back (`formatConditionScale`), which was honest while the diver typed the digit
 * themselves and became a small lie the moment they picked a chip saying "Small" — pick a
 * word, read back a number, which is the `Steel`/`steel` drift §4.1 opens with, one screen
 * apart. So both screens go through these.
 */
const WAVES_LABELS: Record<ConditionLevel, string> = { 0: 'Flat', 1: 'Small', 2: 'Medium', 3: 'Large' };
const CURRENT_LABELS: Record<ConditionLevel, string> = { 0: 'None', 1: 'Light', 2: 'Medium', 3: 'Strong' };
const SURGE_LABELS: Record<ConditionLevel, string> = { 0: 'None', 1: 'Some', 2: 'Medium', 3: 'Strong' };

/**
 * One level of one 0–3 scale, in words — **or the bare number when it is not a level at all**.
 *
 * That fallback is the load-bearing half and it is DESIGN.md §10's rule, not a defensive
 * habit: there is no CHECK constraint on these columns, so M2 sync can deliver a `waves: 7`
 * from a client with a wider scale, and "a value outside the expected range is saved and can
 * be flagged; it is not refused". A formatter that returned `null` for it would delete the
 * value from the screen — the dive detail omits a row whose formatter says null — so a number
 * this build has no word for is shown **as the number it is**. The diver sees that something
 * unusual is recorded rather than seeing nothing at all.
 *
 * Rounded values are not coerced to the nearest level either: `1.5` renders "1.5", because
 * inventing "Small" for it would be this module deciding what a diver meant.
 */
function formatConditionLevel(value: number | null, labels: Record<ConditionLevel, string>): string | null {
  if (!isFiniteNumber(value)) return null;
  return labels[value as ConditionLevel] ?? `${value}`;
}

/** The sea state, e.g. "Small" — level 0 is *Flat*, which is a real reading and not "nothing
 * recorded"; an unrecorded scale is `null` and produces no row at all. */
export function formatWaves(value: number | null): string | null {
  return formatConditionLevel(value, WAVES_LABELS);
}

/** The current, e.g. "Light". Level 0 is *None* — the diver looked and there was none, which
 * is worth recording and is not the same as never having looked. */
export function formatCurrent(value: number | null): string | null {
  return formatConditionLevel(value, CURRENT_LABELS);
}

/** The surge, e.g. "Some" — the back-and-forth a swell pushes through a site, which is why
 * §0.6 draws its mark with two-way arrows where the current's point one way. */
export function formatSurge(value: number | null): string | null {
  return formatConditionLevel(value, SURGE_LABELS);
}

/** A dive site's GPS position, e.g. "50.12345, 14.56789". Null unless BOTH coordinates are
 * real — a lone latitude or longitude isn't a point a diver could read, so a finite
 * latitude paired with a non-finite longitude (or vice versa) omits the row entirely
 * rather than rendering half of it. */
export function formatCoordinates(latitude: number | null, longitude: number | null): string | null {
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null;
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/** A dive's star rating, e.g. "4 / 5". DESIGN.md §10 keeps `rating` as `number | null`
 * rather than a `1|2|3|4|5` literal union — a future client can still deliver an
 * out-of-range value — so this only guards finiteness; clamping the *displayed marks* to a
 * legal range is `DiveRow.tsx`'s `filledDotCount`, not this module's job. */
export function formatRating(rating: number | null): string | null {
  if (!isFiniteNumber(rating)) return null;
  return `${rating} / 5`;
}

/**
 * Minutes on the surface, in a shape a diver would actually read (review task 7, Important
 * #2). Below an hour, a plain minute count is the natural reading — the same judgement
 * `formatDuration` makes for a dive itself. At or above an hour it switches to hours (and,
 * unless they're exactly zero, minutes): "22 h 20 min" reads as roughly a day; "1340 min"
 * does not, even though it is the same number. `derived.ts`'s `surfaceIntervalMin` already
 * refuses anything a day or over, so this never has to decide what a multi-day gap should
 * look like — by the time a value reaches here it is always under 24 h.
 *
 * Deliberately its own formatter rather than a call to `formatDuration`: that function's
 * own docblock records the opposite decision for a dive's own duration ("renders an
 * hour-plus dive in minutes, which is how divers log it") — a 72-minute dive is not the
 * same kind of number as a 1340-minute gap between two dives, and conflating them would
 * make one of the two read wrong.
 */
export function formatSurfaceInterval(minutes: number | null): string | null {
  if (!isFiniteNumber(minutes) || minutes < 0) return null;
  return hoursAndMinutes(minutes);
}

/**
 * The shape rule the two spans above and below share: minutes on their own under an hour,
 * hours and minutes at or over one, and the minutes dropped when they are exactly zero.
 *
 * Private, and written once, because `formatSurfaceInterval` and `formatTimeUnderwater` are
 * two questions with one answer about how a span of minutes is read. They are separate
 * exported names because they are separate questions — see `formatTimeUnderwater` — but a
 * second copy of this arithmetic is how "22 h 20 min" and "22h20" end up one screen apart
 * (§4.1). Takes a real, finite, non-negative number: each caller applies its own guard first,
 * because what counts as an impossible value differs between them and only they can say.
 */
function hoursAndMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

/**
 * **§3's "hours underwater"** — a whole logbook's bottom time, e.g. "96 h 12 min"
 * (`logbookStats`, domain/logbookStats.ts).
 *
 * Minutes in both systems, exactly as `formatDuration` is: a dive is 47 minutes long wherever
 * it is dived, and a hundred of them are a hundred of them.
 *
 * **Its own name over `formatSurfaceInterval`'s shared arithmetic**, which is the pairing
 * §4.1's "a deliberate near-duplicate names its siblings" describes. They answer different
 * questions about different quantities — a gap between two dives, bounded under a day by
 * `surfaceIntervalMin`, against an unbounded career total — and a call site reading
 * `formatSurfaceInterval(stats.minutes)` under the Dives title would be naming the wrong
 * fact. What they must not do is *disagree about the shape*, and one `hoursAndMinutes` is
 * what makes that impossible rather than merely tested.
 *
 * `null` for a total nothing contributed to (`LogbookStats.minutes`), so the caller omits the
 * figure rather than printing "0 min" under a list of real dives that simply never had their
 * durations written down.
 */
export function formatTimeUnderwater(minutes: number | null): string | null {
  if (!isFiniteNumber(minutes) || minutes < 0) return null;
  return hoursAndMinutes(minutes);
}

/**
 * **The line under the Dives large title** (§0.6) — `128 dives · 96 h 12 min · deepest 41.2 m`
 * — and the one place §3's three Stats figures become words.
 *
 * Every piece comes from the owner that already has it: `formatDiveCount` for the count,
 * `formatTimeUnderwater` for the span, `formatDepth` for the depth (so the figure follows the
 * diver's m/ft exactly as every other depth in the app does — §4.1, and never a second
 * conversion written here), and `METADATA_SEPARATOR` for the middots. What is decided *here*
 * is the order, the word "deepest", and which figures appear at all.
 *
 * **A figure with nothing behind it is omitted, not drawn as an em dash.** That is this
 * module's standing rule — see its top docblock: a formatter returns null "so it can omit the
 * element entirely, never a placeholder like '— m'" — and it is what every other middot list
 * in the app already does (`formatCylinderSpec`, `formatEquipment`, a dive row's metadata).
 * The em-dash convention the form and the dive row use is for a **labelled row**, which is
 * drawn whether or not it holds a value and therefore needs something in the slot; this line
 * reserves no slots. So a logbook whose dives record no durations reads `28 dives · deepest
 * 18.0 m`, and one that records nothing at all reads `28 dives`.
 *
 * **The count is always present**, including `0 dives`. On the empty logbook that line is not
 * decoration: it is the whole of what tells "the logbook has been read and holds nothing"
 * apart from "the logbook has not answered yet" (§10, M1h), so it may never be the figure that
 * drops out. It also states something true and easy to miss on a logbook holding nothing but
 * plans — `0 dives` over an "Up next" section, because §2.4 says a plan is not one yet.
 *
 * The depth takes **no band colour**, and the caller's style is where that is enforced (§0.6's
 * `divesSummary`). §0.1 makes colour encode depth and §0.6 makes a dive's depth the anchor of
 * its row — but this figure is an aggregate over a whole logbook, and a single band colour
 * would be a claim about a set no one band is true of.
 *
 * **This line is the one in the app that WRAPS, so it is also the one that has to say where**
 * (M1m). §0.6 caps the Dives header's column at the floating capsule's leading edge, which is
 * about 253 pt on an iPhone 17 Pro — the sheet's own `128 dives · 96 h 12 min · deepest 41.2 m`
 * needs 276, so it takes two lines, and the sheet draws them as `128 dives · 96 h 12 min ·`
 * above `deepest 41.2 m`. Left to ordinary spaces it does not break there: the wrap lands
 * wherever the width runs out, which was seen on the simulator as `… · deepest 41.2` above a
 * line holding nothing but `m`, and one word earlier at the sheet's own example. Either way a
 * figure loses its unit or its label, which is a worse line than the one the cap prevents.
 *
 * So **a figure is one unbreakable unit and the middots are the only break opportunities**:
 * every space INSIDE a figure is U+00A0, and `METADATA_SEPARATOR`'s are left ordinary. That is a
 * rule about the line rather than about any one string, so it holds for `1 dive · 47 min`, for
 * feet, and for §0.5's Czech, which is 20–30 % longer and is the case that wraps first.
 *
 * It belongs here rather than in `formatDiveCount` and friends because those figures are read
 * inside rows that do not wrap, where a non-breaking space would be an invisible difference
 * with no consequence — and §4.1's rule is that a shared owner keeps the shared meaning. What
 * is specific to the header is that the line has a measure.
 */
export function formatLogbookSummary(stats: LogbookStats, system: UnitSystem): string {
  const parts: string[] = [formatDiveCount(stats.dives)];

  const underwater = formatTimeUnderwater(stats.minutes);
  if (underwater !== null) parts.push(underwater);

  const deepest = formatDepth(stats.deepestM, system);
  if (deepest !== null) parts.push(`deepest ${deepest}`);

  return parts.map((figure) => figure.replace(/ /gu, NON_BREAKING_SPACE)).join(METADATA_SEPARATOR);
}

/**
 * What a dive is called when it has no name of its own. Exported so `groupIntoTrips`
 * (domain/trips.ts) can title an unplaced TRIP with the same words a row uses for an
 * unplaced dive — the words are shared; the rules that reach them are not (see below).
 */
export const UNNAMED_SITE = 'Unnamed site';

/**
 * What a dive is CALLED on screen: its site, or its centre when no site was recorded, or
 * `UNNAMED_SITE` when it has neither. The single owner of that choice — `DiveRow.tsx`'s
 * site line, `DiveDetailScreen.tsx`'s hero heading, and anything added later.
 *
 * This exists because the two call sites each answered it themselves and had already
 * drifted: the row showed "Unnamed site" for a dive with no site name while that same
 * dive's detail page rendered no title at all, so a diver could tap a named row and land on
 * a heading-less screen. Neither may keep its own copy.
 *
 * Site first, because that is the name a diver recognises a dive by — "Blue Hole", not the
 * shop that took them there. Always a string, never null: a row or a hero with no heading
 * is a blank line, which is the defect itself.
 *
 * Deliberately NOT the same rule as `tripKeyOf` (domain/trips.ts), which is centre-first
 * and may be null. That one is a grouping KEY, where the centre is what stays constant
 * across a trip's several sites and where "no place recorded" has to stay distinguishable
 * from every real place — a key that fell back to these words would merge unplaced dives
 * with any dive someone actually named "Unnamed site". This one is a display LABEL that
 * must always produce text. The two look similar and answer different questions; do not
 * "unify" them.
 */
export function diveSiteLabel(dive: Pick<Dive, 'siteName' | 'centerName'>): string {
  return dive.siteName ?? dive.centerName ?? UNNAMED_SITE;
}

/**
 * How many dives, as a phrase: "1 dive", "3 dives". The single owner of that singular/plural
 * choice, because there are two callers for it — the "Up next" header's trailing slot
 * (TripHeader.tsx) and a day strip's own sentence (DayStrip.tsx, "18 Aug 2026 · 2 dives, no
 * times") — and the strip previously carried an inline copy. English needs one comparison;
 * Czech (i18next, en + cs, a later milestone) needs three forms and does not split on
 * `=== 1`, so a second copy would be a second place to find and fix.
 *
 * Takes and returns non-null, unlike every formatter above: `count` is something the app
 * counts (an array length), never a nullable field read back out of the database, so there
 * is no absent case to thread through. The guards above exist for stored values; this has
 * none.
 */
export function formatDiveCount(count: number): string {
  return `${count} ${count === 1 ? 'dive' : 'dives'}`;
}

/**
 * How many places, as a phrase: "1 site", "3 sites" — `formatDiveCount`'s sibling above, and
 * private because both callers are the two Map tab lines directly below it. English needs one
 * comparison and Czech needs three forms (§0.5, i18next in M3), which is the whole reason a
 * plural lives in this module rather than in a template literal on a screen.
 */
function formatSiteCount(count: number): string {
  return `${count} ${count === 1 ? 'site' : 'sites'}`;
}

/**
 * **The line under the Map tab's title while it is showing the diver's own dives** — `"Your
 * dives · 3 sites · 7 of 24 dives on the map"`.
 *
 * It has two jobs and the second is the one that makes it a rule rather than a nicety.
 *
 * **It says which layer is showing**, because §3's toggle is a single glyph in the top-right
 * capsule and a glyph cannot report a state. §0.1 leaves no hue to say it with and §0.6 has
 * already refused a second size or weight for one control, so the layer is named in words, in
 * the line the screen was going to draw anyway.
 *
 * **And it says how much of the logbook is actually on the map**, which is the honest half.
 * §10 records that no dive logged before M2l can carry a GPS point, so the ordinary state of
 * this screen for a while is a handful of pins over a logbook of dozens — and a map that
 * silently drew four sites from twenty-four dives would look like a map of everything.
 *
 * **"on the map", not "pinned", and the words are not interchangeable.** The figure counts every
 * dive at a place the map could position, including dives at that place carrying no coordinates
 * of their own — which is exactly what the badges add up to (`groupDivesByPlace`, domain/
 * mapSites.ts: a site's badge counts your dives there, not your fixes there). Calling them
 * "pinned" would make this line disagree with the numbers drawn beside it.
 *
 * `formatDiveCount` owns both plurals; nothing here counts anything.
 */
export function formatMyDivesSummary(places: number, onMap: number, logged: number): string {
  const coverage = onMap < logged ? `${onMap} of ${formatDiveCount(logged)} on the map` : `${formatDiveCount(onMap)} on the map`;
  return ['Your dives', formatSiteCount(places), coverage].join(METADATA_SEPARATOR);
}

/**
 * The same line while the toggle is showing §3's *"all community sites"* — `"Community · 12
 * sites"`.
 *
 * Shorter than its sibling above because there is less that is true: the catalogue's sites are
 * not the diver's, so there is no coverage figure to give and nothing to say about how much of
 * anything is on the map. It names the layer, which is the job the toggle cannot do, and counts
 * what is drawn.
 *
 * A separate function rather than one taking a layer, so neither line can grow a branch that
 * silently reports the wrong layer's figure — the shapes of the two answers are genuinely
 * different, and a shared signature would have to carry two arguments one of them ignores.
 */
export function formatCommunitySummary(places: number): string {
  return ['Community', formatSiteCount(places)].join(METADATA_SEPARATOR);
}

/**
 * §7.5's quiet indicator, in words: "3 changes waiting to sync", or **null when there is
 * nothing waiting**.
 *
 * Null rather than "0 changes waiting to sync", which is this module's standing rule (a figure
 * with nothing behind it is omitted, never drawn as a placeholder) and is also what makes the
 * indicator quiet: on a device that is up to date there is no line at all, so the only thing
 * the diver ever sees here is a fact worth their attention.
 *
 * **"changes", not "dives", and the word is load-bearing.** The count is rows across all four
 * synced tables (`cloud/sync.ts`), so a cylinder preset and a site created on the boat are in
 * it. §7.4's adoption sentence goes the other way — it counts *dives* and says so — for the
 * matching reason: a number that says "dives" must be dives. Saying "3 dives waiting" over a
 * count that includes a preset would be a sentence a diver could go and disprove.
 *
 * Nothing here says *why* they are waiting, and that is deliberate: a diver on a boat is not
 * being told about a failure (§1, "sync failures never block logging"), they are being told
 * what is true — the account has not got these yet, and it will.
 */
export function formatPendingChanges(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'change' : 'changes'} waiting to sync`;
}

const MONTH_NAMES: readonly string[] = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * A dive's `date` for display, e.g. "16 Aug 2026".
 *
 * Deliberately never hands the stored string to `new Date()`. A bare
 * `new Date('2026-01-01')` parses as UTC midnight, and in any timezone
 * west of Greenwich `toLocaleDateString` on that value renders 31 Dec
 * 2025 — a real dive silently moved to the wrong year on screen. This
 * instead reads the year, month, and day back out of the string itself,
 * which sidesteps the problem entirely rather than working around it:
 * there is no Date object built from the stored value, so there is
 * nothing for a timezone (or locale/ICU support on-device) to shift.
 *
 * `date` is required on every dive (DESIGN.md §6) and the write boundary
 * in db/dives.ts canonicalises it before it is ever stored, but this is
 * the display boundary, not that one — it does not get to assume the
 * value in front of it is clean (a hand-edited row, a future migration).
 * isCalendarDate, datetime.ts's single owner of what a valid date string
 * looks like, is what actually decides that; an uninterpretable value is
 * handed back unchanged rather than an invented date, the same
 * never-block-never-invent stance datetime.ts itself takes at the write
 * boundary.
 */
export function formatDiveDate(date: string): string {
  if (!isCalendarDate(date)) return date;
  const [yearStr, monthStr, dayStr] = date.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const monthName = Number.isInteger(month) ? MONTH_NAMES[month - 1] : undefined;
  // isCalendarDate has already proven `date` names a real calendar date in
  // canonical YYYY-MM-DD form, so this split always yields three integers
  // and month is always 1-12 in practice. The guard below doesn't lean on
  // that holding after some future edit to either function — same
  // reasoning datetime.ts itself gives for re-checking Number.isInteger
  // after a regex that already looks like it guarantees it.
  if (!Number.isInteger(year) || !Number.isInteger(day) || monthName === undefined) return date;
  return `${day} ${monthName} ${year}`;
}

/**
 * Entry time and computed exit, e.g. "09:30 – 10:14" (en dash). Delegates
 * the exit-time arithmetic to derived.ts's timeOut rather than
 * recomputing it — see that module for why a duration of a day or more
 * refuses instead of wrapping into a plausible-looking clock time.
 */
export function formatTimeRange(timeIn: string | null, durationMin: number | null): string | null {
  if (timeIn === null) return null;
  const exit = timeOut(timeIn, durationMin);
  return exit === null ? timeIn : `${timeIn} – ${exit}`;
}

/**
 * Categorical fields — entry, salinity, water body, cylinder material, rig configuration,
 * weather, visibility, suit, weighting feel and each equipment token — are stored
 * as the closed lowercase vocabulary `domain/types.ts` declares: the database's vocabulary,
 * not the diver's. This
 * module is the one other place a stored value becomes a displayed string in this app, so
 * that's where these live too, rather than each screen capitalising inline.
 *
 * Every member of those unions is a single lowercase word, so one shared
 * capitalise-first-letter helper covers all of them — no per-value table that could fall
 * out of sync as a union grows a new member; a new value just capitalises like the rest.
 * That is why M1h's five new vocabularies cost this file ten lines rather than five tables.
 * English-only, like every other string this file returns: the app has no i18n framework
 * yet (a later milestone), so this is not a translation boundary.
 */
function capitalize<T extends string>(value: T): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** How the diver entered the water, e.g. "Shore". */
export function formatEntry(entry: Entry | null): string | null {
  return entry === null ? null : capitalize(entry);
}

/** The water's salinity, e.g. "Fresh". Two values since M1h — `brackish` went (§10). */
export function formatSalinity(salinity: Salinity | null): string | null {
  return salinity === null ? null : capitalize(salinity);
}

/** The kind of water body, e.g. "Quarry". */
export function formatWaterBody(waterBody: WaterBody | null): string | null {
  return waterBody === null ? null : capitalize(waterBody);
}

/**
 * The rig a cylinder is part of, e.g. "Twinset".
 *
 * The replacement for `formatCount`, which M1h deleted with the `count` field it formatted.
 * A rig is a name, not a number, so this joins the capitalising family above rather than
 * keeping the numeral formatter's shape — and `formatCylinder` above records what that
 * changed about the cylinder summary line.
 */
export function formatConfiguration(configuration: Configuration | null): string | null {
  return configuration === null ? null : capitalize(configuration);
}

/**
 * The weather above the dive, e.g. "Cloudy".
 *
 * **No special case for any member, and that is the point.** This function used to carry a
 * paragraph explaining that `partly` renders as "Partly" — half a phrase, since a diver means
 * *partly cloudy* — and that the chip row supplied the missing word by having "Cloudy" beside
 * it. The explanation was sound and the conclusion was wrong: a value that only means
 * something because of what stands next to it means nothing when it is read back alone, in a
 * search result, or by a screen reader. §10 changed the SCALE rather than teaching the
 * formatter a lookup table for one string — `cloudy` and `overcast` are the two cloud levels
 * now, both single words that mean themselves. The vocabulary is the source
 * (`WEATHER_VALUES`, domain/types.ts); nothing about the weather is decided here.
 */
export function formatWeather(weather: Weather | null): string | null {
  return weather === null ? null : capitalize(weather);
}

/**
 * The visibility a diver judged, e.g. "Average" — the scale, not `visibilityM`'s distance.
 *
 * Two formatters for one subject, and §10 records that as intended rather than as a
 * duplicate: nobody measures visibility, so the scale is the primary and the metres are an
 * optional refinement. `formatDepth` is what renders the other half.
 */
export function formatVisibility(visibility: Visibility | null): string | null {
  return visibility === null ? null : capitalize(visibility);
}

/** The exposure suit worn, e.g. "Semidry". */
export function formatSuit(suit: Suit | null): string | null {
  return suit === null ? null : capitalize(suit);
}

/**
 * How the weighting felt, e.g. "Over" — the judgement beside `weightsKg`'s number, and the
 * sharper of §10's two number-plus-judgement pairs: "6 kg" means nothing on its own, and
 * "6 kg, and I was over" is the fact a diver uses to dial in the next dive.
 */
export function formatWeightsFeel(weightsFeel: WeightsFeel | null): string | null {
  return weightsFeel === null ? null : capitalize(weightsFeel);
}

/**
 * The accessory set on one line, e.g. "Hood · Gloves · Torch".
 *
 * A middot list because that is this app's own separator for a sequence of small facts
 * (§0.6's row metadata, and `formatCylinder` above for the fields of one cylinder), and
 * each token capitalises through the same shared `capitalize` every other categorical value
 * does — never a per-value table.
 *
 * **Rendered in the array's own order rather than re-sorted into `EQUIPMENT_VALUES` order.**
 * The form writes the vocabulary's order already (`DiveFormScreen`), so in practice the two
 * coincide; imposing it here as well would be a second owner of that order, and would also
 * quietly reorder a row written by some other client into a claim about what that client
 * recorded.
 *
 * `null` for an empty set, exactly as every formatter above returns `null` for an absent
 * value — `[]` means "no accessories recorded" (§6), and a caller that got `''` would draw
 * a labelled row with nothing in it.
 */
export function formatEquipment(equipment: readonly Equipment[]): string | null {
  if (!Array.isArray(equipment) || equipment.length === 0) return null;
  return equipment.map((token) => formatEquipmentToken(token)).join(METADATA_SEPARATOR);
}

/**
 * One accessory on its own, e.g. "Torch" — what the form's per-token chip is labelled.
 *
 * Separate from `formatEquipment` above because the two answer different questions: that one
 * names a whole recorded set for a detail row, this one names a single member for a control
 * the diver is about to press. `formatEquipment` is written in terms of this rather than
 * capitalising a second time, so the word a chip offers and the word the detail reads back
 * are the same string by construction — the `Steel`/`steel` drift `formatTankMaterial`
 * records is exactly this failure between exactly these two screens.
 *
 * Never null, unlike its siblings: a token is a member of a set, so there is no "no value"
 * case for it to report.
 */
export function formatEquipmentToken(token: Equipment): string {
  return capitalize(token);
}

/**
 * What a cylinder is made of, e.g. "Steel".
 *
 * The fifth member of the set above, and it arrives late because the rule was written
 * twice and had **already drifted on screen**: `DiveFormScreen`'s option chips carried a
 * private `materialLabel` that produced "Steel"/"Alu", while `DiveDetailScreen` rendered
 * the raw stored `tank.material` — so the same cylinder read "Steel" on the form a diver
 * had just filled in and "steel" on the detail page they landed on. `TankMaterial` is the
 * same closed lowercase vocabulary as `Entry`/`Salinity`/`WaterBody`/`Suit`, the module's
 * own docblock above already claims this file is where a stored value becomes a displayed
 * string, and one shared `capitalize` covers it exactly as it covers the other four.
 */
export function formatTankMaterial(material: TankMaterial | null): string | null {
  return material === null ? null : capitalize(material);
}

/**
 * A dive's status, "Logged" or "Planned". Unlike the four formatters above, `status` is
 * never null (domain/types.ts: the one exception alongside `id` and `date`), so this takes
 * and returns a plain string rather than threading a null case that can't occur.
 */
export function formatDiveStatus(status: DiveStatus): string {
  return capitalize(status);
}

/**
 * The diver's unit system, "Metric" or "Imperial" — the words the Settings screen (§3) puts
 * on its two chips.
 *
 * It lands here rather than in `format/units.ts` because the split §4.1 draws between the
 * two modules is *what number and which word* versus *what string a diver reads*, and this
 * is the second of those: `unitLabel` one file over answers "what does depth call itself in
 * imperial" (`ft`), which is a fact about the pair; "Imperial" is a name for the system
 * itself, shown to a person choosing between them and to nothing else. Putting it there
 * would also make that module the owner of two different kinds of string.
 *
 * `capitalize`, like the five formatters above it, rather than a two-entry lookup table:
 * `UnitSystem`'s members are single lowercase words exactly as `Entry`'s and `Suit`'s are,
 * and a table would be a second list to keep in step with `UNIT_SYSTEMS` — §4.1's
 * "derive, or tie at compile time". A third system added there would capitalise like the
 * other two instead of silently rendering nothing.
 *
 * Never null: `readUnitSystem` (db/settings.ts) degrades an absent or unreadable preference
 * to `DEFAULT_UNIT_SYSTEM`, so there is no "no system chosen" state for this to describe.
 */
export function formatUnitSystem(system: UnitSystem): string {
  return capitalize(system);
}

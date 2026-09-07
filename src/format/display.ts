import type { ExpiryState } from '../domain/certifications';
import { timeOut } from '../domain/derived';
import { isCalendarDate } from '../domain/datetime';
// **A type, and `import type` is what keeps that true.** `domain/logbookStats.ts` imports
// `isDisplayableDepth` from this module — the app's one owner of "can this depth be shown" —
// so a value import back the other way would be a real runtime cycle. This specifier is erased
// at compile time, which is exactly what the two modules' split requires: the figures are
// computed there and worded here, and only the shape of the answer crosses.
import type { LogbookStats, RmvTrend } from '../domain/logbookStats';
// A type, on the same terms and for the same reason as `LogbookStats` above: `domain/
// mapSites.ts` imports `diveSiteLabel` from this module (a map place is called what a dive row
// calls it), so only the shape of its answer may come back the other way.
import type { WaterTempRange } from '../domain/mapSites';
import {
  CONDITION_SCALE_VALUES,
  CONFIGURATION_VALUES,
  ENTRY_VALUES,
  EQUIPMENT_VALUES,
  SALINITY_VALUES,
  SUIT_VALUES,
  TANK_MATERIAL_VALUES,
  VISIBILITY_VALUES,
  WATER_BODY_VALUES,
  WEATHER_VALUES,
  WEIGHTS_FEEL_VALUES,
  type Certification,
  type ConditionLevel,
  type Configuration,
  type Dive,
  type DiveCenter,
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
import { t, type TranslationKey } from '../i18n';
import {
  displayFigure,
  displayNumber,
  figureText,
  UNIT_SYSTEMS,
  unitLabel,
  type UnitSystem,
} from './units';

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
 * a suit's thickness is millimetres in both, and a cylinder's water
 * capacity is litres in both — see `format/units.ts`'s top docblock,
 * which states what each of the three is not a conversion of. **Gas used
 * and RMV were on that list until M3 and should not have been**: both are
 * free gas at surface pressure, which is exactly what a cubic foot
 * measures, so both take `system` like every other convertible figure.
 * That docblock carries the correction and its one caveat.
 *
 * **The language is not a parameter, and that is the one asymmetry with the unit system.**
 * Every word below is looked up (`t`, src/i18n) rather than spelled here; the unit system is
 * threaded because two callers on one screen may legitimately want different units, and a
 * language has exactly one answer for the whole app at any instant. See src/i18n's own
 * docblock for the argument and for what a component has to do to notice a change.
 *
 * What did NOT move is the ownership. This module is still the only place a stored value
 * becomes diver-facing text; a screen that reached for `t('vocabulary.salinity.fresh')` itself
 * would be the second owner §4.1 exists to prevent, and nothing would fail.
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
  const from = figureText(displayNumber('depth', fromM, system));
  if (toM === null) return `${from}+ ${unitLabel('depth', system)}`;
  return `${from}–${figureText(displayNumber('depth', toM, system))}`;
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
  return `${figureText(displayNumber('depth', metres, system))} ${unitLabel('depth', system)}`;
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
  if (deepest !== null) parts.push(t('figure.deepest', { depth: deepest }));

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
 * diver record.
 *
 * **`formatGasUsed` and `formatRmv` below no longer share that decision** (M3), and the split
 * is the point rather than an inconsistency: this figure is a cylinder's *water capacity*, and
 * those two are the *free gas* `derived.ts` computes from it — the very quantity a cubic foot
 * measures. So one takes a `system` and one does not, one file apart, and `format/units.ts`
 * classifies `sizeL` as `null` beside a `gasVolume` pair to keep them from being confused.
 */
export function formatVolume(litres: number | null): string | null {
  if (!isFiniteNumber(litres)) return null;
  return `${figureText(litres)} l`;
}

/**
 * Total gas used across every cylinder (derived.ts's `gasUsedLitres`), to the whole unit —
 * `"2382 l"`, `"84 cu ft"`. Unlike `formatVolume` above, this is a computed aggregate rather
 * than a diver-recorded spec, so it gets the same whole-unit treatment `formatPressure` gives
 * an aggregate reading, and unlike `formatVolume` it **converts**: `gasUsedLitres` is
 * `Δbar × sizeL × count`, litres of free gas at surface pressure, which is the quantity a
 * cubic foot measures rather than the water capacity it is computed from.
 *
 * `gasUsedLitres` itself already guards its own `Number.isFinite`, so this guard is a second,
 * independent line of defence rather than the only one — the same belt-and-braces stance every
 * other formatter in this file takes toward its input.
 */
export function formatGasUsed(litres: number | null, system: UnitSystem): string | null {
  if (!isFiniteNumber(litres)) return null;
  const parts = displayFigure('gasVolume', litres, system);
  return `${parts.value} ${parts.unit}`;
}

/**
 * Respiratory minute volume — `"18.4 l/min"`, `"0.65 cu ft/min"`.
 *
 * **The figure that was still reading `l/min` to a diver who had asked for feet and pounds**,
 * found in M3 and pre-existing since the Stats screen first drew it. §3 promises units follow
 * the diver and §4.1 gives this module the question *what does a diver see*; RMV escaped both
 * because `format/units.ts` had grouped it with a cylinder's size, whose imperial counterpart
 * genuinely is a different quantity. It is not one here: an RMV is free gas at surface pressure
 * per minute, so `l/min → cu ft/min` is one exact factor, and an imperial diver's own name for
 * this number is a surface air consumption in cubic feet per minute.
 *
 * Two decimals in imperial against one in metric, because a cubic foot is 28 litres and a
 * single decimal would draw the whole 12–22 l/min band real divers occupy as `0.6`; the pair's
 * own spec (`SPECS`, format/units.ts) carries the argument and both precisions.
 */
export function formatRmv(litresPerMin: number | null, system: UnitSystem): string | null {
  if (!isFiniteNumber(litresPerMin)) return null;
  const parts = displayFigure('gasRate', litresPerMin, system);
  return `${parts.value} ${parts.unit}`;
}

/**
 * **§3's *"RMV trend"* said as a direction** — `"down from 16.1 l/min"`, `"up from 13.9 l/min"`,
 * or `"steady"` — and `null` when there is no earlier window to compare against, in which case
 * the caller draws no trend at all rather than a sentence about one dive.
 *
 * §3 asks for *counters first, charts later*, so the whole trend is a word and the figure it
 * moved from. Both are worth stating: "down" alone is a claim a diver cannot check, and the
 * previous mean is the number that makes it one they can.
 *
 * **"steady" is decided on the FORMATTED figures, not on the raw ones**, and that is the only
 * interesting line here. `rmvTrend` (domain/logbookStats.ts) returns two exact means, and two
 * means over real dives are essentially never equal — so a raw comparison would print "up from
 * 14.8 l/min" beside a current figure also reading `14.8 l/min`, which is a line arguing with
 * itself. Comparing what `formatRmv` will actually draw makes the rule exactly "the trend says
 * a direction only when the app can show the difference", and it cannot contradict the row
 * above it however that formatter's precision changes.
 *
 * **That is why `system` is threaded here rather than a metric comparison being reused** (M3).
 * The two pairs read to different precisions — one decimal of a litre, two of a cubic foot —
 * so the boundary at which a difference becomes visible genuinely sits in a different place in
 * each system, and a pair that says "steady" to a metric diver may say "down from 0.61 cu ft/min"
 * to an imperial one. `formatTemperatureRange` above already settled that shape for the °C/°F
 * pair: the figures a diver *reads* are the ones that may or may not differ, and this row must
 * agree with the row above it in the system it is actually drawn in, not in the stored one.
 *
 * **The words are neutral on purpose.** A lower RMV is the one every diver is working toward,
 * and this deliberately does not say "better": §1's never-shame-the-form stance is about not
 * grading a diver's data, and a dive that was cold, over-weighted or spent towing a student is
 * a bigger RMV for a good reason. The figure moved; that is all the app knows.
 *
 * **The two means and nothing else** (M3d). `RmvTrend` also carries the recent window's own
 * values, because the Stats screen draws them; this sentence is about where the figure moved
 * from and reads neither the series nor its length, so it asks for the pair it uses — the
 * `Pick` this file's own callers already take, and what keeps a fixture in its test from
 * having to invent five dives to format one word.
 */
export function formatRmvTrend(
  trend: Pick<RmvTrend, 'recent' | 'previous'>,
  system: UnitSystem,
): string | null {
  if (trend.previous === null) return null;
  const before = formatRmv(trend.previous, system);
  const now = formatRmv(trend.recent, system);
  if (before === null || now === null) return null;
  if (before === now) return t('trend.steady');
  return trend.recent < trend.previous
    ? t('trend.down', { before })
    : t('trend.up', { before });
}

/**
 * **What "recent" means, in the diver's own dives** — `"Averaged over the last 5 dives with gas
 * recorded."`
 *
 * The window is a judgement (`RMV_WINDOW`, domain/logbookStats.ts) and an RMV figure with an
 * unstated window is unreadable: five dives and fifty answer different questions, and a diver
 * comparing this month's figure with last month's needs to know which. It states the count
 * actually used rather than the constant, because a diver with three gas-recorded dives has a
 * mean over three — `formatDiveCount` owns the plural, so "the last 1 dive" and "the last 5
 * dives" are both grammatical without this sentence knowing which it is getting.
 *
 * **"with gas recorded" is the load-bearing half.** RMV needs an average depth, a duration and
 * a cylinder size together (`rmv`, domain/derived.ts) and §1 asks for none of them, so the
 * dives behind this figure are a subset of the last five dives and usually a small one. Without
 * those three words the sentence would be false for almost every logbook.
 */
export function formatRmvWindow(count: number): string {
  return t('stats.rmvWindow', { count });
}

/** A gas fraction, e.g. "32 %" — O₂ or He content, unrounded. */
export function formatPercent(pct: number | null): string | null {
  if (!isFiniteNumber(pct)) return null;
  return `${figureText(pct)} %`;
}

/**
 * What a cylinder's two gas fractions are CALLED — the same words on the form a diver fills
 * in and on the detail they land on. `unnamedSite` above is the precedent: a word shared by
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
 * **The same middot list, for a line that folds and must not open a line with the middot** (M3e)
 * \u2014 `METADATA_SEPARATOR`'s deliberate near-duplicate, and \u00A74.1 requires it to say which question
 * it answers differently.
 *
 * That one is for a line with no measure: a dive row's metadata, a cylinder spec, a centre's
 * second line. Both of its spaces may break, which is exactly right where nothing is going to.
 * This one is for a line that has a measure and therefore wraps, and it differs by one character:
 * **the space before the middot is non-breaking**, so the middot can only ever end a line, never
 * begin one.
 *
 * It was measured rather than reasoned about. `formatMapSummary` first used the ordinary
 * separator with M1m's non-breaking spaces inside each clause, which is what the Dives header
 * does \u2014 and the simulator folded it as `8 of 11 dives \u00B7 4 of 6 sites` above `\u00B7 4 of 5 centres`,
 * a second line opening with a middot, which reads as a bullet in a list rather than as the tail
 * of a sentence. M1m's rule stops a *figure* being torn in half; it does not decide which side of
 * the fold the middot lands on, because the space in front of it is still a break opportunity and
 * the platform takes the last one that fits.
 *
 * **`formatLogbookSummary` uses this too, since M3f.** It did not while M3e was the only caller,
 * and the reason it did not has not survived a second look. M1m's rule was that the separator is
 * *"the whole of what may break"*, and a fully non-breaking one would leave the header no fold at
 * all \u2014 which is true and is not what this constant is: the space **after** the middot still
 * breaks, so the header still folds in exactly the place M1m's own sheet draws it. What changes is
 * only which side of that fold the middot lands on, and the Dives header had the same defect M3e
 * measured on the map \u2014 `128 dives \u00b7 96 h 12 min` above `\u00b7 deepest 41.2 m`, a second line opening
 * with what reads as a bullet. One line has a measure and folds; both of the app's two such lines
 * now fold the same way.
 */
export const WRAPPING_SEPARATOR = `${NON_BREAKING_SPACE}· `;

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
  return `${figureText(mm)} mm`;
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
 * Which of the three 0–3 scales a level belongs to — the whole of what the tables that used to
 * live here still decide, now that the words themselves are in `src/i18n`.
 *
 * There is no word to capitalise on these three: the stored value is an integer, so *something*
 * has to say that a waves 2 is "Medium". What that something is not is a second vocabulary —
 * `CONDITION_SCALE_VALUES` (domain/types.ts) is still the source of which levels exist, and
 * `Record<ConditionLevel, string>` in `en.ts`/`cs.ts` still makes TypeScript demand a word for
 * every one of them, so widening that list is a compile error in both resource files until
 * somebody names the new level in both languages. §4.1's "derive, or tie at compile time",
 * moved with the words rather than lost with them.
 *
 * **Three tables, not one, and the differences are the point.** Level 0 is *Flat* water and
 * *no* current; level 1 is a *Small* wave, a *Light* current and *Some* surge. A single shared
 * scale would have to pick one wording and be wrong about two subjects — and these words are
 * what a diver actually says, which is the whole reason §0.6 stopped asking them to type a
 * digit. **Czech makes the split harder rather than softer**: *vlny* are feminine plural,
 * *proud* masculine and *vlnobití* neuter, so even the levels English spells identically
 * ("Medium", "Strong") take three different endings.
 *
 * M1h added these. Until then the three fields were text boxes and this module rendered the
 * bare number back (`formatConditionScale`), which was honest while the diver typed the digit
 * themselves and became a small lie the moment they picked a chip saying "Small" — pick a
 * word, read back a number, which is the `Steel`/`steel` drift §4.1 opens with, one screen
 * apart. So both screens go through these.
 */
type ConditionScale = 'waves' | 'current' | 'surge';

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
 * Rounded values are not coerced to the nearest level either: `1.5` renders "1.5" (and "1,5"
 * in Czech — it is a figure, so it goes through `figureText`), because inventing "Small" for
 * it would be this module deciding what a diver meant.
 *
 * The membership test is `CONDITION_SCALE_VALUES` rather than a lookup that falls back on
 * `undefined`: `t` returns the key itself for a key that does not exist, so a `waves: 7` would
 * have rendered the literal text `vocabulary.waves.7` on screen — the one failure mode a
 * translated lookup has that a table did not.
 */
function formatConditionLevel(value: number | null, scale: ConditionScale): string | null {
  if (!isFiniteNumber(value)) return null;
  if (!(CONDITION_SCALE_VALUES as readonly number[]).includes(value)) return figureText(value);
  return t(`vocabulary.${scale}.${value as ConditionLevel}`);
}

/** The sea state, e.g. "Small" — level 0 is *Flat*, which is a real reading and not "nothing
 * recorded"; an unrecorded scale is `null` and produces no row at all. */
export function formatWaves(value: number | null): string | null {
  return formatConditionLevel(value, 'waves');
}

/** The current, e.g. "Light". Level 0 is *None* — the diver looked and there was none, which
 * is worth recording and is not the same as never having looked. */
export function formatCurrent(value: number | null): string | null {
  return formatConditionLevel(value, 'current');
}

/** The surge, e.g. "Some" — the back-and-forth a swell pushes through a site, which is why
 * §0.6 draws its mark with two-way arrows where the current's point one way. */
export function formatSurge(value: number | null): string | null {
  return formatConditionLevel(value, 'surge');
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
  return `${figureText(rating)} / 5`;
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
 * **§3's *currency*, as the diver reads it** — `"Today"`, `"Yesterday"`, or `"12 days ago"`.
 *
 * Days rather than months or years, all the way up, because that is the unit §3 names (*"days
 * since your last dive"*) and the unit the nudge is keyed on (`REFRESHER_AFTER_DAYS`,
 * domain/logbookStats.ts). "8 months ago" would be friendlier and would also be a second
 * arithmetic to keep in step with the one that decides whether the nudge fires — the shape §4.1
 * exists to stop — so the figure and the threshold stay in one unit and the nudge says the rest.
 *
 * **Today and yesterday get words, and nothing further does.** A diver reads "0 days ago" as a
 * bug and "1 days ago" as one too; every larger number reads perfectly well as itself, so the
 * special cases stop exactly where the plural stops being a problem. They are capitalised
 * because this is a row's whole value, in the trailing slot a categorical label like "Shore"
 * occupies (§0.6), not a fragment of a sentence.
 *
 * A negative span is refused rather than printed. `currency` cannot produce one — it ignores a
 * dive dated ahead of today outright — and this guards it anyway for the reason every formatter
 * in this module guards: what it is handed comes from stored values, and "in 3 days ago" is
 * worse than no line.
 */
export function formatDaysSince(days: number | null): string | null {
  if (!isFiniteNumber(days) || days < 0) return null;
  const whole = Math.round(days);
  if (whole === 0) return t('figure.today');
  if (whole === 1) return t('figure.yesterday');
  return t('figure.daysAgo', { count: whole });
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
 * every space INSIDE a figure is U+00A0. That is a rule about the line rather than about any one
 * string, so it holds for `1 dive · 47 min`, for feet, and for §0.5's Czech, which is 20–30 %
 * longer and is the case that wraps first.
 *
 * It belongs here rather than in `formatDiveCount` and friends because those figures are read
 * inside rows that do not wrap, where a non-breaking space would be an invisible difference
 * with no consequence — and §4.1's rule is that a shared owner keeps the shared meaning. What
 * is specific to the header is that the line has a measure.
 *
 * **And the middot travels with the figure in front of it** (`WRAPPING_SEPARATOR`, M3f). M1m
 * settled *whether* the line may break inside a figure and left *which side of the break the
 * middot lands on* to the platform, which takes the last opportunity that fits — so the header
 * could and did fold as `128 dives · 96 h 12 min` above `· deepest 41.2 m`, a second line opening
 * with what reads as a bullet in a list rather than the tail of a sentence. M3e measured that on
 * `formatMapSummary` and fixed it there, recording the Dives header as the same defect left
 * standing because M1m had chosen its separator deliberately. It had — for the half of the
 * question it was answering. The line still has somewhere to fold, because the space *after* the
 * middot is still ordinary; it simply cannot fold in front of one.
 */
export function formatLogbookSummary(stats: LogbookStats, system: UnitSystem): string {
  const parts: string[] = [formatDiveCount(stats.dives)];

  const underwater = formatTimeUnderwater(stats.minutes);
  if (underwater !== null) parts.push(underwater);

  const deepest = formatDepth(stats.deepestM, system);
  if (deepest !== null) parts.push(t('figure.deepest', { depth: deepest }));

  return parts.map((figure) => figure.replace(/ /gu, NON_BREAKING_SPACE)).join(WRAPPING_SEPARATOR);
}

/**
 * What a dive is called when it has no name of its own. Exported so `groupIntoTrips`
 * (domain/trips.ts) can title an unplaced TRIP with the same words a row uses for an
 * unplaced dive — the words are shared; the rules that reach them are not (see below).
 *
 * **A function since M3g, and it had to become one.** As a `const` its value was fixed when
 * the module was first imported — before any diver has chosen a language, and for ever
 * afterwards — so a screen switched to Czech would have gone on saying "Unnamed site" until
 * the app was killed. Every string in this file that used to be a constant is a call for the
 * same reason; there is nothing else to read into the shape.
 */
export function unnamedSite(): string {
  return t('place.unnamedSite');
}

/**
 * What a **catalogue centre** is called when its row carries no name (M3c) — the centres
 * directory's rows, and the heading of a centre's own page.
 *
 * `unnamedSite`'s sibling and deliberately a separate string rather than a shared "Unnamed"
 * with the noun appended: §0.5's Czech runs 20–30 % longer and declines both nouns, so the two
 * are two strings to translate rather than one string plus a rule about grammar.
 *
 * **It is not `diveSiteLabel`'s fallback moved**, and the difference is which object has no
 * name. That function answers "what is this DIVE called" and falls back through the dive's own
 * centre before reaching `unnamedSite`; this names a `dive_centers` ROW, which has only a name
 * to lose. §5 asks a new centre for a name and nothing else, so this is an edge — but the column
 * is nullable in both databases (§6, so §7's one-transaction push can never reject a diver's
 * whole sync over one row), and a row with no name can arrive in a pull.
 */
export function unnamedCenter(): string {
  return t('place.unnamedCenter');
}

/**
 * What a dive is CALLED on screen: its site, or its centre when no site was recorded, or
 * `unnamedSite()`'s words when it has neither. The single owner of that choice — `DiveRow.tsx`'s
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
  return dive.siteName ?? dive.centerName ?? unnamedSite();
}

/**
 * What a certification card is called when it names nothing at all.
 *
 * `unnamedSite`'s sibling one object over, and it exists for the same reason: a row with no
 * heading is a blank line, which is worse than a placeholder. It is reachable even though
 * `certificationRefusal` (domain/certifications.ts) will not let a diver *author* such a card
 * — §6 makes every column nullable, so `pull_changes` can deliver one from another client, and
 * everything that reads a wallet has to tolerate what the editor will not write.
 */
export function untitledCertification(): string {
  return t('certification.untitled');
}

/**
 * What a card is CALLED on screen: its agency and its course, whichever of them it has.
 *
 * "PADI Rescue Diver" is how a diver says it out loud, so it is one line rather than two
 * fields; the agency leads because it is the shorter and more constant half, and because a
 * column of wallet rows then lines up by agency without anything being tabulated.
 *
 * `diveSiteLabel`'s contract exactly — always a string, never null — and it is the same kind
 * of rule: the single owner of "what do we call this row", so the wallet list and the editor
 * cannot drift the way a dive row and its detail once did ("Unnamed site" in the list and
 * nothing at all on the detail).
 */
export function certificationLabel(
  certification: Pick<Certification, 'agency' | 'course'>,
): string {
  const parts = [certification.agency, certification.course].filter(
    (part): part is string => part !== null && part.trim() !== '',
  );
  return parts.length === 0 ? untitledCertification() : parts.join(' ');
}

/**
 * The second line of a wallet row: the card number and what its dates say, middot-separated
 * (`METADATA_SEPARATOR`, §0.6's row metadata) — or `null` when the card has nothing to add
 * beyond its own name.
 *
 * **Null rather than an em dash, and that is §3's own distinction rather than an
 * inconsistency with the Stats screen.** M3a gives a dash to a screen with a *fixed
 * inventory*, where a missing row would read as a screen that failed. This is a list whose
 * rows vary with what a diver recorded — the dive detail's case — and `settingsPresetSummary`
 * one section up already omits its line for a preset holding no cylinders, for the same
 * reason: an empty second line under a name reads as a value that failed to load.
 *
 * **The expiry is a fact, never a nudge.** A card past its date reads `expired 3 Mar 2024`
 * and nothing else happens: no colour (§0.1 spends hue on depth alone), no icon, no banner.
 * §3 gives *currency* — days since your last dive, the refresher nudge — to the **Stats**
 * screen, which is where a sentence telling a diver to go and do something belongs; a wallet
 * is a record of what they hold. `certificationExpiry` (domain/certifications.ts) decides
 * whether the card has run out, including that a card expiring today has not.
 */
export function formatCertificationSummary(
  certification: Pick<Certification, 'cardNumber' | 'issuedOn' | 'expiresOn'>,
  expiry: ExpiryState | null,
): string | null {
  const parts: string[] = [];
  const number = certification.cardNumber?.trim() ?? '';
  if (number !== '') parts.push(t('certification.cardNumber', { number }));
  if (certification.issuedOn !== null) {
    parts.push(t('certification.issued', { date: formatDiveDate(certification.issuedOn) }));
  }
  if (certification.expiresOn !== null) {
    // Present tense for a card that is still good, past tense for one that is not — and
    // nothing at all when `certificationExpiry` could not tell, since a date this build cannot
    // read is still the diver's and is shown as it stands rather than judged. Two whole keys
    // rather than one with the verb interpolated: Czech says *platí do* against *platnost
    // skončila*, which is not one sentence with a word swapped.
    const date = formatDiveDate(certification.expiresOn);
    parts.push(
      expiry === 'expired' ? t('certification.expired', { date }) : t('certification.expires', { date }),
    );
  }
  return parts.length === 0 ? null : parts.join(METADATA_SEPARATOR);
}

/**
 * How many dives, as a phrase: "1 dive", "3 dives". The single owner of that singular/plural
 * choice, because there are two callers for it — the "Up next" header's trailing slot
 * (TripHeader.tsx) and a day strip's own sentence (DayStrip.tsx, "18 Aug 2026 · 2 dives, no
 * times") — and the strip previously carried an inline copy. English needs one comparison;
 * Czech needs **four** forms and does not split on `=== 1`, so a second copy would have been a
 * second place to find and fix. i18next picks the form (`count.dives`, src/i18n); nothing here
 * compares a count with anything.
 *
 * Takes and returns non-null, unlike every formatter above: `count` is something the app
 * counts (an array length), never a nullable field read back out of the database, so there
 * is no absent case to thread through. The guards above exist for stored values; this has
 * none. **Which also means Czech's `many` — the fractional form — is unreachable from any
 * caller in this app**; it is written in `cs.ts` because the rule has four branches, and it is
 * exercised directly by that file's own tests.
 */
export function formatDiveCount(count: number): string {
  return t('count.dives', { count });
}

/**
 * How many catalogue sites, as a phrase: "1 site", "3 sites" — `formatDiveCount`'s sibling above,
 * and `formatCenterCount`'s one table over. English needs one comparison and Czech needs four
 * forms (§0.5), which is the whole reason a plural lives in this module rather than in a template
 * literal on a screen.
 *
 * **Exported since M3f**, when the sites directory became its second caller — the Map tab's
 * summary line below was the first and the only one while the word appeared once in the app.
 */
export function formatSiteCount(count: number): string {
  return t('count.sites', { count });
}

/**
 * **How much of one kind of thing is on the map**, as a phrase: `"7 of 24 dives"`, or `"24
 * dives"` when every one of them is drawn.
 *
 * One rule, asked three times by `formatMapSummary` below. It was written out twice before M3e
 * — `formatMyDivesSummary` and `formatCentersSummary` each carried their own copy of the same
 * comparison, and a third copy was exactly what a third population would have added.
 *
 * **The "of" half appears only when the two differ**, because `24 of 24 dives` is a comparison
 * with nothing to say. `known` is what the device holds; `onMap` is what could be drawn.
 *
 * **It hands the template four values for two figures, because the two languages hang the noun
 * on different numbers** (M3h — M3g found this and left it here). English writes *7 of 24 dives*
 * and the noun goes with the total. Czech cannot: *z* governs the genitive, so a nominative
 * count phrase dropped in after it reads `1 z 2 lokality` where the language wants `ze 2
 * lokalit` — the composed count phrase that reads wrong and passes every test. Czech therefore
 * writes *7 ponorů z 24*, with the noun on `onMapCount` and nothing but a numeral after the
 * preposition.
 *
 * So both spellings of the pair are offered and each resource file takes the one its grammar
 * needs. `count` is the total, and it is here only so Czech's `few` can vocalise `z` to `ze`;
 * English holds no plural forms of this key at all and i18next falls back to the bare one,
 * which is what keeps the English sentence byte-identical to the one that shipped.
 *
 * **This still has exactly one owner of the plural.** `count` (the callback) is
 * `formatDiveCount` and its siblings either way; nothing here counts anything or compares a
 * count with 1.
 */
function formatCoverage(onMap: number, known: number, count: (value: number) => string): string {
  if (onMap >= known) return count(onMap);
  return t('figure.coverage', {
    onMap,
    total: count(known),
    onMapCount: count(onMap),
    count: known,
  });
}

/**
 * **The line under the Map tab's title: what is on this map, one clause per kind the diver has
 * switched on** — `"7 of 24 dives · 12 of 30 sites · 1 of 5 centres"`, or `null` when nothing is
 * switched on at all.
 *
 * ── Why this is one function and its three predecessors were three (M3e) ───────────────────
 *
 * §3's layers were a mode until M3e, so the line described one population and named it:
 * `Your dives · 3 sites · 7 of 24 dives on the map`, `Community · 12 sites`, `Dive centres · 1 of
 * 12 on the map`. M3c measured what happens when a mode's line meets a mixed population — the
 * header read `Community · 3 sites` over one site and two centres, which is a sentence with no
 * way to read it off the map — and the brief for this task made that failure the problem to
 * solve rather than an argument against solving it.
 *
 * **The fix is that every clause names its own noun**, so there is no leading label left for the
 * line to get wrong: `dives`, `sites` and `centres` are three words a diver already has, in
 * `MAP_MARK_KINDS`' own order, and a clause is present exactly when its marks are.
 *
 * **A kind with no answer yet contributes nothing** — `null` rather than a zero — because a read
 * that has not landed and a catalogue that is empty are the same `[]` (§10: a screen with no
 * answer must not state one). A kind that HAS landed and holds nothing contributes `0 sites`,
 * which is the honest report of a filter the diver switched on and that has nothing behind it;
 * `MapScreen` draws the sentence explaining *why* only when the map is otherwise empty, since a
 * paragraph about an empty catalogue over a map full of the diver's own dives is a reproach for
 * something they did not do.
 *
 * ── The three figures, and the one word that changed ──────────────────────────────────────
 *
 * **The dives clause dropped the place count and kept the coverage one.** `3 sites` was the
 * number of the diver's own markers, and with the community's sites on the same map that word
 * now belongs to the catalogue — a line saying `3 sites · 12 sites` is two different meanings for
 * one noun in one sentence. The markers are visible and countable; how much of the logbook is
 * missing from them is not, which is why that is the figure worth the space.
 *
 * **"dives", not "pinned dives", and the words are not interchangeable.** The figure counts every
 * dive at a place the map could position, including dives at that place carrying no coordinates
 * of their own — which is exactly what the badges add up to (`groupDivesByPlace`, domain/
 * mapSites.ts: a site's badge counts your dives there, not your fixes there). Calling them
 * "pinned" would make this line disagree with the numbers drawn beside it.
 *
 * **A centre almost never has a position, by design** (§2.3: *"a centre inherits its name alone —
 * the form's pin is where the diver entered the water, so writing it to a centre files a dive
 * site as the shop's address"*), so `1 of 5 centres` is that clause's ordinary shape rather than
 * its exceptional one. Sites are the same story less severely: §5 asks a new site for a name and
 * `siteFactsFrom` passes a pin only when the dive carried one.
 *
 * **The sites figure counts marks, so a site the diver has dived is not in it** — it is on the
 * map wearing their own badge instead (`sitesWithoutYourMark`, domain/mapSites.ts). The clause
 * therefore reads "site marks drawn, out of sites known", and the places absorbed that way are
 * counted by the dives clause beside it.
 *
 * `formatDiveCount`, `formatSiteCount` and `formatCenterCount` own the three plurals; nothing
 * here counts anything.
 */
export function formatMapSummary(
  dives: MapPopulation | null,
  sites: MapPopulation | null,
  centres: MapPopulation | null,
): string | null {
  const parts: string[] = [];
  if (dives !== null) parts.push(formatCoverage(dives.onMap, dives.known, formatDiveCount));
  if (sites !== null) parts.push(formatCoverage(sites.onMap, sites.known, formatSiteCount));
  if (centres !== null) parts.push(formatCoverage(centres.onMap, centres.known, formatCenterCount));
  if (parts.length === 0) return null;
  // **Where this line is allowed to fold, and the simulator settled both halves of it.** §0.6
  // caps this column at the floating capsule, the capsule holds three glyphs, and three clauses
  // are two lines — so the fold is ordinary rather than theoretical.
  //
  // A clause's own spaces are `NON_BREAKING_SPACE`, which is M1m's rule for the Dives header and
  // stops `4 of 6 sites` being torn in half. That alone was not enough, and the pixels are what
  // said so: with it in place the line still folded as `8 of 11 dives · 4 of 6 sites` above `· 4
  // of 5 centres`, because the space in FRONT of a middot is a break opportunity too and the
  // platform takes the last one that fits. `WRAPPING_SEPARATOR` is the other half — see it for
  // why it is a second constant rather than an edit to the first.
  return parts.map((clause) => clause.replace(/ /gu, NON_BREAKING_SPACE)).join(WRAPPING_SEPARATOR);
}

/**
 * How much of one kind of thing the map is showing. `known` is what the device holds of it;
 * `onMap` is how many of those got a mark.
 *
 * One shape for all three kinds, and three separate **parameters** on `formatMapSummary` rather
 * than a list of `{ kind, population }`: a caller cannot hand the sites figure to the centres
 * clause when each clause has its own named argument, and a mixed-up figure is the exact defect
 * a line describing three populations at once could otherwise ship green.
 */
export interface MapPopulation {
  readonly onMap: number;
  readonly known: number;
}

/**
 * **What a screen reader announces for one mark on the map** — `"Blue Hole, 2 dives"`, `"Vis,
 * dive site"`, `"Ponorka, dive centre"`.
 *
 * Three functions rather than one taking a kind, on `formatMapSummary`'s reasoning one object
 * over: they are three different sentences about three different nouns, and the dive one is the
 * only one with a figure in it.
 *
 * **It names the KIND, and since M3e it has to** (`components/DiveMap.tsx`). Three kinds are on
 * one map at once and what tells them apart by eye is a numeral, a `storefront` glyph or an empty
 * disc — none of which a screen reader can see. Before the filter each layer drew one kind and
 * the summary line above said which, so a bare name was the whole truth; now a bare `Ponorka`
 * would be a mark whose kind is unknowable and whose press does something (`/center/…`) that the
 * two marks beside it do not.
 *
 * A comma rather than `METADATA_SEPARATOR`, because this is a sentence to be *spoken* and not a
 * line of figures to be read — `ReorderControls`' `rowLabel` makes the same split with its
 * parentheses (§4.1's near-duplicates: those three all display, these three speak).
 */
export function formatDiveMarkLabel(place: string, dives: number): string {
  return `${place}, ${formatDiveCount(dives)}`;
}

export function formatSiteMarkLabel(name: string): string {
  return t('place.siteMark', { name });
}

export function formatCenterMarkLabel(name: string): string {
  return t('place.centerMark', { name });
}

/**
 * How many centres, as a phrase: "1 centre", "12 centres" — `formatDiveCount`'s sibling, and
 * exported for the same reason it is: two callers (the centres directory's own line and the map
 * layer's summary below), English needs one comparison and Czech needs four forms (§0.5), so the
 * plural lives here rather than in a template literal on a screen.
 */
export function formatCenterCount(count: number): string {
  return t('count.centres', { count });
}

/**
 * **A centre's second line in the directory** — `"Croatia · 3 dives"`, or null when neither half
 * has anything behind it.
 *
 * The two halves come from two different places and that is what makes the line worth having:
 * the country is what the *catalogue* knows about the shop, the count is what the *diver's own
 * logbook* says about it, and a directory of community centres is only interesting where those
 * two meet. `formatDiveCount` owns the plural.
 *
 * **A centre the diver has never dived with shows no count, rather than `0 dives`.** That is this
 * module's standing rule (a figure with nothing behind it is omitted, never drawn as a
 * placeholder) doing real work here rather than being merely observed: most rows in a community
 * catalogue are shops this diver has never used, and a column of noughts would be the list
 * telling the diver something they already know, once per row, in the slot where the interesting
 * rows say something.
 *
 * The centre's own page is the other answer and deliberately differs: there `formatSiteSummary`
 * always states the count, because a page opened to ask "what did I do with this shop" must
 * answer even when the answer is none.
 *
 * Null rather than `''`, so a caller draws no line at all instead of an empty one — the same
 * contract `formatSiteFacts` and `formatCylinderSpec` keep.
 */
export function formatCenterRow(center: Pick<DiveCenter, 'country'>, dives: number): string | null {
  const parts: string[] = [];
  if (center.country !== null && center.country !== '') parts.push(center.country);
  if (dives > 0) parts.push(formatDiveCount(dives));
  return parts.length === 0 ? null : parts.join(METADATA_SEPARATOR);
}

/**
 * **A site's second line in the directory** (M3f) — `"CZ · Shore · Fresh · Quarry · 42.0 m ·
 * 3 dives"`, or null when neither half has anything behind it.
 *
 * **`formatCenterRow`'s deliberate near-duplicate, and §4.1 requires it to say what it answers
 * differently.** That one has one catalogue fact to state, because §6 gives a centre a `website`
 * and a country and nothing else a directory row could carry. A site has four more — `entry`,
 * `salinity`, `water_body` and its own `max_depth_m` — and they are the reason a diver opens a
 * catalogue of rocks at all. So the two rows are the same shape over different content, which is
 * exactly the difference §6 draws between the two tables, and unifying them would mean picking one
 * table's facts for both.
 *
 * **The facts half is `formatSiteFacts` and is never re-listed here.** That function is the Map's
 * own line about a site, so a row in this directory and a place's card on the map cannot describe
 * one site in two vocabularies (§4.1) — what differs between the two surfaces is the diver's own
 * dive count, which a map sheet has its own better answer for.
 *
 * **A site the diver has never dived shows no count, rather than `0 dives`** — this module's
 * standing rule (a figure with nothing behind it is omitted, never drawn as a placeholder) doing
 * real work: most rows in a community catalogue are places this diver has never been, and a column
 * of noughts would be the list telling them something they already know, once per row, in the slot
 * where the interesting rows say something. The site's own **page** is the other answer and
 * deliberately differs: there `formatSiteSummary` always states the count, because a page opened
 * to ask "what have I done here" must answer even when the answer is none.
 *
 * Null rather than `''`, so a caller draws no line at all instead of an empty one — the contract
 * `formatSiteFacts` and `formatCenterRow` already keep.
 */
export function formatSiteRow(
  site: Pick<DiveSite, 'country' | 'entry' | 'salinity' | 'waterBody' | 'maxDepthM'>,
  dives: number,
  system: UnitSystem,
): string | null {
  const facts = formatSiteFacts(site, system);
  const parts: string[] = facts === null ? [] : [facts];
  if (dives > 0) parts.push(formatDiveCount(dives));
  return parts.length === 0 ? null : parts.join(METADATA_SEPARATOR);
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
  return t('count.changesWaiting', { count });
}

/**
 * The twelve months, as keys rather than as words — **and written out rather than built from
 * `` `date.month.${n}` ``**, because a computed key is a key the compiler cannot check and this
 * function's whole failure mode is rendering a key on screen.
 *
 * What the key holds differs sharply between the two languages, which is the point of putting
 * it in the resource file at all: English writes an abbreviated NAME (`Aug`) and Czech a
 * NUMERAL (`8`), with `date.long` supplying each language's own punctuation around it. A Czech
 * month name would have to be genitive — *16. srpna 2026* — which is correct, longer, and a
 * decision the resource file records so it can be changed there and only there.
 */
const MONTH_KEYS = [
  'date.month.jan', 'date.month.feb', 'date.month.mar', 'date.month.apr',
  'date.month.may', 'date.month.jun', 'date.month.jul', 'date.month.aug',
  'date.month.sep', 'date.month.oct', 'date.month.nov', 'date.month.dec',
] as const satisfies readonly TranslationKey[];

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
  const monthKey = Number.isInteger(month) ? MONTH_KEYS[month - 1] : undefined;
  // isCalendarDate has already proven `date` names a real calendar date in
  // canonical YYYY-MM-DD form, so this split always yields three integers
  // and month is always 1-12 in practice. The guard below doesn't lean on
  // that holding after some future edit to either function — same
  // reasoning datetime.ts itself gives for re-checking Number.isInteger
  // after a regex that already looks like it guarantees it.
  if (!Number.isInteger(year) || !Number.isInteger(day) || monthKey === undefined) return date;
  // The whole shape of the date is the pattern's, not this function's: `16 Aug 2026` and
  // `16. 8. 2026` are one call apart, and `domain/trips.ts` reads a range's leading token back
  // out of whatever comes out (`16` / `16.`) rather than re-splitting the stored string.
  return t('date.long', { day, month: t(monthKey), year });
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
 * weather, visibility, suit, weighting feel and each equipment token — are stored as the closed
 * lowercase vocabulary `domain/types.ts` declares: the database's vocabulary, not the diver's.
 * This module is the one other place a stored value becomes a displayed string in this app, so
 * that is where the words live, rather than each screen translating inline.
 *
 * **Until M3g one shared `capitalize` covered all of them, and the reason it could is exactly
 * what translation took away.** Every member of those unions is a single lowercase English
 * word, so `shore` → `Shore` needed no table and a union that grew a member needed no edit.
 * `Břeh` cannot be derived from `shore`, so the table comes back — and comes back with §4.1's
 * safeguard attached: `en.ts` and `cs.ts` declare each group `satisfies Record<Entry, string>`,
 * so adding a value to a vocabulary is a **compile error in both languages** until somebody
 * names it. That is a stronger tie than `capitalize` ever had, which quietly invented a word.
 *
 * `capitalize` survives for the one job that is not translation — see `vocabularyWord` below.
 */
function capitalize<T extends string>(value: T): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * **Whether this build has a word for a stored value at all**, which is the guard every
 * formatter below needs and none of them needed before.
 *
 * §10 rules that a value from a client this build does not know is **stored and flagged, never
 * rejected** — so `dive.entry` is typed `Entry` and can hold `'jetty'` at runtime, delivered by
 * §7's pull. `capitalize` handled that invisibly and well: an unknown token rendered as
 * `Jetty`. A lookup does not — i18next returns the KEY for a key it has no string for, so the
 * same dive would have put the literal text `vocabulary.entry.jetty` on screen. That is the one
 * regression translating this family could introduce, and this is where it is closed: a known
 * value gets its word, an unknown one gets `capitalize`'s old behaviour, and §1's "never block"
 * holds either way.
 *
 * The membership list is the vocabulary itself (`domain/types.ts`), never a second list here.
 */
function known<T extends string>(values: readonly T[], value: T): boolean {
  return (values as readonly string[]).includes(value);
}

/** How the diver entered the water, e.g. "Shore". */
export function formatEntry(entry: Entry | null): string | null {
  if (entry === null) return null;
  return known(ENTRY_VALUES, entry) ? t(`vocabulary.entry.${entry}`) : capitalize(entry);
}

/** The water's salinity, e.g. "Fresh". Two values since M1h — `brackish` went (§10). */
export function formatSalinity(salinity: Salinity | null): string | null {
  if (salinity === null) return null;
  return known(SALINITY_VALUES, salinity) ? t(`vocabulary.salinity.${salinity}`) : capitalize(salinity);
}

/** The kind of water body, e.g. "Quarry". */
export function formatWaterBody(waterBody: WaterBody | null): string | null {
  if (waterBody === null) return null;
  return known(WATER_BODY_VALUES, waterBody) ? t(`vocabulary.waterBody.${waterBody}`) : capitalize(waterBody);
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
  if (configuration === null) return null;
  return known(CONFIGURATION_VALUES, configuration) ? t(`vocabulary.configuration.${configuration}`) : capitalize(configuration);
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
  if (weather === null) return null;
  return known(WEATHER_VALUES, weather) ? t(`vocabulary.weather.${weather}`) : capitalize(weather);
}

/**
 * The visibility a diver judged, e.g. "Average" — the scale, not `visibilityM`'s distance.
 *
 * Two formatters for one subject, and §10 records that as intended rather than as a
 * duplicate: nobody measures visibility, so the scale is the primary and the metres are an
 * optional refinement. `formatDepth` is what renders the other half.
 */
export function formatVisibility(visibility: Visibility | null): string | null {
  if (visibility === null) return null;
  return known(VISIBILITY_VALUES, visibility) ? t(`vocabulary.visibility.${visibility}`) : capitalize(visibility);
}

/** The exposure suit worn, e.g. "Semidry". */
export function formatSuit(suit: Suit | null): string | null {
  if (suit === null) return null;
  return known(SUIT_VALUES, suit) ? t(`vocabulary.suit.${suit}`) : capitalize(suit);
}

/**
 * How the weighting felt, e.g. "Over" — the judgement beside `weightsKg`'s number, and the
 * sharper of §10's two number-plus-judgement pairs: "6 kg" means nothing on its own, and
 * "6 kg, and I was over" is the fact a diver uses to dial in the next dive.
 */
export function formatWeightsFeel(weightsFeel: WeightsFeel | null): string | null {
  if (weightsFeel === null) return null;
  return known(WEIGHTS_FEEL_VALUES, weightsFeel) ? t(`vocabulary.weightsFeel.${weightsFeel}`) : capitalize(weightsFeel);
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
  return known(EQUIPMENT_VALUES, token) ? t(`vocabulary.equipment.${token}`) : capitalize(token);
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
  if (material === null) return null;
  return known(TANK_MATERIAL_VALUES, material) ? t(`vocabulary.tankMaterial.${material}`) : capitalize(material);
}

/**
 * A dive's status, "Logged" or "Planned". Unlike the four formatters above, `status` is
 * never null (domain/types.ts: the one exception alongside `id` and `date`), so this takes
 * and returns a plain string rather than threading a null case that can't occur.
 */
export function formatDiveStatus(status: DiveStatus): string {
  // `DiveStatus` is a bare union with no value list in `domain/types.ts` to check against, so
  // the two members are named here — the same `known` guard, spelled out because there is no
  // list to point at. `splitPlanned` (domain/trips.ts) already treats anything that is not
  // affirmatively `logged` as planned, which is how a strange status reaches this at all.
  const spelled = status === 'logged' || status === 'planned';
  return spelled ? t(`vocabulary.diveStatus.${status}`) : capitalize(status);
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
  return known(UNIT_SYSTEMS, system) ? t(`vocabulary.unitSystem.${system}`) : capitalize(system);
}

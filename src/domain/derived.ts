import { calendarDateToUtcMs, timeOfDayToMinutes } from './datetime';
import { cylinderCount, type Dive, type Tank } from './types';

/** Metres of sea water per bar of ambient pressure. */
const METRES_PER_BAR = 10;
/** The clock's own period, and the whole legitimate domain of a dive duration. */
const MINUTES_PER_DAY = 1440;
/** The conservative oxygen partial-pressure ceiling most agencies teach. */
const DEFAULT_PPO2_MAX = 1.4;

function isNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * This is the pressure half of a two-way policy gasUsedLitres applies to
 * every per-cylinder field it reads (pressures here; size and the rig's
 * cylinder count below):
 *  - 'absent': the value was never recorded — null/undefined, or not a real
 *    number at all (NaN, Infinity, wrong type). Nothing a diver could have
 *    deliberately entered. That cylinder is skipped; the rest still count.
 *  - 'contradictory': the value is a real, finite number, but not one that
 *    describes a physically possible cylinder (a negative pressure, the
 *    cylinder ending fuller than it started). This is data the diver did
 *    record, so silently dropping just that cylinder would understate gas
 *    used — the unsafe direction for gas planning — so it voids the whole
 *    total instead of just that cylinder.
 * A field this file doesn't validate yet should be classified the same way
 * when it's added: absent if it's null/undefined or not a real number,
 * contradictory if it's a real number that can't describe an actual
 * cylinder. There is no third bucket, and no field is exempt from either
 * check — on any cylinder, no matter what else on that same cylinder is
 * absent. gasUsedLitres classifies every field on a cylinder before it
 * decides skip-vs-void for that cylinder, specifically so a contradictory
 * size or count can't hide behind an earlier absent field. See
 * gasUsedLitres for how size and count apply this identically, and for why
 * that order is the part that actually matters.
 */
type TankGas = { kind: 'ok'; usedBar: number } | { kind: 'absent' } | { kind: 'contradictory' };

function tankGas(tank: Tank): TankGas {
  if (!tank) return { kind: 'absent' };
  if (!isNumber(tank.startBar) || !isNumber(tank.endBar)) return { kind: 'absent' };
  // A cylinder gauge bottoms out at 0; a negative absolute pressure is not a
  // real reading, regardless of which way round it's negative.
  if (tank.startBar < 0 || tank.endBar < 0) return { kind: 'contradictory' };
  const used = tank.startBar - tank.endBar;
  return used >= 0 ? { kind: 'ok', usedBar: used } : { kind: 'contradictory' };
}

/**
 * COERCION CONTRACT — read this before wiring up any form for tank fields.
 * M1d (the dive entry form) is the first consumer this applies to.
 *
 * The classification above only holds if an empty numeric field reaches
 * this file as null or NaN, and never as 0: this file treats NaN as absent
 * (an empty field — parseFloat('') is NaN) and treats 0 as contradictory
 * for sizeL. That split is correct, but it depends entirely on
 * which coercion produced the number:
 *   - parseFloat('') -> NaN -> absent -> sizeL just skips that cylinder.
 *     Correct.
 *   - Number('') -> 0 -> contradictory -> voids the entire dive's gas
 *     figure.
 * z.coerce.number() calls Number() internally, so a bare
 * z.coerce.number() on an optional sizeL or pressure field will silently
 * blank a dive's RMV the moment that field is left empty — not reject the
 * form, not flag the field, just a quietly missing gas figure. Any Zod
 * schema for these fields needs something that maps an empty string to
 * null (or leaves it NaN) instead of coercing it to 0 — e.g.
 * z.coerce.number().or(z.literal('').transform(() => null)) — never a
 * bare z.coerce.number().
 *
 * The cylinder COUNT is no longer one of these fields and this is worth
 * saying, because the contract used to name it in every clause above:
 * M1h replaced `Tank.count` with `Tank.configuration`, so the count is
 * derived from a chip rather than typed (`cylinderCount`, domain/types.ts)
 * and no coercion stands between a keypad and it any more.
 */

/**
 * Size and the rig's cylinder count each get the same three-way
 * classification pressure does above, as their own small functions rather
 * than logic inlined into gasUsedLitres's loop — so that loop can classify
 * every field on a cylinder before it acts on any of them (see
 * gasUsedLitres for why that order is the point).
 */
type FieldGas = { kind: 'ok'; value: number } | { kind: 'absent' } | { kind: 'contradictory' };

function sizeGas(tank: Tank): FieldGas {
  if (!tank || !isNumber(tank.sizeL)) return { kind: 'absent' };
  return tank.sizeL > 0 ? { kind: 'ok', value: tank.sizeL } : { kind: 'contradictory' };
}

/**
 * How many cylinders this rig is, in the same absent/ok/contradictory
 * vocabulary the two fields above use — **read from `cylinderCount`
 * (domain/types.ts), never restated here.** That function lives beside
 * `CONFIGURATION_VALUES` because a rig's cylinder count is a fact about the
 * vocabulary, and a `twinset === 2` written into this file as well would be
 * §4.1's defining defect with a gas figure attached.
 *
 * **A rig this build cannot read is `absent`, exactly as a `null` count was
 * before M1h**, and preserving that equivalence is the whole point of the
 * classification: a cylinder whose rig was never recorded still counts
 * (gasUsedLitres falls back to one), where a cylinder whose *size* was never
 * recorded is skipped. `cylinderCount` collapses both "never recorded" and
 * "recorded as something this build has never heard of" to `null`, which is
 * the right reading of each — neither is a number anyone could have meant.
 *
 * **`contradictory` has no member here any more, and that is a fact about the
 * field rather than a gap in the check.** A count was typed, so it could be
 * `0`, `-1` or `1.5` — real data describing an impossible cylinder, which
 * voids the whole total. A configuration is a tap on a closed list: there is
 * no value that is both recorded and impossible, so the bucket is empty by
 * construction. If a rig ever gains a count that can be wrong, this is the
 * function that grows the third branch back.
 */
function countGas(tank: Tank): FieldGas {
  if (!tank) return { kind: 'absent' };
  const count = cylinderCount(tank.configuration);
  return count === null ? { kind: 'absent' } : { kind: 'ok', value: count };
}

/** Pressure consumed from one cylinder, or null if it cannot be known. */
export function usedBar(tank: Tank): number | null {
  const gas = tankGas(tank);
  return gas.kind === 'ok' ? gas.usedBar : null;
}

/**
 * Free gas consumed across every cylinder, in litres at surface pressure.
 *
 * Pressure, size, and the rig's cylinder count all follow the same
 * absent/contradictory policy
 * (see TankGas above): a field that was never recorded — or isn't a real
 * number at all — skips just that cylinder, so a diver who logged the main
 * cylinder but not the stage still gets a figure. A field that was recorded
 * with a value that can't describe a real cylinder (negative or transposed
 * pressure, a zero-or-negative size)
 * voids the whole total instead. Silently dropping a cylinder the diver did
 * record would understate gas used — the unsafe direction for gas planning:
 * a diver who sees no figure at all goes back and fixes the typo; one who
 * sees a plausible, quietly-wrong figure does not.
 *
 * The count is the one field where "absent" doesn't skip the cylinder — an
 * unrecorded rig still means "one cylinder", the brief-tested default. That
 * survived M1h's replacement of `count` by `configuration` unchanged, and
 * deliberately: `cylinderCount` returns `null` for a rig nobody recorded, so
 * a cylinder with a size and two pressures but no rig produces exactly the
 * figure it produced before, rather than losing its gas to a field the diver
 * never had to fill in.
 *
 * Every field on a cylinder is classified before any of them is acted on.
 * The alternative — decide on pressure, `continue` if it's absent, only
 * then look at size, only then at count — would let a contradictory size or
 * count hide behind an earlier absent field on that same cylinder: the loop
 * would move on before ever examining it, so the identical bad size would
 * void the total or silently vanish depending on whether its own cylinder's
 * pressure happened to also be absent, not on what was actually recorded.
 * Classifying pressure, size, and count up front — then deciding — closes
 * that gap; a cylinder with any contradictory field voids the whole total
 * regardless of what else on it is merely unrecorded.
 */
export function gasUsedLitres(tanks: Tank[]): number | null {
  if (!Array.isArray(tanks)) return null;
  let total = 0;
  let counted = 0;
  for (const tank of tanks) {
    const pressure = tankGas(tank);
    const size = sizeGas(tank);
    const count = countGas(tank);

    if (pressure.kind === 'contradictory' || size.kind === 'contradictory' || count.kind === 'contradictory') {
      return null;
    }
    if (pressure.kind === 'absent' || size.kind === 'absent') continue;

    const tankCount = count.kind === 'ok' ? count.value : 1;
    total += pressure.usedBar * size.value * tankCount;
    counted += 1;
  }
  return counted > 0 && Number.isFinite(total) ? total : null;
}

/**
 * Respiratory minute volume: how much gas the diver would breathe per minute at
 * the surface. Dividing by the average ambient pressure is what makes dives at
 * different depths comparable.
 */
export function rmv(
  dive: Pick<Dive, 'tanks' | 'avgDepthM' | 'durationMin'>,
): number | null {
  if (!dive) return null;
  const litres = gasUsedLitres(dive.tanks);
  // A breathing diver cannot have an RMV of zero. gasUsedLitres legitimately
  // returns 0 for a stage bottle that was carried but never opened, but that
  // is not a real RMV — and understating RMV is the unsafe direction for gas
  // planning, so this is null, not 0.
  if (litres === null || litres <= 0) return null;
  if (!isNumber(dive.avgDepthM) || dive.avgDepthM < 0) return null;
  if (!isNumber(dive.durationMin) || dive.durationMin <= 0) return null;
  const ata = dive.avgDepthM / METRES_PER_BAR + 1;
  const value = litres / ata / dive.durationMin;
  // Number.isFinite(0) is true, so finiteness alone doesn't reject a zero
  // RMV here any more than it did before litres <= 0 was guarded above: a
  // denormal litres divided by a large enough durationMin can underflow all
  // the way down to exactly 0, the same unreal-RMV shape as that guard, just
  // reached by underflow instead of a literal zero going in. value > 0
  // catches that; Number.isFinite is kept alongside it, not replaced by it —
  // value > 0 alone would accept Infinity too (Infinity > 0 is true), which
  // is the overflow this file already rejects a few lines up.
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A gas fraction is a percentage of the mix, so it lives in [0, 100]. */
const FULL_MIX_PCT = 100;

/**
 * The nitrogen fraction of a mix, as a percentage — `100 − O₂ − He`.
 *
 * **Nitrogen is computed, never stored** (DESIGN.md §10): O₂ + He + N₂ = 100, so two
 * numbers describe every mix a diver will log, and storing the third would be a third home
 * for one fact and a cylinder that can disagree with itself. Air's ~1 % argon is counted as
 * nitrogen exactly as every dive planner counts it. §0.6 draws the result with the muted `=`
 * prefix, beside surface interval and RMV, because anything in this file is marked as
 * computed.
 *
 * **Both fractions are required, and a missing helium is NOT read as zero.** That is the
 * decision worth stating, because it costs the common case: a diver who records 32 % O₂ and
 * leaves He blank gets no nitrogen figure, even though nitrox 32 is obviously 68 % N₂ to a
 * human reading it. Defaulting the blank to 0 would be this file inventing a reading — the
 * thing every other function here refuses to do — and it would be inventing it in the
 * direction that *understates* inert gas, which is the unsafe one for a diver eyeing
 * narcosis or a deco plan. An absent field means the diver did not say, and "did not say"
 * is not "zero"; the same distinction `countGas` above keeps between a rig nobody recorded
 * and a single cylinder.
 *
 * Refuses a mix that is not a real one rather than a number a diver might act on, in the
 * same shape `mod` below does: a fraction outside [0, 100] is not a percentage of anything,
 * and O₂ + He above 100 leaves a *negative* nitrogen fraction, which is not a mix — it is a
 * typo in one of the two fields it was computed from.
 */
export function nitrogenPct(
  o2Pct: number | null | undefined,
  hePct: number | null | undefined,
): number | null {
  if (!isNumber(o2Pct) || !isNumber(hePct)) return null;
  if (o2Pct < 0 || o2Pct > FULL_MIX_PCT || hePct < 0 || hePct > FULL_MIX_PCT) return null;
  const nitrogen = FULL_MIX_PCT - o2Pct - hePct;
  return nitrogen >= 0 ? nitrogen : null;
}

/**
 * Maximum operating depth for a mix, in metres — the depth at which oxygen
 * partial pressure reaches the ceiling. Returns null for a mix that is not a
 * real one, rather than a number a diver might act on.
 *
 * `o2Pct` is bounded to (0, 100] and deliberately has no floor above 0, even
 * though `mod(0.32, 1.4)` — the realistic typo, an O₂ fraction entered where a
 * percentage was wanted — returns an absurd 4365 m. Two reasons. Hypoxic
 * trimix bottom gas is genuinely below 21 % (a 10/70 mix is a real gas and
 * `mod(10)` → 130 m is its correct MOD), so any floor worth the name would
 * return null for correct technical input; and this function is monotonically
 * decreasing in `o2Pct`, so **no input in (0, 100] can return a MOD shallower
 * than the truth**. Under-reporting is the unsafe direction for a maximum
 * operating depth and it is unreachable here; every failure mode over-reports,
 * absurdly. That is the difference between this and `timeOut` above: an absurd
 * number is reported as a bug, a plausible one is acted on.
 */
export function mod(
  o2Pct: number | null | undefined,
  ppO2Max: number = DEFAULT_PPO2_MAX,
): number | null {
  if (!isNumber(o2Pct) || o2Pct <= 0 || o2Pct > 100) return null;
  if (!isNumber(ppO2Max)) return null;
  // Guard the result, not just the inputs: a ceiling at or below the mix's own
  // partial pressure at the surface (ppO2Max <= o2Pct / 100 — not only ppO2Max
  // <= 0) yields a zero or negative depth, which is not a real operating limit.
  // >= 0 deliberately keeps the legitimate mod(100, 1.0) -> 0 m.
  const depth = (ppO2Max / (o2Pct / 100) - 1) * METRES_PER_BAR;
  return depth >= 0 ? depth : null;
}

function toClock(wholeMinutes: number): string {
  const wrapped = ((wholeMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Wall-clock time the diver surfaced, wrapping past midnight.
 *
 * The wrap in `toClock` is deliberate and its legitimate domain is exactly one
 * day: a dive entered at 23:30 running 60 minutes surfaces at 00:30. Beyond a
 * day the same wrap silently folds a typo into a plausible clock time —
 * `timeOut('09:00', 2000)` used to read "18:20" and `timeOut('09:00', 4500)`
 * "12:00", while `timeOut('00:00', Number.MAX_VALUE)` read "02:08". A duration
 * of a day or more cannot describe one dive, so it gets the same refusal every
 * other function in this file gives data it cannot stand behind. This was the
 * only derived value that emitted a plausible wrong number instead of none,
 * and the file's own argument against that is a few lines up: a diver who sees
 * no figure goes back and fixes the typo; one who sees a plausible,
 * quietly-wrong figure does not.
 *
 * §1's "never block a save" is not in tension — this returns null from a
 * *derived* value, it does not reject anything the diver entered.
 */
export function timeOut(timeIn: string | null, durationMin: number | null): string | null {
  if (timeIn === null || !isNumber(durationMin) || durationMin < 0) return null;
  // durationMin is diver-entered and may carry a fraction (44.5 min). Round to
  // whole minutes here rather than inside toClock, so the bound below is
  // checked against the same value the clock arithmetic actually uses —
  // otherwise 1439.6 slips past a raw `< 1440` test and then rounds up into a
  // full day's wrap, which is the exact failure being closed.
  const minutes = Math.round(durationMin);
  if (minutes >= MINUTES_PER_DAY) return null;
  const start = timeOfDayToMinutes(timeIn);
  if (start === null) return null;
  return toClock(start + minutes);
}

/**
 * Minutes on the surface between one dive surfacing and the next descending.
 * Null when either time is unknown, when the previous dive's duration is
 * unknown or not a real number, when the pair is out of order — an interval
 * that ran backwards means the data is wrong, not that it was zero — or when
 * the interval is a day or more.
 *
 * That upper bound is new, and mirrors `timeOut`'s own a few functions up.
 * Without it, two logged dives a year apart produced "525555 min" — a number
 * that describes nothing a diver plans around, only a fully off-gassed diver
 * a year later. Surface interval is a repetitive-dive concept: it feeds a
 * diver's sense of residual nitrogen, and that stops applying long before a
 * gap reaches a day, let alone a year. Rejecting it here, rather than merely
 * formatting it more kindly at display, keeps the same "no number beats a
 * wrong (or meaningless) one" stance every other guard in this file takes,
 * and stops a screen from having to reinvent this file's own judgement about
 * what a surface interval is for.
 *
 * The previous duration is required rather than defaulted to zero. Defaulting
 * it would measure the interval from the previous dive's entry time instead
 * of from when the diver actually surfaced, which overstates the interval —
 * and for a number that sits next to a diver's own nitrogen-loading judgement
 * calls, overstating is the unsafe direction. No number beats a wrong number.
 */
export function surfaceIntervalMin(
  previous: Pick<Dive, 'date' | 'timeIn' | 'durationMin'>,
  next: Pick<Dive, 'date' | 'timeIn'>,
): number | null {
  if (!previous || !next) return null;
  if (previous.timeIn === null || next.timeIn === null) return null;
  const previousStart = timeOfDayToMinutes(previous.timeIn);
  const nextStart = timeOfDayToMinutes(next.timeIn);
  if (previousStart === null || nextStart === null) return null;
  if (!isNumber(previous.durationMin) || previous.durationMin < 0) return null;

  // Both dates go through datetime.ts, which requires each to round-trip
  // rather than merely parse. Date.parse alone rolls an impossible day
  // forward instead of rejecting it ('2026-02-30' becomes 2026-03-02), and
  // when it is the *next* dive carrying that date the roll silently
  // overstates this interval by a full 24 hours — the direction the docblock
  // above names as the unsafe one. The mirror case was already caught by the
  // `interval >= 0` guard below, which is why only half of it was ever
  // visible.
  const previousDay = calendarDateToUtcMs(previous.date);
  const nextDay = calendarDateToUtcMs(next.date);
  if (previousDay === null || nextDay === null) return null;
  const dayOffsetMin = (nextDay - previousDay) / 60000;

  const surfaced = previousStart + previous.durationMin;
  const interval = dayOffsetMin + nextStart - surfaced;
  return interval >= 0 && interval < MINUTES_PER_DAY ? interval : null;
}

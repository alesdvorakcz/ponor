import type { Dive, Tank } from './types';

/** Metres of sea water per bar of ambient pressure. */
const METRES_PER_BAR = 10;
/** The conservative oxygen partial-pressure ceiling most agencies teach. */
const DEFAULT_PPO2_MAX = 1.4;

function isNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * A cylinder's pressure data falls into one of three buckets:
 *  - 'ok': both pressures are present, physically real, and end <= start.
 *  - 'absent': a pressure was never recorded — the diver simply didn't log it.
 *  - 'contradictory': pressures were recorded but describe something physically
 *    impossible (negative, or the cylinder ending fuller than it started) — a
 *    transcription slip, not a missing measurement.
 * The distinction matters to gasUsedLitres: absent data for one cylinder
 * shouldn't stop the others from being counted, but contradictory data must
 * not be silently dropped as if it were merely unrecorded.
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

/** Pressure consumed from one cylinder, or null if it cannot be known. */
export function usedBar(tank: Tank): number | null {
  const gas = tankGas(tank);
  return gas.kind === 'ok' ? gas.usedBar : null;
}

/**
 * Free gas consumed across every cylinder, in litres at surface pressure.
 *
 * A cylinder with absent pressure data (never recorded) is skipped rather
 * than voiding the dive — a diver who recorded the main cylinder but not the
 * stage should still get a figure. A cylinder with contradictory pressure
 * data (recorded, but physically impossible — e.g. transposed start/end) is
 * different: silently discarding a cylinder the diver did record would
 * understate the total, which is the unsafe direction for gas planning, so
 * that voids the whole figure instead of just that cylinder.
 */
export function gasUsedLitres(tanks: Tank[]): number | null {
  if (!Array.isArray(tanks)) return null;
  let total = 0;
  let counted = 0;
  for (const tank of tanks) {
    const gas = tankGas(tank);
    if (gas.kind === 'contradictory') return null;
    if (gas.kind === 'absent') continue;
    // A cylinder can't hold zero or negative litres — treat that entry the same
    // way as one whose size was never recorded, rather than as valid data.
    if (!isNumber(tank.sizeL) || tank.sizeL <= 0) continue;
    const count = isNumber(tank.count) && tank.count > 0 ? tank.count : 1;
    total += gas.usedBar * tank.sizeL * count;
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
  return Number.isFinite(value) ? value : null;
}

/**
 * Maximum operating depth for a mix, in metres — the depth at which oxygen
 * partial pressure reaches the ceiling. Returns null for a mix that is not a
 * real one, rather than a number a diver might act on.
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

function toMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function toClock(minutes: number): string {
  // durationMin is a diver-entered number and may carry a fraction (44.5 min);
  // round to the nearest whole minute on entry so the result is always a real
  // HH:MM and never "08:56.5".
  const rounded = Math.round(minutes);
  const wrapped = ((rounded % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Wall-clock time the diver surfaced, wrapping past midnight. */
export function timeOut(timeIn: string | null, durationMin: number | null): string | null {
  if (timeIn === null || !isNumber(durationMin) || durationMin < 0) return null;
  const start = toMinutes(timeIn);
  if (start === null) return null;
  return toClock(start + durationMin);
}

/**
 * Minutes on the surface between one dive surfacing and the next descending.
 * Null when either time is unknown, when the previous dive's duration is
 * unknown or not a real number, or when the pair is out of order — an
 * interval that ran backwards means the data is wrong, not that it was zero.
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
  const previousStart = toMinutes(previous.timeIn);
  const nextStart = toMinutes(next.timeIn);
  if (previousStart === null || nextStart === null) return null;
  if (!isNumber(previous.durationMin) || previous.durationMin < 0) return null;

  const previousDay = Date.parse(`${previous.date}T00:00:00Z`);
  const nextDay = Date.parse(`${next.date}T00:00:00Z`);
  if (Number.isNaN(previousDay) || Number.isNaN(nextDay)) return null;
  const dayOffsetMin = (nextDay - previousDay) / 60000;

  const surfaced = previousStart + previous.durationMin;
  const interval = dayOffsetMin + nextStart - surfaced;
  return interval >= 0 ? interval : null;
}

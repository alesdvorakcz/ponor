import type { Dive, Tank } from './types';

/** Metres of sea water per bar of ambient pressure. */
const METRES_PER_BAR = 10;
/** The conservative oxygen partial-pressure ceiling most agencies teach. */
const DEFAULT_PPO2_MAX = 1.4;

function isNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Pressure consumed from one cylinder, or null if it cannot be known. */
export function usedBar(tank: Tank): number | null {
  if (!tank || !isNumber(tank.startBar) || !isNumber(tank.endBar)) return null;
  const used = tank.startBar - tank.endBar;
  return used >= 0 ? used : null;
}

/**
 * Free gas consumed across every cylinder, in litres at surface pressure.
 * Cylinders that cannot be computed are skipped rather than voiding the dive —
 * a diver who recorded pressures for the main cylinder but not the stage should
 * still get a figure.
 */
export function gasUsedLitres(tanks: Tank[]): number | null {
  if (!Array.isArray(tanks)) return null;
  let total = 0;
  let counted = 0;
  for (const tank of tanks) {
    const used = usedBar(tank);
    // A cylinder can't hold zero or negative litres — treat that entry the same
    // way as one whose size was never recorded, rather than as valid data.
    if (used === null || !isNumber(tank.sizeL) || tank.sizeL <= 0) continue;
    const count = isNumber(tank.count) && tank.count > 0 ? tank.count : 1;
    total += used * tank.sizeL * count;
    counted += 1;
  }
  return counted > 0 ? total : null;
}

/**
 * Respiratory minute volume: how much gas the diver would breathe per minute at
 * the surface. Dividing by the average ambient pressure is what makes dives at
 * different depths comparable.
 */
export function rmv(
  dive: Pick<Dive, 'tanks' | 'avgDepthM' | 'durationMin'>,
): number | null {
  const litres = gasUsedLitres(dive.tanks);
  if (litres === null) return null;
  if (!isNumber(dive.avgDepthM) || dive.avgDepthM < 0) return null;
  if (!isNumber(dive.durationMin) || dive.durationMin <= 0) return null;
  const ata = dive.avgDepthM / METRES_PER_BAR + 1;
  return litres / ata / dive.durationMin;
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
  // The ceiling is as much a part of "is this a real request" as the mix is —
  // a zero or negative ppO2Max would otherwise produce a negative depth that
  // reads as a plausible, and wrong, safety limit.
  if (!isNumber(ppO2Max) || ppO2Max <= 0) return null;
  return (ppO2Max / (o2Pct / 100) - 1) * METRES_PER_BAR;
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
  const wrapped = ((minutes % 1440) + 1440) % 1440;
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
 * Null when either time is unknown, or when the pair is out of order — an
 * interval that ran backwards means the data is wrong, not that it was zero.
 */
export function surfaceIntervalMin(
  previous: Pick<Dive, 'date' | 'timeIn' | 'durationMin'>,
  next: Pick<Dive, 'date' | 'timeIn'>,
): number | null {
  if (previous.timeIn === null || next.timeIn === null) return null;
  const previousStart = toMinutes(previous.timeIn);
  const nextStart = toMinutes(next.timeIn);
  if (previousStart === null || nextStart === null) return null;
  // An unrecorded previous duration is treated as 0 below — the previous dive's
  // timeIn is the best surfacing estimate we have. But a duration that is present
  // and impossible (negative, or not a real number) is corrupt, not merely
  // unknown, and should not be silently folded into that same default.
  if (previous.durationMin !== null && (!isNumber(previous.durationMin) || previous.durationMin < 0)) {
    return null;
  }

  const previousDay = Date.parse(`${previous.date}T00:00:00Z`);
  const nextDay = Date.parse(`${next.date}T00:00:00Z`);
  if (Number.isNaN(previousDay) || Number.isNaN(nextDay)) return null;
  const dayOffsetMin = (nextDay - previousDay) / 60000;

  const surfaced = previousStart + (previous.durationMin ?? 0);
  const interval = dayOffsetMin + nextStart - surfaced;
  return interval >= 0 ? interval : null;
}

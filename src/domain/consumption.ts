import type { DiveSample } from '../db/schema';
import { rmvFrom } from './derived';
import type { ProfilePoint } from './profile';
import { cylinderCount, type Tank } from './types';

/**
 * The moving window's width, seconds. §4.2 of the profile spec measured it against the
 * reference dive rendered by the Suunto app: 60 s reproduces the shape of Suunto's own curve,
 * has no negative readings, and its mean sits closest to the whole-dive figure `derived.ts`
 * computes independently (180 s, tried first for an unrelated reason, flattened exactly the
 * peaks Suunto shows). A named constant because the owner asked to be able to tune it.
 */
export const PROFILE_RMV_WINDOW_S = 60;

/**
 * The shallowest a window's mean depth may be and still produce a point. As depth approaches
 * the surface `ata` approaches 1, so any pressure change inflates into an implausible rate —
 * and a diver at that depth is often off the regulator entirely. §4.3 of the profile spec.
 */
export const PROFILE_RMV_MIN_DEPTH_M = 1.5;

function isNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Instantaneous RMV over a moving `PROFILE_RMV_WINDOW_S`-second window — the consumption curve's
 * second series, drawn beside the depth profile (profile spec §4). Every arithmetic step is
 * `derived.ts`'s own `rmvFrom`: that module owns surface-equivalent consumption for a whole dive
 * and this file owns it for one window, and a second copy of the formula here would let the
 * chart and the Stats screen's figure tell a diver two different numbers about the same dive.
 *
 * **A point only where a complete window exists.** For each start index `i` this advances `j`
 * until the span reaches the window width; if `j` runs off the end of the series first, the
 * window has shrunk rather than completed and this stops emitting entirely; every later `i`
 * would shrink further still, since the series is chronological and the samples that remain
 * only get scarcer. The first implementation widened its window until it ran out of samples
 * instead, and a window that shrinks down to noisy 10-second readings produced a phantom 36
 * l/min spike at the dive's end — the tallest, least meaningful point on the chart.
 *
 * **No point where the window's mean depth is below `PROFILE_RMV_MIN_DEPTH_M`.** Skipped rather
 * than broken out of, since a diver can descend again after a shallow stretch.
 *
 * Each point is anchored at the window's midpoint, not its start — the reading describes the
 * whole span, and the midpoint is the least misleading single instant to hang it on.
 *
 * Returns `[]` when the tank carries no `sizeL` (litres cannot be known at all) or when not one
 * sample in the series carries a pressure — a dive logged without a tank transmitter, which
 * `usedBar`/`gasUsedLitres` already treat as absent rather than zero.
 */
export function consumptionSeries(samples: readonly DiveSample[], tank: Tank): ProfilePoint[] {
  if (!tank || !isNumber(tank.sizeL) || tank.sizeL <= 0) return [];
  if (!samples.some((sample) => isNumber(sample[3]))) return [];

  // Absent is the one classification that does not skip a cylinder (derived.ts's `countGas`):
  // an unrecorded rig still means one cylinder, and that fallback has to be read from
  // `cylinderCount` and matched here exactly rather than re-decided, or this window's figure
  // and gasUsedLitres's whole-dive figure could disagree over nothing more than a rig nobody
  // recorded.
  const cylinders = cylinderCount(tank.configuration) ?? 1;

  const points: ProfilePoint[] = [];
  // `j` persists across the outer loop rather than restarting at `i` each time: the series is
  // chronological, so the smallest `j` completing a window can only move forward as `i` does,
  // and re-deriving it from `i` every time would just repeat work this already did.
  let j = 0;

  for (let i = 0; i < samples.length; i++) {
    const start = samples[i];
    // `noUncheckedIndexedAccess`'s claim, not a real possibility: `i < samples.length` by the
    // loop condition. Narrowing it explicitly is what lets every read below stay a plain index
    // rather than a suppression comment (tsconfig.json's own rule for this file).
    if (start === undefined) break;

    let end = samples[j];
    while (end !== undefined && end[0] - start[0] < PROFILE_RMV_WINDOW_S) {
      j++;
      end = samples[j];
    }
    // The remaining span can only shrink as i advances (the series is chronological), so once
    // one window runs past the end, every later one would too — stopping here rather than
    // `continue`ing is what keeps a trailing partial window from ever reaching rmvFrom.
    if (end === undefined) break;

    let depthSum = 0;
    for (const sample of samples.slice(i, j + 1)) depthSum += sample[1];
    const meanDepthM = depthSum / (j - i + 1);
    if (meanDepthM < PROFILE_RMV_MIN_DEPTH_M) continue;

    const startBar = start[3];
    const endBar = end[3];
    // A gap in per-sample pressure inside an otherwise-transmitting dive — null minus a number
    // coerces to a number in JS, which would silently fabricate a litres figure rather than
    // skip the one window that can't support it.
    if (!isNumber(startBar) || !isNumber(endBar)) continue;

    const litres = (startBar - endBar) * tank.sizeL * cylinders;
    const spanSeconds = end[0] - start[0];
    const value = rmvFrom(litres, meanDepthM, spanSeconds / 60);
    if (value === null) continue;

    points.push({ t: (start[0] + end[0]) / 2, v: value });
  }

  return points;
}

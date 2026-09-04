/**
 * **Work, or `null` when the clock ran out first** — the one race in this app between a
 * platform call that may never answer and a diver waiting for it.
 *
 * It lived inside `platform/location.ts` until `platform/geocode.ts` needed exactly it (M2o).
 * Both are calls into the device that can hang for ever — a cold GPS receiver under a steel
 * deck, a reverse geocode with no signal — and both are made while a diver watches a control
 * that has gone quiet, so both have to come back. §4.1: a second implementation is a defect,
 * and the details below are exactly the kind that get one right and the other subtly wrong.
 *
 * **`null` rather than a rejection**, so the caller tells "it took too long" from "it failed"
 * by the value instead of by inspecting an error it did not raise. A timeout is not an error
 * here: on both call sites it is a sentence a diver reads, not an exception anybody handles.
 *
 * **The timer is cleared on every path, the winning one included**: a twenty-second timer left
 * running holds the timer queue open long after the answer is on screen, and under Jest's fake
 * timers it is the difference between a test that ends and one that does not.
 *
 * **`Promise.race` attaches its own handler to both promises**, so work that rejects *after*
 * the timeout has already answered is handled rather than surfacing as an unhandled rejection.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

import {
  initialScrollVisibility,
  nextScrollVisibility,
  SCROLL_VISIBILITY_THRESHOLD,
  type ScrollVisibilityState,
} from './useHideOnScroll';

// DESIGN.md §0.6 ("The search field yields to the list") plus M1c's task 8 brief. Only
// `nextScrollVisibility` is covered here, not the `useHideOnScroll` hook itself — the
// same split useWideLayout.ts draws between `isWide` (pure, tested at its boundary) and
// `useWideLayout` (a thin live wrapper, "no branch of its own to get wrong"). The hook's
// own extra branch — `forceVisible` — is wiring into DivesScreen's zero-results state,
// and is proven there instead (DivesScreen.test.tsx), the same way this codebase already
// proves e.g. `handleReorder`'s gate through the screen that wires it up rather than in
// isolation.

// Brief's #1, "no jitter": a movement well under the threshold must not hide the field.
it('ignores a small downward scroll', () => {
  const next = nextScrollVisibility(initialScrollVisibility, 10); // well under the 24px threshold
  expect(next.hidden).toBe(false);
});

// The threshold pinned at its EXACT boundary, both sides — not just "some small number
// doesn't hide it, some big number does," which would pass even if the comparison used
// the wrong operator (`>` instead of `>=`) or the wrong constant entirely.
it('hides once downward movement reaches the threshold, and not one px sooner', () => {
  const justUnder = nextScrollVisibility(initialScrollVisibility, SCROLL_VISIBILITY_THRESHOLD - 1);
  expect(justUnder.hidden).toBe(false);
  const atThreshold = nextScrollVisibility(initialScrollVisibility, SCROLL_VISIBILITY_THRESHOLD);
  expect(atThreshold.hidden).toBe(true);
});

// The mirror case, from an already-hidden state — brief's #2, "scrolling up ... should
// bring it back" — pinned at the same exact boundary as the hide side above.
it('shows again once upward movement reaches the threshold, and not one px sooner', () => {
  const hiddenAt200: ScrollVisibilityState = { hidden: true, lastY: 200, accum: 0 };
  const justUnder = nextScrollVisibility(hiddenAt200, 200 - (SCROLL_VISIBILITY_THRESHOLD - 1));
  expect(justUnder.hidden).toBe(true); // still hidden — not quite enough upward movement yet
  const atThreshold = nextScrollVisibility(hiddenAt200, 200 - SCROLL_VISIBILITY_THRESHOLD);
  expect(atThreshold.hidden).toBe(false);
});

// Brief's #1 again, the realistic shape of the failure it warns about: a settled scroll
// still wobbles a few px per event (momentum rounding, a finger not perfectly still).
// None of these individual steps get anywhere near the threshold, so — proven as a
// sequence, not a single sample — the field must never flip mid-wobble.
it('never flips on a settled scroll that wobbles a few px per event', () => {
  let state = nextScrollVisibility(initialScrollVisibility, 40); // a real scroll down, past the threshold
  expect(state.hidden).toBe(true);
  for (const y of [42, 40, 42, 40, 41, 39, 41]) {
    state = nextScrollVisibility(state, y);
    expect(state.hidden).toBe(true);
  }
});

// Brief's #2, the unconditional half: "it must always be visible at the top of the
// list" — independent of the accumulator, which here is primed as if it were about to
// hide the field further. `lastY: 15` is deliberate, not arbitrary: the raw delta to
// y=0 is only -15, well short of the -24 the accumulator branch would need on its own
// (20 + -15 = 5), so this only passes if the top rule itself fires — a first version of
// this test used `lastY: 500`, where that same -15-vs-24 arithmetic no longer applies:
// the resulting -480 delta crosses the accumulator's own threshold unassisted, so it
// passed even with the top rule's `<=` mutated to `<` (verified by deliberately
// re-introducing that mutation against the old numbers before settling on these).
it('is visible at the top of the list regardless of what the accumulator was mid-tracking', () => {
  const primedToHideFurther: ScrollVisibilityState = { hidden: true, lastY: 15, accum: 20 };
  expect(nextScrollVisibility(primedToHideFurther, 0)).toEqual({ hidden: false, lastY: 0, accum: 0 });
});

// The accumulator reset at the top must be real, not cosmetic: if a stale `accum`
// survived, a single small nudge right after reaching the top could immediately hide the
// field again with almost no movement — exactly the jitter brief #1 rules out. Same
// small-`lastY` shape as the test above and for the same reason: the raw delta to y=0
// must be too small to cross the accumulator's own threshold by itself.
it("resets the accumulator at the top, not just the hidden flag — so a stale accumulator can't hide it again on the next tiny nudge", () => {
  const almostAtTop: ScrollVisibilityState = { hidden: true, lastY: 15, accum: SCROLL_VISIBILITY_THRESHOLD - 4 }; // 20
  const atTop = nextScrollVisibility(almostAtTop, 0);
  expect(atTop).toEqual({ hidden: false, lastY: 0, accum: 0 });
  // If accum had survived at 20 instead of resetting to 0, a further 4px nudge down would
  // total 24 and hide it again immediately; from the correctly-reset state it must not.
  const smallNudge = nextScrollVisibility(atTop, 4);
  expect(smallNudge.hidden).toBe(false);
});

// A small negative offset (iOS's top bounce) counts as "the top" too, not just exactly
// 0 — again with a small `lastY` so the raw delta (-7) can't cross the accumulator's own
// threshold unassisted.
it('treats a bounced negative offset as the top', () => {
  const hidden: ScrollVisibilityState = { hidden: true, lastY: 5, accum: 0 };
  expect(nextScrollVisibility(hidden, -2).hidden).toBe(false);
});

// The pair the task brief specifically warns about conflating: hiding and showing each
// proven by a transition that could not have passed "by accident" — the down step starts
// from the true initial state (so it only passes if hiding actually works), and the up
// step starts from THAT result already hidden (so it only passes if showing actually
// works from there, not merely "was never hidden to begin with"). Both deltas are large
// and unambiguous, clear of the threshold's exact boundary (already pinned above) and of
// y = 0 (the separate top-of-list rule, already pinned above too), so this is purely the
// sustained-direction mechanism.
it('hides on a sustained downward scroll and shows again on a sustained upward one', () => {
  const scrolledDown = nextScrollVisibility(initialScrollVisibility, 100);
  expect(scrolledDown.hidden).toBe(true);
  const scrolledBackUp = nextScrollVisibility(scrolledDown, 50);
  expect(scrolledBackUp.hidden).toBe(false);
});

import { useRef, useState } from 'react';
import { LayoutAnimation, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

/**
 * DESIGN.md §0.6: "The search field yields to the list. It hides as the list scrolls
 * down and returns on the way back up." Tracked as three primitives rather than a
 * single signed delta so `nextScrollVisibility` below can require sustained movement in
 * ONE direction before it flips `hidden`, instead of reacting to any one event's raw
 * sign — `lastY` is the offset the accumulator is measured from, `accum` is the running
 * same-direction total since the last flip (or the last time it was overridden back to
 * zero at the top).
 */
export interface ScrollVisibilityState {
  hidden: boolean;
  lastY: number;
  accum: number;
}

export const initialScrollVisibility: ScrollVisibilityState = { hidden: false, lastY: 0, accum: 0 };

/**
 * How many px of NET same-direction scroll it takes to flip visibility. High enough
 * that ordinary momentum/bounce noise (a few px of back-and-forth as a fling settles)
 * can never cross it by itself — task brief's "no jitter": "ignore small movements — a
 * threshold, not a raw delta sign." Low enough that one deliberate flick reads as a
 * direction within a couple of throttled scroll events.
 *
 * Deliberately the SAME value for both directions rather than a smaller "show"
 * threshold: the brief's "scrolling up at all should bring it back" reads as "a small
 * *deliberate* upward scroll, from anywhere in the list, is enough" — not "any raw
 * upward wobble, however tiny, must reveal it," which would just relocate the jitter
 * problem to the show side. The brief's OTHER, unconditional guarantee — "it must
 * always be visible at the top of the list" — is what TOP_OFFSET below actually
 * enforces, independent of this accumulator entirely.
 */
export const SCROLL_VISIBILITY_THRESHOLD = 24;

/** Content is "at the top" at or above this offset. iOS reports small negative
 * `contentOffset.y` values during the top rubber-band bounce, hence `<=`, not `===`. */
const TOP_OFFSET = 0;

/**
 * Pure reducer: one scroll sample in, the next state out. Kept free of React/animation
 * entirely, the same split useWideLayout.ts draws between `isWide` (pure, tested at its
 * boundary) and `useWideLayout` (a thin live wrapper) — so the threshold, the jitter
 * floor, and the "always visible at top" rule can all be pinned directly, at exact
 * boundary values, with nothing rendered and no timer involved.
 */
export function nextScrollVisibility(state: ScrollVisibilityState, y: number): ScrollVisibilityState {
  if (y <= TOP_OFFSET) {
    // Unconditional: independent of whatever the accumulator below was mid-tracking,
    // so a diver who nudges up and down near the top in steps too small to individually
    // cross the threshold can never get stuck with the field hidden once they actually
    // reach it.
    return { hidden: false, lastY: y, accum: 0 };
  }
  const accum = state.accum + (y - state.lastY);
  if (accum >= SCROLL_VISIBILITY_THRESHOLD) return { hidden: true, lastY: y, accum: 0 };
  if (accum <= -SCROLL_VISIBILITY_THRESHOLD) return { hidden: false, lastY: y, accum: 0 };
  return { hidden: state.hidden, lastY: y, accum };
}

/**
 * DESIGN.md §0.6's collapse, via `LayoutAnimation` rather than `react-native-reanimated`
 * (in package.json, but its babel plugin — `react-native-worklets/plugin` as of the
 * installed 4.x — is not registered in babel.config.js, so its worklets never actually
 * compile) or the core `Animated` API (whose idiomatic form here — a `useRef`-held
 * `Animated.Value`, read during render to build the collapsing style — is exactly what
 * this repo's `react-hooks/refs` lint rule rejects: "Cannot access ref value during
 * render"; verified by writing that version first and running `npx eslint .` against
 * it before switching). `LayoutAnimation.configureNext`, called immediately before the
 * `setHidden` below, asks the platform to animate whatever layout/opacity difference
 * that state change produces on the NEXT commit — no `Animated.Value`, no interpolation,
 * no measured height to keep in sync with styles.ts, just a plain boolean and the two
 * styles DivesScreen.tsx composes from it (`searchBarCollapse`/`searchBarHidden`,
 * theme/styles.ts). `isLayoutAnimationEnabled` (RN's own
 * `ReactNativeFeatureFlags.js`) defaults `true` and nothing in this app overrides it.
 */
const COLLAPSE_ANIMATION_DURATION_MS = 200;
const COLLAPSE_ANIMATION = LayoutAnimation.create(
  COLLAPSE_ANIMATION_DURATION_MS,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);

export interface HideOnScroll {
  /** Gates both the collapsing style (DivesScreen.tsx) and interaction: pointerEvents
   * and the accessibility-hidden props, so a diver can never tap into, or have a
   * screen reader land on, a field that has (or is mid-collapsing to) zero height. */
  hidden: boolean;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

/**
 * DESIGN.md §0.6. `forceVisible` covers the one situation the scroll accumulator alone
 * cannot: a search that has just narrowed to zero results swaps the SectionList out for
 * a static "no dives match" message (DivesScreen.tsx), so there is no list left to
 * scroll back up on. Without this override, a diver who kept refining their query while
 * scrolled down — the keyboard does not blur on scroll, and SectionList's default
 * `keyboardDismissMode` is `'none'`, so typing into an already-focused field while
 * scrolled away keeps working — could narrow their search to zero results and be left
 * unable to see, or reach, the very field that would let them fix it.
 *
 * `setHidden(false)` below runs during render, not in an Effect: React's own documented
 * pattern for "adjusting state when a prop changes" (an Effect that calls `setState`
 * synchronously in its body is exactly what this repo's `react-hooks/set-state-in-effect`
 * rule rejects — and for good reason here too, since it would let one extra frame render
 * with the stale, still-hidden field before the reset commits).
 *
 * The tracked accumulator (`track`, below) is a `useRef`, and this repo's
 * `react-hooks/refs` rule rejects writing to a ref during render exactly as it rejects
 * reading one (verified directly: an earlier version reset `track.current` right here,
 * alongside `setHidden`, and that specific line was what `npx eslint .` flagged). It is
 * reset lazily instead, the next time `onScroll` actually runs: `pendingReset` (state)
 * is the signal carried from here to there. Left unset, a scroll fired against a
 * freshly-remounted SectionList (React remounts it as soon as results reappear, always
 * at the top) would keep computing deltas against wherever the OLD list's `track` was
 * last left, off by however far that was — nothing left permanently stuck, since
 * `hidden` itself is already correct by the time anything renders, but the first
 * post-reset scroll could misread its own direction. `pendingReset` closes that gap:
 * `onScroll` checks it before touching `track` at all, so the very first scroll against
 * the fresh list starts from a genuinely clean slate rather than a stale one.
 */
export function useHideOnScroll(forceVisible: boolean): HideOnScroll {
  const track = useRef<ScrollVisibilityState>(initialScrollVisibility);
  const [hidden, setHidden] = useState(false);
  // Sits true from the moment forceVisible is first seen true until `onScroll` next
  // consumes it (comment above) — `!pendingReset` is what stops this from re-firing on
  // every render forceVisible stays true for, and there is no need to separately track
  // "was forceVisible true last render": this same flag already answers it, since it is
  // only ever true while an unconsumed reset is outstanding.
  //
  // `setPendingReset(true)` is not just bookkeeping accuracy: it is what makes calling
  // setState during render (above) TERMINATE at all. Confirmed by deleting it alone —
  // `setHidden(false)` still runs every time this guard is entered, `forceVisible`
  // never changes out from under it mid-render, and with nothing to flip `pendingReset`
  // the guard reads true again on React's own immediate re-invocation, which calls
  // setState again, forever: React throws "Too many re-renders," not a quietly wrong
  // value. `!pendingReset` is therefore the half of the guard that actually closes.
  const [pendingReset, setPendingReset] = useState(false);

  if (forceVisible && !pendingReset) {
    setHidden(false);
    setPendingReset(true);
  }

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const prev = pendingReset ? initialScrollVisibility : track.current;
    if (pendingReset) setPendingReset(false);
    const next = nextScrollVisibility(prev, y);
    track.current = next;
    if (next.hidden !== prev.hidden) {
      LayoutAnimation.configureNext(COLLAPSE_ANIMATION);
      setHidden(next.hidden);
    }
  };

  return { hidden: forceVisible ? false : hidden, onScroll };
}

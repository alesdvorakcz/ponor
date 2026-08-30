import { router } from 'expo-router';

/**
 * Leaving a screen that sits on top of the dives list, for every screen that does.
 *
 * `router.canGoBack()` decides which navigation actually happens: both of this app's
 * stacked screens — a dive's detail (`DiveDetailScreen`) and the entry form
 * (`DiveFormScreen`, on a successful save) — are reachable directly by URL (a future share
 * link or notification), where there is no history to pop and `router.back()` would have
 * nothing to do. `router.replace` rather than `router.push` for that fallback, so a cold
 * deep-link launch does not grow the stack by one: landing back on `/` should behave like
 * arriving there fresh, not like a second Dives screen pushed on top of a first.
 *
 * One owner, not one copy per screen. Both screens held this identical five-line guard,
 * each under its own paragraph of the same reasoning — one rule written twice, which is
 * this codebase's most-repeated defect (`carryOver.ts`'s "hand-maintained second list",
 * `styles.ts`'s two notice banners, `useDives.ts`'s three re-derived ordering rules all
 * name the same failure). A third screen that needs an exit calls this rather than
 * retyping the guard, and a change to what "no history" should do happens once.
 *
 * Not a hook and not a component: it reads nothing from React and renders nothing, so a
 * screen can call it from an event handler or from the tail of an async save alike.
 */
export function backToDives(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}

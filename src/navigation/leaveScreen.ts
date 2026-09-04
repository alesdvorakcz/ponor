import { router, type Href } from 'expo-router';

/**
 * Leaving a screen that is stacked on top of another — the rule, once, for every screen
 * that has a way out.
 *
 * `router.canGoBack()` decides which navigation actually happens: every stacked screen in
 * this app — a dive's detail (`DiveDetailScreen`), the entry form (`DiveFormScreen`, on a
 * successful save), full-screen search (`SearchScreen`) and §3's preset editor
 * (`GearPresetScreen`) — is reachable directly by URL (a future share link or notification,
 * and a typed address in the browser build §9 keeps as a test target), where there is no
 * history to pop and `router.back()` would have nothing to do. `router.replace` rather than
 * `router.push` for that fallback, so a cold deep-link launch does not grow the stack by
 * one: landing back on the screen underneath should behave like arriving there fresh, not
 * like a second copy pushed on top of a first.
 *
 * One owner, not one copy per screen. Both stacked screens held this identical five-line
 * guard, each under its own paragraph of the same reasoning — one rule written twice, which
 * is this codebase's most-repeated defect (`carryOver.ts`'s "hand-maintained second list",
 * `styles.ts`'s two notice banners, `useDives.ts`'s three re-derived ordering rules all name
 * the same failure). A screen that needs an exit calls one of the two named exits below
 * rather than retyping the guard, and a change to what "no history" should do happens once.
 *
 * Not a hook and not a component: it reads nothing from React and renders nothing, so a
 * screen can call it from an event handler or from the tail of an async save alike.
 *
 * **`fallback` is the screen this one sits on top of, and it is the only thing the two exits
 * below differ in.** It was `/` outright while every stacked screen sat on the dives list;
 * §3's preset editor sits on Settings, and sending a diver who deep-linked into it back to
 * the logbook would answer a question they did not ask. Parameterised rather than copied for
 * the reason this module exists at all — and the two named exits stay, so no call site has to
 * know a route and none can pick a fallback by accident.
 */
export function leaveTo(fallback: Href): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}

/** The way out of a screen stacked on the dives list: the dive detail, the entry form, and
 * full-screen search. */
export function backToDives(): void {
  leaveTo('/');
}

/** The way out of a screen stacked on Settings — §3's cylinder-preset editor, which is
 * reached from the preset list on that screen and belongs back on it. */
export function backToSettings(): void {
  leaveTo('/settings');
}

/**
 * The way out of the centres directory (M3c), which is reached from §3's Map tab — the layer
 * that draws the centres the catalogue has a position for, and which is where a diver who
 * wanted the whole list pressed *All centres*.
 *
 * The Map rather than the Dives list, on `backToSettings`' own reasoning: a diver who deep-linked
 * into the directory and pressed the way out should land on the screen it belongs to, not on an
 * answer to a question they did not ask.
 */
export function backToMap(): void {
  leaveTo('/map');
}

/**
 * The way out of one centre's page (M3c). It is reached from three places — the directory, a
 * mark on the Map's centre layer, and a dive's own *Centre* row — which is exactly why the
 * fallback matters so little and the pop matters so much: `router.back()` returns to whichever
 * of the three it was, and the fallback is only ever consulted on a cold deep link, where the
 * directory is the screen this page belongs beneath.
 */
export function backToCenters(): void {
  leaveTo('/centers');
}

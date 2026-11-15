import { router } from 'expo-router';

import { newId } from '../domain/ids';
import type { MapPoint } from '../domain/mapSites';
import type { PlaceKind } from '../domain/placePicker';
import type { Entry, Salinity, WaterBody } from '../domain/types';

/**
 * Handing a pick back to the dive form — the one place that makes a pushed screen *return a
 * value*, which expo-router routes cannot do.
 *
 * The picker (and the *New dive site / centre* pages stacked on it, and a near-match's own site
 * page stacked on *New dive site*) are routes pushed over the dive form, which stays mounted underneath with its half-typed values. A route's params are
 * strings in a URL, so a callback cannot travel through them; instead the form registers a
 * request here under a fresh token, pushes the picker with only that token as its param, and the
 * picker (or a page stacked above it) completes the token. Completing calls the form's
 * `onPick` once and closes the screens that were pushed for the pick.
 *
 * **The registry is module state on purpose.** A request holds a function and the form's live
 * context, neither of which survives a URL, and it only needs to outlive the few seconds the
 * picker is open. The cost is that a JS reload under an open picker loses it — which is why
 * completing a token this module does not know *must not throw and must still close the
 * screens*: the diver is left looking at the form, unchanged, rather than at a stuck picker.
 *
 * **Completing is idempotent, and that is the registry's job, not each screen's.** A token is
 * *settled* once it has been completed or forgotten, and completing a settled token does nothing
 * at all: `onPick` has run (or never will), and the screens it would close are already going — a
 * second `dismiss` would pop the dive form itself and lose what was typed in it. So a double tap,
 * a pick racing `‹ Cancel`, or the next completer (the map picker, #30) cannot reach the form
 * twice, whatever guards its screen does or does not keep.
 *
 * That leaves two kinds of token this module cannot find, and they must be told apart: a **settled**
 * one (do nothing) and one it **never saw** in this JS context — the reload above — which still
 * closes the screens. Settled tokens are therefore remembered rather than only deleted; a token is
 * a short string and there is one per pick, so the set lives as long as the app does. The one cost:
 * under Fast Refresh in a dev build, the picker's unmount effect re-runs and forgets its token, so a
 * pick on that still-open page then does nothing and `‹ Cancel` is the way off.
 */

/** What the picker needs to know about the dive being edited — the pin, the water, the entry
 * type — to rank and group the places near it. `siteId` lets a centre pick look at the chosen
 * site. */
export interface DiveContext {
  pin: MapPoint | null;
  entry: Entry | null;
  salinity: Salinity | null;
  waterBody: WaterBody | null;
  siteId: string | null;
}

/** A chosen place; the second shape is "No centre" — clearing the field is a pick too. */
export type PlacePick = { id: string; name: string } | { id: null; name: '' };

export interface PlacePickRequest {
  kind: PlaceKind;
  /** What the form holds now, so the picker can mark it. */
  selected: { id: string | null; name: string } | null;
  dive: DiveContext;
  onPick: (pick: PlacePick) => void;
}

const requests = new Map<string, PlacePickRequest>();
/** Tokens completed or forgotten — see "Completing is idempotent" above. */
const settled = new Set<string>();

/** Registers the request under a fresh token and pushes the picker for its kind. */
export function openPlacePicker(request: PlacePickRequest): void {
  const token = newId();
  requests.set(token, request);
  router.push({ pathname: request.kind === 'site' ? '/pick/site' : '/pick/center', params: { token } });
}

/**
 * A route param as one string: expo-router types a param as `string | string[]`, and the picker's
 * `token` and the create page's `name` are each sent once, so the first is the one.
 */
export function firstParam(param: string | string[] | undefined): string | undefined {
  return Array.isArray(param) ? param[0] : param;
}

/** The request behind a token, or null when it was completed, forgotten or lost to a reload. */
export function placePickRequest(token: string): PlacePickRequest | null {
  return requests.get(token) ?? null;
}

/**
 * Delivers the pick to the form once, settles the token, and closes `screensToClose` screens —
 * 1 from the picker itself, 2 from a create page stacked on it, 3 from a near-match's site page
 * stacked on that (*Use this site*, PR #35). A token already settled does
 * nothing; one this module never saw (a reload) still closes the screens. The screens close even
 * when `onPick` throws, so a failure in the form cannot leave the picker standing over it.
 */
export function completePlacePick(token: string, pick: PlacePick, screensToClose: 1 | 2 | 3): void {
  if (settled.has(token)) return;
  const request = requests.get(token);
  requests.delete(token);
  settled.add(token);
  try {
    request?.onPick(pick);
  } finally {
    router.dismiss(screensToClose);
  }
}

/** Drops a request without delivering anything — the picker closed with no pick — and settles the
 * token, so a pick that lands after `‹ Cancel` cannot close a second screen. */
export function forgetPlacePick(token: string): void {
  requests.delete(token);
  settled.add(token);
}

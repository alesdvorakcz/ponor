import { router } from 'expo-router';

import { newId } from '../domain/ids';
import type { MapPoint } from '../domain/mapSites';
import type { PlaceKind } from '../domain/placePicker';
import type { Entry, Salinity, WaterBody } from '../domain/types';

/**
 * Handing a pick back to the dive form — the one place that makes a pushed screen *return a
 * value*, which expo-router routes cannot do.
 *
 * The picker (and the *New dive site / centre* pages stacked on it) are routes pushed over the
 * dive form, which stays mounted underneath with its half-typed values. A route's params are
 * strings in a URL, so a callback cannot travel through them; instead the form registers a
 * request here under a fresh token, pushes the picker with only that token as its param, and the
 * picker (or the create page two screens up) completes the token. Completing calls the form's
 * `onPick` once and closes the screens that were pushed for the pick.
 *
 * **The registry is module state on purpose.** A request holds a function and the form's live
 * context, neither of which survives a URL, and it only needs to outlive the few seconds the
 * picker is open. The cost is that a JS reload under an open picker loses it — which is why
 * completing a token this module does not know *must not throw and must still close the
 * screens*: the diver is left looking at the form, unchanged, rather than at a stuck picker.
 *
 * **Completing is idempotent.** A double tap on a row completes twice; the second finds the
 * token already forgotten, so `onPick` runs once, while the screens are still closed — the same
 * outcome as the unknown-token case, and for the same reason.
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

/** Registers the request under a fresh token and pushes the picker for its kind. */
export function openPlacePicker(request: PlacePickRequest): void {
  const token = newId();
  requests.set(token, request);
  router.push({ pathname: request.kind === 'site' ? '/pick/site' : '/pick/center', params: { token } });
}

/** The request behind a token, or null when it was completed, forgotten or lost to a reload. */
export function placePickRequest(token: string): PlacePickRequest | null {
  return requests.get(token) ?? null;
}

/**
 * Delivers the pick to the form once, forgets the token, and closes `screensToClose` screens —
 * 1 from the picker itself, 2 from a create page stacked on it.
 */
export function completePlacePick(token: string, pick: PlacePick, screensToClose: 1 | 2): void {
  const request = requests.get(token);
  requests.delete(token);
  request?.onPick(pick);
  router.dismiss(screensToClose);
}

/** Drops a request without delivering anything — the picker closed with no pick. */
export function forgetPlacePick(token: string): void {
  requests.delete(token);
}

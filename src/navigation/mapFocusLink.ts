import { type Href } from 'expo-router';

import { type MapFocus, type MapFocusKind } from '../domain/mapFocus';

/**
 * **The route to a map pointed at one place, and the way back from it** (issue #21).
 *
 * Three routes rather than one with a `kind` param, each nested under the page it is opened from
 * — `/dive/[id]/map`, `/site/[id]/map`, `/center/[id]/map` — on `/dive/[id]/edit`'s precedent:
 * the address says whose map it is, and typed routes (`app.config.ts`'s `experiments.typedRoutes`)
 * check each one against a file that exists, which a free-form `kind` string could not have.
 *
 * **Pushed over the page rather than switching to the Map tab, and that is what makes Back work.**
 * The page a diver presses *Show on map* on lives in the root Stack, over the tabs; switching to
 * the Map tab would pop it, and Back from the map would have nowhere to return to. A pushed map
 * returns to the dive the way every other pushed screen does, by swipe or by `‹ Back`, and it
 * leaves the Map tab's own camera and filter exactly where the diver left them.
 *
 * Written as one literal per kind rather than a template string, so each is checked against the
 * route tree on its own.
 */
export function mapFocusHref(focus: MapFocus): Href {
  // `over=page` says the map is pushed over the record's own page (`MapFocus.overItsPage`); it is
  // left off otherwise, so the address of an ordinary focused map stays just its id.
  const params = focus.overItsPage === true ? { id: focus.id, over: OVER_ITS_PAGE } : { id: focus.id };
  switch (focus.kind) {
    case 'dive':
      return { pathname: '/dive/[id]/map', params };
    case 'site':
      return { pathname: '/site/[id]/map', params };
    case 'center':
      return { pathname: '/center/[id]/map', params };
  }
}

/**
 * Where the focused map's `‹ Back` lands when there is nothing to pop. `leaveTo`
 * (navigation/leaveScreen.ts) pops whenever it can, so this is only that fallback: the page the map
 * was about, which is where Back would have gone had the diver arrived the ordinary way.
 *
 * **Measured both ways on the simulator.** A link that cold-launches the app lands on the map with
 * nothing under it, and Back reaches this — the site's page. A link into an app that is already
 * running is pushed over whatever was showing, so Back pops to *that* (the Dives list, say),
 * exactly as a deep-linked site page or dive detail already does.
 */
export function mapFocusOrigin(focus: MapFocus): Href {
  switch (focus.kind) {
    case 'dive':
      return { pathname: '/dive/[id]', params: { id: focus.id } };
    case 'site':
      return { pathname: '/site/[id]', params: { id: focus.id } };
    case 'center':
      return { pathname: '/center/[id]', params: { id: focus.id } };
  }
}

/**
 * A focus read back off one of the three routes. `useLocalSearchParams` can hand back `string[]`
 * for a repeated param, which every `[id]` route in this tree reads the same way.
 *
 * A missing id becomes `''` rather than no focus at all: the router never matches these routes
 * without one, so the case exists only in the param's type, and an empty id simply finds no record
 * — the map then opens framing everything, still with its way back, which is the right screen to
 * have pushed either way.
 */
export function mapFocusFromParams(kind: MapFocusKind, params: MapFocusParams): MapFocus {
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const over = Array.isArray(params.over) ? params.over[0] : params.over;
  return { kind, id: id ?? '', overItsPage: over === OVER_ITS_PAGE };
}

/** What the three focused-map routes read off their address. */
export type MapFocusParams = {
  id?: string | string[];
  over?: string | string[];
};

/** The one value of `over` that means anything — see `MapFocus.overItsPage`. */
const OVER_ITS_PAGE = 'page';

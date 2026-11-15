import { mapFocusFromParams, mapFocusHref, mapFocusOrigin } from './mapFocusLink';

// The three routes and the three ways back, pinned as literals: a wrong pathname here is not an
// error anywhere at runtime — the press pushes a route that does not exist, or Back lands on the
// wrong page — and typed routes only check that each one exists, not that it is the right one.

describe('mapFocusHref', () => {
  it('nests each map under the page it is opened from', () => {
    expect(mapFocusHref({ kind: 'dive', id: 'd1' })).toEqual({ pathname: '/dive/[id]/map', params: { id: 'd1' } });
    expect(mapFocusHref({ kind: 'dive', id: 'd1', overItsPage: false })).toEqual({ pathname: '/dive/[id]/map', params: { id: 'd1' } });
    expect(mapFocusHref({ kind: 'site', id: 's1' })).toEqual({ pathname: '/site/[id]/map', params: { id: 's1' } });
    expect(mapFocusHref({ kind: 'center', id: 'c1' })).toEqual({ pathname: '/center/[id]/map', params: { id: 'c1' } });
  });

  // #27's second review: only the page a map is pushed over can say it is that record's own page,
  // and it says so in the address — the map has no other way to know what lies beneath it.
  it('says when the map is pushed over the record’s own page', () => {
    expect(mapFocusHref({ kind: 'site', id: 's1', overItsPage: true })).toEqual({
      pathname: '/site/[id]/map',
      params: { id: 's1', over: 'page' },
    });
  });
});

describe('mapFocusOrigin', () => {
  it('falls back to the page the map is about', () => {
    expect(mapFocusOrigin({ kind: 'dive', id: 'd1' })).toEqual({ pathname: '/dive/[id]', params: { id: 'd1' } });
    expect(mapFocusOrigin({ kind: 'site', id: 's1' })).toEqual({ pathname: '/site/[id]', params: { id: 's1' } });
    expect(mapFocusOrigin({ kind: 'center', id: 'c1' })).toEqual({ pathname: '/center/[id]', params: { id: 'c1' } });
  });
});

describe('mapFocusFromParams', () => {
  it('reads the id off the route', () => {
    expect(mapFocusFromParams('site', { id: 's1' })).toEqual({ kind: 'site', id: 's1', overItsPage: false });
  });

  it('reads back whether the map is over the record’s own page, and nothing else as yes', () => {
    expect(mapFocusFromParams('site', { id: 's1', over: 'page' }).overItsPage).toBe(true);
    expect(mapFocusFromParams('site', { id: 's1', over: ['page', 'x'] }).overItsPage).toBe(true);
    expect(mapFocusFromParams('site', { id: 's1', over: 'yes' }).overItsPage).toBe(false);
    expect(mapFocusFromParams('site', { id: 's1' }).overItsPage).toBe(false);
  });

  it('round-trips a focus through its own address', () => {
    for (const focus of [
      { kind: 'dive', id: 'd1', overItsPage: true },
      { kind: 'center', id: 'c1', overItsPage: false },
    ] as const) {
      const href = mapFocusHref(focus) as unknown as { params: { id: string; over?: string } };
      expect(mapFocusFromParams(focus.kind, href.params)).toEqual(focus);
    }
  });

  it('takes the first of a repeated param, as every [id] route here does', () => {
    expect(mapFocusFromParams('dive', { id: ['d1', 'd2'] })).toEqual({ kind: 'dive', id: 'd1', overItsPage: false });
  });

  it('reads a missing id as an empty one, which finds no record', () => {
    expect(mapFocusFromParams('center', {})).toEqual({ kind: 'center', id: '', overItsPage: false });
  });
});

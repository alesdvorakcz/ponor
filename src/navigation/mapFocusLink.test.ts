import { mapFocusFromParams, mapFocusHref, mapFocusOrigin } from './mapFocusLink';

// The three routes and the three ways back, pinned as literals: a wrong pathname here is not an
// error anywhere at runtime — the press pushes a route that does not exist, or Back lands on the
// wrong page — and typed routes only check that each one exists, not that it is the right one.

describe('mapFocusHref', () => {
  it('nests each map under the page it is opened from', () => {
    expect(mapFocusHref({ kind: 'dive', id: 'd1' })).toEqual({ pathname: '/dive/[id]/map', params: { id: 'd1' } });
    expect(mapFocusHref({ kind: 'site', id: 's1' })).toEqual({ pathname: '/site/[id]/map', params: { id: 's1' } });
    expect(mapFocusHref({ kind: 'center', id: 'c1' })).toEqual({ pathname: '/center/[id]/map', params: { id: 'c1' } });
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
    expect(mapFocusFromParams('site', { id: 's1' })).toEqual({ kind: 'site', id: 's1' });
  });

  it('takes the first of a repeated param, as every [id] route here does', () => {
    expect(mapFocusFromParams('dive', { id: ['d1', 'd2'] })).toEqual({ kind: 'dive', id: 'd1' });
  });

  it('reads a missing id as an empty one, which finds no record', () => {
    expect(mapFocusFromParams('center', {})).toEqual({ kind: 'center', id: '' });
  });
});

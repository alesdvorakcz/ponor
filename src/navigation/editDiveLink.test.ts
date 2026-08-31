import { completeDiveHref, editDiveHref, openAsStatus } from './editDiveLink';

/**
 * The link to `/dive/[id]/edit`, from both ends.
 *
 * This module exists because the two ends live in files a test cannot otherwise reach
 * across: two screens push these hrefs, and `src/app/dive/[id]/edit.tsx` reads them back —
 * and nothing under `src/app/` carries tests, by this repo's own convention. A param name
 * retyped at each end would be a seam with no coverage at all, so both directions are
 * written here and asserted against each other below.
 */

describe('opening the edit form', () => {
  it('names the route template and the dive, not a hand-built path', () => {
    // expo-router's typed routes check the template plus params against the routes that
    // actually exist on disk — and additionally require `id`. An interpolated
    // `/dive/<id>/edit` string is resolved at runtime and checked against nothing.
    expect(editDiveHref('d1')).toEqual({ pathname: '/dive/[id]/edit', params: { id: 'd1' } });
  });

  it('asks for no particular status, so plain editing leaves a dive as it is', () => {
    // The discriminating half of the pair below: a plain edit that carried `openAs` would
    // flip the form's §2.4 control for a diver who only came to fix a note, which is the
    // whole class of defect this milestone removed.
    expect(openAsStatus(editDiveHref('d1').params)).toBeUndefined();
  });
});

describe('completing a planned dive', () => {
  it('opens the same dive on the same route, with the control asked onto Logged', () => {
    const href = completeDiveHref('p1');
    expect(href.pathname).toBe('/dive/[id]/edit');
    expect(href.params.id).toBe('p1');
    expect(href.params.openAs).toBe('logged');
  });

  it('differs from a plain edit in exactly one thing', () => {
    // Stated as a comparison rather than as two independent shapes: if the two links ever
    // stop differing, one of the two labels ("Edit" / "Complete dive") is lying, and which
    // one depends on which way they converged.
    const plain = editDiveHref('p1');
    const complete = completeDiveHref('p1');
    expect(complete.pathname).toBe(plain.pathname);
    expect(complete.params.id).toBe(plain.params.id);
    expect(complete.params.openAs).not.toBe(plain.params.openAs);
  });

  it('round-trips through the reader the route actually uses', () => {
    // The two ends meeting: what `completeDiveHref` writes is what `openAsStatus` reads.
    // Asserting each against a hand-written `'openAs'` string separately would leave both
    // free to agree on the wrong name — the seam this module exists to close.
    expect(openAsStatus(completeDiveHref('p1').params)).toBe('logged');
  });
});

describe('reading a status out of the route', () => {
  it('reads both real states', () => {
    expect(openAsStatus({ openAs: 'logged' })).toBe('logged');
    // 'planned' is not a link this app builds today — only `completeDiveHref` sets the
    // param at all — but the reader accepts it, so a "plan this again" entry point can be
    // added without this rule needing to be widened at the same time.
    expect(openAsStatus({ openAs: 'planned' })).toBe('planned');
  });

  it('takes the first of a repeated param rather than passing the array on', () => {
    // `useLocalSearchParams` hands back `string[]` for `?openAs=logged&openAs=planned`, and
    // an array reaching the form would be neither state — a control opened on nothing.
    expect(openAsStatus({ openAs: ['logged', 'planned'] })).toBe('logged');
  });

  it('treats anything that is not a real status as no instruction at all', () => {
    // A hand-typed deep link, a stale link from a future version, an empty param. None of
    // them may open the control on a state that is not a state; the dive's own status is
    // the right answer, which is what `undefined` means to the form.
    for (const raw of ['maybe', '', 'LOGGED', 'true'] as const) {
      expect(openAsStatus({ openAs: raw })).toBeUndefined();
    }
    expect(openAsStatus({ openAs: [] })).toBeUndefined();
    expect(openAsStatus({})).toBeUndefined();
    // The `id` param is not mistaken for one either — the reader looks at one key.
    expect(openAsStatus({ id: 'logged' })).toBeUndefined();
  });
});

import { isResolved } from './liveQuery';

/**
 * Four cases, and each one is a line of `isResolved` that can be deleted.
 *
 * The pair that matters most is the second and third: they are the two facts a caller cannot
 * get from `data`, because `useLiveQuery` seeds `data` with `[]` on the first render (see
 * `isResolved`'s own docblock). "No rows yet" and "no rows, and that is the answer" look
 * identical from the outside, and telling them apart is the entire reason this predicate is
 * not `data.length === 0`.
 */
describe('isResolved', () => {
  it('is false before the query has produced anything', () => {
    expect(isResolved({ error: undefined, updatedAt: undefined })).toBe(false);
  });

  it('is true once the query has answered, even with no rows to show for it', () => {
    // The case a `data`-based signal cannot see at all: an empty logbook that has genuinely
    // been read. Screens have to be able to say "log your first dive" for this one.
    expect(isResolved({ error: undefined, updatedAt: new Date('2026-08-16T00:00:00.000Z') })).toBe(true);
  });

  it('is true for a read that failed, because a failure is an answer', () => {
    // `useLiveQuery` never sets `updatedAt` on a rejection (`query.then(handleData)
    // .catch(setError)`), so a definition built on `updatedAt` alone would leave a failed
    // read unresolved for ever — and a screen that waits before consulting `error` would sit
    // on a frame that says nothing at all rather than reporting the failure.
    expect(isResolved({ error: new Error('disk full'), updatedAt: undefined })).toBe(true);
  });

  it('is true when a later read fails after an earlier one succeeded', () => {
    // Both fields set at once is a state the real hook reaches: `error` is never cleared, so
    // a query that answered and then failed carries both. Resolved either way — there is an
    // answer on screen and an error to report about it, and neither cancels the other.
    expect(isResolved({ error: new Error('disk full'), updatedAt: new Date() })).toBe(true);
  });
});

import { renderHook } from '@testing-library/react-native';

import { isResolved, useCurrentError, type LiveQueryResult } from './liveQuery';

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

/** Two distinct stand-ins for "the moment rows landed". Distinct OBJECTS is the point, not the
 * two minutes between them: `handleData` builds a fresh `Date` per delivery, and that is what
 * `useCurrentError` compares (see its last line). */
const ANSWERED = new Date('2026-08-16T09:15:00.000Z');
const ANSWERED_AGAIN = new Date('2026-08-16T09:17:00.000Z');

/**
 * A sequence of `useLiveQuery` results, one per render.
 *
 * There is no other way to ask this question: "has this read succeeded SINCE it failed" is about
 * what changed BETWEEN two renders, so a predicate over a single object literal — which is how
 * `isResolved` above is tested — cannot express any of the cases below. Each `next` is the same
 * hook seeing the next result the way a component would.
 */
async function renderErrorOver(first: LiveQueryResult) {
  const view = await renderHook((result: LiveQueryResult) => useCurrentError(result), {
    initialProps: first,
  });
  return {
    current: () => view.result.current,
    next: async (result: LiveQueryResult) => {
      await view.rerender(result);
      return view.result.current;
    },
  };
}

/**
 * The five cases, and each one is a line of `useCurrentError` that can be deleted or inverted.
 *
 * The pair that matters most is the second and third. They hand the hook the SAME two fields —
 * an error and an `updatedAt`, both set — and the honest answer is opposite in each, because
 * only the order they arrived in tells a superseded failure from a live one. Any rule that reads
 * the result object alone gets exactly one of them right.
 */
describe('useCurrentError', () => {
  it('reports a failure on the render it first appears on', async () => {
    // The whole point of a banner is that it is up while the failure is the news. Trading a
    // notice that cannot clear for one that arrives a render late would be the same defect
    // wearing the opposite sign.
    const failed = new Error('disk full');
    const read = await renderErrorOver({ error: failed, updatedAt: undefined });
    expect(read.current()).toBe(failed);
  });

  it('stops reporting it once a later read succeeds', async () => {
    // `useLiveQuery` never clears `error`, so this is what a RECOVERED read looks like from the
    // outside: the same error object still sitting in its state, with rows and an `updatedAt`
    // that arrived after it. The defect this function exists for — DivesScreen's settings
    // banner standing over dive numbers that are correct again.
    const failed = new Error('disk full');
    const read = await renderErrorOver({ error: failed, updatedAt: undefined });
    expect(await read.next({ error: failed, updatedAt: ANSWERED })).toBeUndefined();
  });

  it('reports a failure that arrives after the read had already answered, and goes on reporting it', async () => {
    // The mirror image, and the one a naive fix gets wrong: `error && updatedAt` is ALSO this
    // state, where a read answered at 09:15 and then failed. Nothing has succeeded since, so
    // the failure is current and has to be reported at once.
    const failed = new Error('disk full');
    const read = await renderErrorOver({ error: undefined, updatedAt: ANSWERED });
    expect(read.current()).toBeUndefined();
    expect(await read.next({ error: failed, updatedAt: ANSWERED })).toBe(failed);

    // **The third render is the assertion, not a flourish.** The two above are answered by the
    // branch that first sees a failure, which never consults what was recorded — so with only
    // them, recording "this read had never answered" instead of the answer it actually had
    // passes both, and then hides a live failure from the next render onwards. Which is what a
    // mutation of that one line did while this test was two lines shorter.
    expect(await read.next({ error: failed, updatedAt: ANSWERED })).toBe(failed);
  });

  it('keeps reporting it across renders that bring no new answer', async () => {
    // A re-render is not evidence of anything. Only `updatedAt` moving is.
    const failed = new Error('disk full');
    const read = await renderErrorOver({ error: failed, updatedAt: undefined });
    expect(await read.next({ error: failed, updatedAt: undefined })).toBe(failed);
    expect(await read.next({ error: failed, updatedAt: undefined })).toBe(failed);
  });

  it('reports a fresh failure that lands after a recovery', async () => {
    // Recovering must not be permanent either: the second failure is a new `Error`, which is
    // what the real hook delivers, and it is measured against the success that preceded IT.
    const first = new Error('disk full');
    const second = new Error('database is locked');
    const read = await renderErrorOver({ error: first, updatedAt: undefined });
    expect(await read.next({ error: first, updatedAt: ANSWERED })).toBeUndefined();
    expect(await read.next({ error: second, updatedAt: ANSWERED })).toBe(second);
    // ...and that one clears on its own later success, rather than the first recovery having
    // permanently decided the answer.
    expect(await read.next({ error: second, updatedAt: ANSWERED_AGAIN })).toBeUndefined();
  });

  it('says nothing about a read that has never failed', async () => {
    const read = await renderErrorOver({ error: undefined, updatedAt: undefined });
    expect(read.current()).toBeUndefined();
    expect(await read.next({ error: undefined, updatedAt: ANSWERED })).toBeUndefined();
  });
});

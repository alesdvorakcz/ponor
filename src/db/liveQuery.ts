/**
 * The shape of a `useLiveQuery` result this module reads.
 *
 * Structural and deliberately narrow — `data` is not in it, and that is the whole point (see
 * `isResolved`). Declared here rather than imported from drizzle so the predicate below can be
 * tested against a plain object literal, which is exactly what the two hooks hand it once
 * TypeScript has checked the real result against this shape.
 */
export interface LiveQueryResult {
  error: Error | undefined;
  updatedAt: Date | undefined;
}

/**
 * Whether a `useLiveQuery` has produced an answer yet — rows, or a failure.
 *
 * **One owner, because two hooks need the identical predicate.** `useDives` and
 * `useGearPresets` both have to tell "nothing to show" from "nothing read yet", and the two
 * of them stating that rule separately is §4.1's defining defect with a fresh coat of paint:
 * one of them gets "simplified" later, the two screens that share a diver's afternoon start
 * disagreeing about what silence means, and nothing fails.
 *
 * **It is not `data`, and that is the finding this function exists to record.** The obvious
 * definition — `data === undefined` until the query first runs — is simply false for this
 * app's reads. `useLiveQuery` seeds its own state with
 * `useState(is(query, SQLiteRelationalQuery) && query.mode === 'first' ? undefined : [])`
 * (drizzle-orm/expo-sqlite/query.js), and both of this app's live reads are plain
 * `db.select().from(...)` builders rather than relational queries — so `data` is an EMPTY
 * ARRAY from the very first render, before any statement has been executed. Every consumer was
 * therefore told "there are no dives" and "there are no presets" before either had been looked
 * up, could not tell that from the truth, and three screens said so out loud: "Dive not
 * found." over a dive that was there, "may have been deleted" over a preset that was not, and
 * a blank edit form over a real dive. The `?? []` both hooks carry never had anything to do
 * with it; `useLiveQuery`'s own initial state did.
 *
 * `updatedAt` is the field that actually carries the fact. It starts `undefined` and is set
 * only inside `handleData`, in the same breath as the rows themselves, so it is `undefined`
 * for exactly as long as no rows have arrived — and it is part of the hook's declared return
 * type, not an internal.
 *
 * **A failure is an answer.** `useLiveQuery` runs `query.then(handleData).catch(setError)`, so
 * a read that rejects never sets `updatedAt` at all. Defining resolution on `updatedAt` alone
 * would leave a failed read permanently unresolved — and a screen that waits before consulting
 * its own `error` would then sit for ever on a frame saying nothing, which is the one outcome
 * this codebase consistently rates worse than the failure itself (`client.web.ts`'s stand-in:
 * "a browser showing an empty logbook backed by nothing is a worse outcome than a browser
 * showing an error, because only one of the two is distinguishable from the truth"). So a
 * failure resolves, and the caller's own `error` branch is what says which answer arrived.
 * That also makes the two orderings equivalent at a call site — check `error` first or check
 * this first — instead of one of them silently hanging.
 */
export function isResolved(result: LiveQueryResult): boolean {
  return result.updatedAt !== undefined || result.error !== undefined;
}

import { useState } from 'react';

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

/**
 * What a failure looked like the first render it was seen on: the error itself, and what the
 * read had last answered at that moment (`undefined` for a read that had never answered).
 */
interface ObservedFailure {
  error: Error;
  at: Date | undefined;
}

/**
 * A live read's error — but only while it is still what that read last said.
 *
 * **`useLiveQuery` never clears `error`.** It runs `query.then(handleData).catch(setError)` on
 * mount and again on every `addDatabaseChangeListener` fire (drizzle-orm/expo-sqlite/query.js),
 * and nothing anywhere in it calls `setError(undefined)`. So one failed read sets that field for
 * the life of the component: every later run that SUCCEEDS sets `data` and `updatedAt` around it
 * and leaves the error standing. A caller reading `.error` straight off the result therefore
 * reports its failure for ever — over rows it now has, and over numbers that are now correct.
 *
 * That is `isResolved`'s own defect arriving from the other side. There a screen stated an
 * answer it did not have; here it states a failure that has been superseded. DivesScreen's
 * `dives_before` banner is the case that named it, and the reasoning that put that banner on
 * screen is what condemns it standing: a diver whose dive numbers silently reset has been shown
 * a plausible lie, and so has one told their numbers are wrong while they are right. A notice
 * that cannot clear will be wrong more often than right once it has fired.
 *
 * **The question is not "has this read succeeded", it is "has it succeeded SINCE this failure".**
 * `error !== undefined && updatedAt !== undefined` looks like the answer and is not: it is
 * equally the state of a read that answered at 09:15 and then failed, which is a live failure
 * that has to be reported at once. The two are told apart by remembering what `updatedAt` held
 * when the failure was first seen — `useLiveQuery` stamps a fresh `Date` in the same breath as
 * every set of rows it delivers, so that field moving is the only evidence available that a run
 * finished successfully afterwards. Nothing else in the result changes shape between the two.
 *
 * Errors are compared by identity, which is the same comparison `useLiveQuery` itself is subject
 * to: `setError` with the object already in state is a no-op React does not re-render for, so a
 * repeat failure that is not a new object produces no render for anything downstream to react to
 * anyway. A genuinely new failure is a new `Error`, is re-marked here, and is reported again.
 *
 * **State adjusted during render, not a ref** — React's own documented "Adjusting some state when
 * a prop changes" (https://react.dev/learn/you-might-not-need-an-effect), the same shape
 * `DiveFormScreen`'s `carried` gate uses. A ref is the obvious first answer and this repo's lint
 * rejects it outright (`react-hooks/refs`: refs may not be read or written during render), which
 * is the correct call and not merely a house rule — the value below is read to decide what this
 * render returns, so it is render state by definition, however little it changes.
 *
 * **What makes a render-phase update safe here is that the gate can actually close**, and this
 * codebase has the scar to prove that is not automatic: `DiveFormScreen` once gated one on object
 * identities that were rebuilt every render, so the gate never closed, and the screen threw "Too
 * many re-renders." rather than committing a single frame. Both values compared below live in
 * `useLiveQuery`'s own `useState` — an `Error` and a `Date` that are the same objects render after
 * render until the query genuinely re-runs — so the update fires once per new failure, the
 * comparison that follows it is false, and nothing further is scheduled.
 *
 * **A failure still resolves the read.** `isResolved` above deliberately reads the raw result,
 * and it cannot disagree with this function in a way that matters: an error hidden here is one
 * `updatedAt` has moved past, so the read is resolved on that field alone. No screen gated on
 * `resolved` can begin hanging because a failure stopped being current.
 */
export function useCurrentError(result: LiveQueryResult): Error | undefined {
  const [seen, setSeen] = useState<ObservedFailure | undefined>(undefined);

  // Re-marked during render whenever the failure in hand is not the one the mark was taken for:
  // its arrival, its replacement by a different failure, and its disappearance — which
  // `useLiveQuery` never actually produces, but this function is defined over its declared type
  // rather than over one dependency's current implementation, and a failure re-reported after a
  // genuine clearing has to be marked afresh rather than measured against a leftover. A read
  // that has never failed, which is nearly every read nearly all of the time, takes neither
  // branch and schedules nothing.
  if (seen?.error !== result.error) {
    setSeen(result.error === undefined ? undefined : { error: result.error, at: result.updatedAt });
  }

  // The whole answer, read from the mark alone. A failure is still the read's latest word only
  // while `updatedAt` has not moved since the mark was taken; once it has, a successful run has
  // landed on top of the failure and it is history, not a condition. With no failure at all both
  // arms are `undefined`, `result.error` being one of them.
  //
  // **Nothing here is written for the render a new failure arrives on, and that is deliberate.**
  // On that render `seen` is one behind, but React re-runs a component with the updated state
  // before committing anything when the update was scheduled during its own render — so that
  // intermediate answer is discarded and no screen is ever given it. A branch computing it
  // anyway would be unreachable code that mutation testing cannot kill, which this codebase has
  // twice found to be worse than nothing: it reads as a guard and defends nothing. What holds
  // the convergence honest instead is `liveQuery.test.ts`, which drives this through the real
  // renderer rather than reasoning about it.
  //
  // Identity, not `getTime()`: `handleData` builds a fresh `Date` for every delivery, so identity
  // sees two successful runs inside one millisecond where a timestamp comparison would see none.
  return result.updatedAt === seen?.at ? result.error : undefined;
}

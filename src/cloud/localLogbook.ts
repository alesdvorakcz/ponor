import type { SupabaseClient } from '@supabase/supabase-js';

import { adoptDiveCenters, adoptDiveSites, wipeDiveCenters, wipeDiveSites } from '../db/catalogue';
import { adoptCertifications, wipeCertifications } from '../db/certifications';
import { db } from '../db/client';
import { adoptDives, wipeDives } from '../db/dives';
import { adoptGearPresets, wipeGearPresets } from '../db/gearPresets';
import { forgetDivesBefore } from '../db/settings';
import { forgetLastPulledAt } from '../db/syncState';
import type { Db } from '../db/types';
import { countUnsyncedRows, pushPendingRows, tombstonePersonalRows } from './sync';
import { cloud } from './supabase';
import { syncEngine } from './syncEngine';

/**
 * **What an account arriving and an account leaving do to the local database.**
 *
 * DESIGN.md §7.4 gives an account its effects on the device, and this module is the seam all of
 * them reach the local logbook through:
 *
 * - **Adoption.** "On first sign-in, every local row is marked dirty and pushed... Nothing on
 *   the client changes at sign-in but the dirty flags." `adopt` is that flagging, and it
 *   resolves with the number of *dives* it flagged, because that is the number §7.4 makes the
 *   app say out loud afterwards ("4 dives from this phone were added to your logbook").
 * - **The wipe.** "Signing out wipes the local logbook... it is the one destructive action in
 *   v1." `wipe` is that erase, and it refuses to run on a device that still owes the server.
 * - **Start over** (M3j). §7.4's second destructive act: "wipes this device **and the account's
 *   data**, and the account survives". `startOver` is the tombstone-first sequence that makes
 *   that reach a device which was not there — see its own docblock, where the ordering is the
 *   whole of the design.
 * - **The unconditional erase.** `erase` is the wipe with the gate taken off, and it exists for
 *   exactly one caller: `deleteAccount` (cloud/auth.ts), where the rows the gate protects have
 *   just been deleted server-side. Its docblock argues that the gate would be not merely
 *   useless there but wrong.
 *
 * ## What this file is and is not allowed to do
 *
 * Both operations are writes to tables `src/db/` owns (§4.1: "`db/dives.ts` — every write to a
 * dive", "`db/gearPresets.ts` — every write to a preset", and `db/dirty.ts` owns the flag
 * itself). So nothing here writes a row. Every line below is a call to the repository that
 * owns the table it names, in an order this module decides — which is the whole of what it
 * owns: **what an account arriving and an account leaving mean, as a sequence.**
 *
 * ## The ordering constraint M2e wrote, and the runtime rule that replaces it
 *
 * M2e left both operations unwired and said why: *"the wipe cannot land before §7.1's push
 * exists… the confirmation this app shows before signing out says the logbook stays in your
 * account and signing back in brings it back, which is true of a row that has been pushed and
 * false of one that has not."* That was a build-order constraint standing in for a rule, and
 * M2g replaces it with the rule itself:
 *
 * > **Sign-out pushes first, and if anything is still dirty afterwards it refuses, says so,
 * > and wipes nothing.**
 *
 * That is strictly stronger than the ordering it replaces, because push existing was never
 * what made the dialog true. It also covers the diver who has been offline for a month, the
 * push that failed halfway, the build with no backend configured, and the device holding a
 * site created on the boat — none of which the ordering constraint could see.
 *
 * **And it is a check rather than a promise.** The refusal is decided by `countUnsyncedRows`
 * (`cloud/sync.ts`), which counts the flags **in SQLite**, after the push, whatever the push
 * said about itself. A rule enforced by a boolean the pusher returned would be a rule that
 * fails exactly when the pusher is wrong — which is the case it exists for. Nothing here is
 * ever told "it worked"; it looks.
 *
 * ## What "the local logbook" means
 *
 * (Owner's call, M2e; §7.4 is its home and this is a summary rather than a second copy of the
 * rule.) *Sign-out restores the device to its guest state: everything that came from an
 * account goes, everything the diver set on this device stays.* So `dives`, `gear_presets` and
 * `certifications` go — a card is one person's and it syncs, and a signed-out phone still
 * holding somebody's certification numbers is precisely what that sentence is about;
 * `sync_state` goes, because a stale watermark makes the next account's first pull skip
 * every row older than it, silently and unrepairably (§7.2 records that failure for
 * watermarks); `dive_sites` and `dive_centers` go, because they arrive by pull and a guest
 * never had them — which also closes the edge where a site created offline and never pushed
 * would sit in the *next* account's dirty set and go up as their creation. `settings`
 * **stays**, except `dives_before`: units, locale and the form-group memory are things this
 * diver set on this device, and `dives_before` is a fact about the person that §6 syncs to the
 * profile, so leaving it behind would hand the next account a pre-Ponor number that silently
 * shifts every dive number in §2.5.
 *
 * ## The shape, and why it is a union rather than a nullable pair
 *
 * The same reason `Cloud` (supabase.ts) is one: a nullable function is a null-pointer with a
 * deadline, and the forgetting compiles. `adopt` and `wipe` do not exist as properties until
 * `wired` has been narrowed to `true`, so "is there a local-logbook seam yet" is a question
 * the compiler makes every caller ask. The union stays now that both arms are real: the point
 * of it was never the unfinished state, it was that a caller must handle the seam's absence,
 * and `auth.ts`'s two callers still answer that question in opposite ways.
 *
 * ## What the two callers do, and why they differ
 *
 * `authenticate` and `endSession` (auth.ts) treat the same seam in opposite ways, and that
 * asymmetry is the point:
 *
 * - **Sign-in proceeds.** §1 says an auth failure never blocks logging and §7.4 makes the
 *   adoption *a statement, not a gate* — "a prompt at sign-in is a wall in front of the one
 *   flow §1 promises is optional". So an unwired (or failing) adoption costs the sentence and
 *   nothing else; the diver is signed in.
 * - **Sign-out refuses.** The wipe is the whole content of §7.4's sign-out. Ending the session
 *   without it would leave a signed-out device holding one person's dives, which §7.4 names as
 *   "the only way a second account could ever see them" — and the diver would have just read a
 *   dialog saying the opposite. A control that refuses out loud is recoverable; a dialog that
 *   lies is not.
 */

/**
 * How a wipe ended: it happened, or it refused and said how many rows it refused over.
 *
 * **A value rather than a thrown error**, deliberately. Refusing is not a malfunction — it is
 * the correct answer for a device that has been at sea, and the diver is owed a different
 * sentence for it than for "the database would not open". A rejection would have made the two
 * one case at the point where `auth.ts` has to choose between them, and telling them apart
 * again would mean an `instanceof` across a module boundary — the one comparison that quietly
 * stops working when a bundler gives a module two instances.
 *
 * `pending` is carried for the caller that wants it and is not read by anything today: §0.6's
 * error text says what to do, not how much there is of it, and "3 changes" invites a diver to
 * hunt for three things the app cannot point at.
 */
export type WipeOutcome = { readonly done: true } | { readonly done: false; readonly pending: number };

export type LocalLogbook =
  | {
      readonly wired: true;
      /**
       * Flags every local row for §7.1's push and resolves with **how many dives** were
       * flagged — deliberately a subset of what it flagged, not a total.
       *
       * Presets, sites and centres are adopted too and are not counted. §7.4's sentence is
       * "4 dives from this phone were added to your logbook", and a diver counts dives: a
       * number that quietly included two cylinder presets would make that sentence false
       * about the only thing it names. Do not "fix" this into a row total — the sentence is
       * what the number is for, and there is nowhere on screen that says anything else.
       *
       * Resolving with `0` is an ordinary answer, not a failure: a diver who signs in on a
       * fresh phone has nothing to adopt, and the app then says nothing rather than saying
       * "0 dives from this phone were added".
       */
      readonly adopt: () => Promise<number>;
      /**
       * Erases this device's logbook, **or refuses because the server has not seen all of
       * it** — see this module's docblock for the rule and why it is a check rather than a
       * promise. Rejects only when the erase itself could not run, in which case the session
       * is deliberately not ended either.
       */
      readonly wipe: () => Promise<WipeOutcome>;
      /**
       * §7.4's **start over**: tombstones this diver's own rows, sends the tombstones, checks
       * that they arrived, and only then erases the device. Refuses in exactly the same shape
       * the wipe does, and for a reason of its own — see the implementation.
       */
      readonly startOver: () => Promise<WipeOutcome>;
      /**
       * The erase with no gate on it, for the one caller whose rows are already gone from the
       * server — `deleteAccount` (cloud/auth.ts). Rejects if the erase could not run.
       */
      readonly erase: () => Promise<void>;
    }
  | { readonly wired: false };

/** What the seam needs from the rest of the app: a database, and a backend if there is one. */
export interface LocalLogbookDeps {
  readonly db: Db;
  /**
   * The backend, asked for at the moment it is needed, or `null` when this build has none
   * (supabase.ts). Sign-out is then unreachable through the app, and the wipe still runs its
   * check rather than assuming so.
   *
   * **A function rather than the client itself**, so that building this object reads nothing.
   * `cloud` is a module constant and the value could not change — but a module-scope *read* of
   * another module's constant ties this one's evaluation to that one's, which is the coupling
   * this file's last paragraph promises there isn't. It showed up immediately: a screen test
   * that stubs `cloud` behind a getter had `localLogbook` evaluate first and read `undefined`.
   */
  readonly client: () => SupabaseClient | null;
  /**
   * Runs the wipe with §7.5's engine held (`cloud/syncEngine.ts`'s `runExclusive`), so that no
   * sync cycle can run inside it.
   *
   * **This became load-bearing the moment anything triggered a cycle at all** (M2h). Until
   * then `wipe` was the only caller of `pushPendingRows` in the running app and there was
   * nothing to overlap it. Now four triggers can fire while a diver is signing out, and the
   * one that lands between the erase and `auth.signOut()` **pulls the whole logbook back onto
   * a device that is being signed out** — §7.4's "the only way a second account could ever see
   * them", produced by the feature that was supposed to keep the logbook safe.
   *
   * Injected rather than imported so the rule is visible in the type: a `wipe` built without
   * it does not compile, which is what stops the next caller of `createLocalLogbook` quietly
   * getting an unprotected one.
   */
  readonly exclusive: <T>(work: () => Promise<T>) => Promise<T>;
}

/**
 * Builds the seam over one database and one backend.
 *
 * Exported so the rules below can be executed against a real (in-memory) database and a fake
 * server, which is the only way any of this is checked at all: nobody here has credentials for
 * the owner's project and **no round trip has ever been performed from this repository**.
 */
export function createLocalLogbook(deps: LocalLogbookDeps): LocalLogbook {
  /**
   * **The erase itself: every table §7.4 names, in one place, with no decision in it.**
   *
   * Extracted in M3j because three acts now end with it — sign-out, start over and account
   * deletion — and it is the last step of all three. What differs between them is entirely
   * *what has to be true before it runs*, and that is where each of the three keeps its own
   * argument; a second copy of this list is a table that one act erases and another leaves on
   * a phone, which is §4.1's defining defect on the one operation that destroys a logbook.
   *
   * §7.4's own account of what "the local logbook" is: "everything that came from an account
   * goes, everything the diver set on this device stays" — `settings` survives except
   * `dives_before`, and the module docblock above carries the reasoning for each table.
   */
  const eraseEverything = async (): Promise<void> => {
    await wipeDives(deps.db);
    await wipeGearPresets(deps.db);
    await wipeCertifications(deps.db);
    await wipeDiveSites(deps.db);
    await wipeDiveCenters(deps.db);
    await forgetLastPulledAt(deps.db);
    await forgetDivesBefore(deps.db);
  };

  /**
   * **Push, then look, then erase** — the sequence §7.4 gates the wipe with, shared by
   * sign-out and by start over because it is one rule and the difference between them happens
   * *before* it.
   *
   * The push is attempted and its failure is *ignored on purpose* — not swallowed, ignored,
   * and the difference is that nothing is decided by it. What decides is the count that
   * follows, read from the flags themselves: a push that threw leaves them set and the erase
   * refuses; a push that was never possible (no backend, no signal) leaves them set and the
   * erase refuses; a device with nothing pending answers zero however the push went, and there
   * is nothing to lose. That is why a failed push is not an error here — treating it as one
   * would refuse an erase that is provably safe.
   *
   * **Nothing is deleted before the count is taken**, which is the ordering that makes the
   * rule mean anything: the check is only a check while there is still something to refuse.
   */
  const pushAndEraseIfNothingIsOwed = async (): Promise<WipeOutcome> => {
    const client = deps.client();
    if (client !== null) {
      try {
        await pushPendingRows(deps.db, client);
      } catch {
        // Deliberately not reported: the count below is what decides, and it is unaffected
        // by why the push did not happen.
      }
    }

    const pending = await countUnsyncedRows(deps.db);
    if (pending > 0) return { done: false, pending };

    await eraseEverything();
    return { done: true };
  };

  return {
    wired: true,

    /**
     * §7.4's adoption, table by table.
     *
     * **Dives first, and the order is the whole of the error handling here.** There is no
     * transaction: every driver this app runs on is synchronous under an async surface, so a
     * `db.transaction` taking an async callback would commit before the callback's awaits had
     * run — worse than none. What is left is ordering, and the ordering is chosen so that the
     * rows a failure could strand are the ones that matter least: dives are flagged before
     * anything else can throw, and a preset or a site that misses adoption is a preset or a
     * site, not a logbook. `auth.ts` turns any rejection here into `0`, which is the app
     * saying nothing (§7.4: the adoption is a statement, not a gate).
     */
    adopt: async () => {
      const dives = await adoptDives(deps.db);
      await adoptGearPresets(deps.db);
      await adoptCertifications(deps.db);
      await adoptDiveSites(deps.db);
      await adoptDiveCenters(deps.db);
      return dives;
    },

    /**
     * §7.4's sign-out erase, gated on the rule this module's docblock states —
     * `pushAndEraseIfNothingIsOwed` above is that rule and carries its reasoning.
     */
    wipe: () =>
      // Held for the whole of it — push, count and erase — rather than around the erase alone.
      // A cycle overlapping the *push* is the double-push `syncEngine.ts` exists to prevent,
      // and one overlapping the *count* would have the gate read flags a concurrent push was
      // in the middle of clearing. See `LocalLogbookDeps.exclusive`.
      deps.exclusive(pushAndEraseIfNothingIsOwed),

    /**
     * **§7.4's start over, and the order of these four steps is the whole design.**
     *
     * > "**Start over must go through tombstones, not a server-side purge**… A hard delete on
     * > the server leaves a second device holding rows it believes are unsynced — and its next
     * > push **puts the whole logbook back**. A tombstone is the only form of deletion §7 can
     * > carry to a device that was not there when it happened."
     *
     * So: **tombstone, push, confirm nothing is still owed, erase.**
     *
     * **The erase cannot come first, and that is not a preference.** It is a hard delete
     * (`db/wipe.ts`), so running it before the tombstones have gone up destroys the very rows
     * that carry the deletion — leaving the account holding a full logbook that the next pull
     * hands straight back to this phone, and to every other one. The diver would have watched
     * their logbook be deleted and then return.
     *
     * **The gate is `wipe`'s own, unchanged, and it means something different here.** For
     * sign-out it asks *has the account received everything, because the dialog promised it
     * comes back*. Here it asks *has the account received the deletions*, which is the same
     * question about the same flags — the tombstones are ordinary dirty rows, and
     * `countUnsyncedRows` counts them for free. That is why this is one shared step and not a
     * second check written to look like the first.
     *
     * **What a refusal leaves behind is deliberate.** The tombstones stay: written, flagged,
     * and invisible to every read (`liveRows`, §4.1). That is not a half-finished erase, it is
     * the deletion recorded durably and waiting for a signal — §7.2's "a tombstone is applied,
     * not deleted… deleting it would throw away the fact of the deletion". A diver who starts
     * over on a boat gets exactly what they asked for on this device and the account catches up
     * on the next cycle; undoing the tombstones instead would be the app second-guessing an act
     * it had already asked them to confirm. What is deferred is the *hard* delete, which is the
     * only step that could lose the deletion.
     *
     * **Community rows are not tombstoned** (§7.4, §5) — `tombstonePersonalRows` (cloud/sync.ts)
     * owns that exclusion and is required to state it per table. They are still *pushed* by the
     * step below and still counted by the gate, which is right: a site created on the boat and
     * never sent is a row the erase would destroy, exactly as it is for sign-out.
     *
     * **It does not touch the session**, because §7.4's table says the account survives. The
     * device is left signed in and empty, which is what a second device that had never logged
     * anything looks like — and the next pull refills its catalogue.
     *
     * ── Two consequences, stated rather than left to be discovered ────────────────────────
     *
     * **The tombstones come back on the next pull, and that is correct rather than a leak.**
     * The erase clears the watermark, so the next cycle asks for everything and the server
     * returns the rows this act has just deleted — as tombstones, clean, hidden by `liveRows`
     * from every read, and never pushed again. It is exactly what a second device that was not
     * here receives (§7.2: "a tombstone is applied, not deleted"), so the device that *did* the
     * start over ends up in the same state as the ones that only heard about it. The only cost
     * is rows.
     *
     * **`dives_before` goes and the account's `profiles` row does not.** The erase takes the
     * local count with everything else, which is right for an act that empties a logbook — §2.5
     * numbers dives from it. The server's copy is untouched, and nothing in §7 pushes or pulls
     * `profiles` at all (`SYNCED_TABLES`, cloud/sync.ts), so there is nothing here that could
     * have gone stale against it. If a profile ever joins the protocol, this act joins the list
     * of things that has to have an opinion about it.
     */
    startOver: () =>
      // The same lock, for the same reasons, and one more: a cycle landing between the
      // tombstones and the push would push them itself and clear their flags against a clock
      // this call is about to compare — the gate would then read zero for work it did not
      // watch happen.
      deps.exclusive(async () => {
        await tombstonePersonalRows(deps.db);
        return pushAndEraseIfNothingIsOwed();
      }),

    /**
     * **The erase with the gate taken off, for the one act where the gate would be wrong.**
     *
     * `deleteAccount` (cloud/auth.ts) calls this after `delete_account` has returned. Every
     * argument the gate rests on has been inverted by that call:
     *
     * · **There is nothing to push to.** The rows the push would send belong to a `user_id`
     *   that no longer exists, and the JWT in hand outlives the account only until it expires.
     *   The push would fail; the count would then be non-zero; the erase would refuse — and a
     *   deleted account would leave a full logbook sitting on the phone, which is the one
     *   outcome §7.4 calls "the only way a second account could ever see them".
     * · **The promise the gate protects is not being made.** Sign-out's dialog says the logbook
     *   comes back on the next sign-in, and the gate is what makes that true. Deletion's dialog
     *   says the opposite, out loud: there is no next sign-in.
     * · **Pushing first would be worse than useless.** It would upload a diver's whole logbook
     *   to a server that has already destroyed it, on the one screen where a delay stands in
     *   front of an act with no way back.
     *
     * It is not a shortcut around the rule; it is the rule not applying. Kept as its own name
     * rather than as a flag on `wipe`, so a caller cannot reach the ungated erase by passing an
     * argument and no caller can acquire it by accident.
     */
    erase: () => deps.exclusive(eraseEverything),
  };
}

/**
 * The app's one local-logbook seam.
 *
 * A module-scope constant for `cloud`'s own reason (supabase.ts, "Why a module-scope
 * constant"): there is nothing to memoise wrongly and no second instance reachable. It reads
 * `cloud` and `db`, both of which are themselves module constants, and does nothing else —
 * building this object opens nothing, reads no row and starts nothing, so the sign-in surface
 * can go on importing it unconditionally while §1's "the app is fully usable without an
 * account" stays true.
 */
export const localLogbook: LocalLogbook = createLocalLogbook({
  db,
  client: () => (cloud.configured ? cloud.client : null),
  // Read inside the call for `client`'s reason above: a module-scope read of another module's
  // constant would tie this file's evaluation to that one's.
  exclusive: (work) => syncEngine.runExclusive(work),
});

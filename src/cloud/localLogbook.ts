/**
 * **The two things signing in and signing out have to do to the local database — and the
 * fact that neither is wired up yet.**
 *
 * DESIGN.md §7.4 gives an account exactly two effects on the device, and this module is the
 * seam both reach the local logbook through:
 *
 * - **Adoption.** "On first sign-in, every local row is marked dirty and pushed... Nothing on
 *   the client changes at sign-in but the dirty flags." `adopt` is that flagging, and it
 *   resolves with the number of *dives* it flagged, because that is the number §7.4 makes the
 *   app say out loud afterwards ("4 dives from this phone were added to your logbook").
 * - **The wipe.** "Signing out wipes the local logbook... it is the one destructive action in
 *   v1." `wipe` is that erase.
 *
 * ## Why this file holds a `false` and not an implementation
 *
 * Both operations are writes to tables `src/db/` owns (§4.1: "`db/dives.ts` — every write to a
 * dive", "`db/gearPresets.ts` — every write to a preset", and `db/dirty.ts` owns the flag
 * itself). M2e does not own that tree, so implementing either here would be the second writer
 * §4.1 exists to name. The port is declared, the callers are built and tested against it, and
 * the erase itself is one edit away.
 *
 * **The wipe cannot land before §7.1's push exists** (owner's call, M2e — the ordering
 * constraint, not a preference). The confirmation this app shows before signing out says the
 * logbook "stays in your account, and signing back in brings it back", which is true of a row
 * that has been pushed and false of one that has not. A wipe wired before the push is a
 * diver's logbook destroyed, permanently, by a control whose own dialog promised otherwise.
 *
 * **What "the local logbook" means was decided rather than left open** (owner's call, M2e;
 * §7.4 is its home, and this is a summary rather than a second copy of the rule). The rule is
 * that *sign-out restores the device to its guest state: everything that came from an account
 * goes, everything the diver set on this device stays.* So `dives` and `gear_presets` go;
 * `sync_state` goes, because a stale watermark makes the next account's first pull skip every
 * row older than it, silently and unrepairably (§7.2 records that failure for watermarks);
 * `dive_sites` and `dive_centers` go, because they arrive by pull and a guest never had them —
 * which also closes the edge where a site created offline and never pushed would sit in the
 * *next* account's dirty set and go up as their creation. `settings` **stays**, except
 * `dives_before`: units, locale and the form-group memory are things this diver set on this
 * device, and `dives_before` is a fact about the person that §6 syncs to the profile, so
 * leaving it behind would hand the next account a pre-Ponor number that silently shifts every
 * dive number in §2.5.
 *
 * ## The shape, and why it is a union rather than a nullable pair
 *
 * The same reason `Cloud` (supabase.ts) is one: a nullable function is a null-pointer with a
 * deadline, and the forgetting compiles. `adopt` and `wipe` do not exist as properties until
 * `wired` has been narrowed to `true`, so "is there a local-logbook seam yet" is a question
 * the compiler makes every caller ask.
 *
 * ## What the two callers do while it is `false`, and why they differ
 *
 * `authenticate` and `endSession` (auth.ts) treat the same missing port in opposite ways, and
 * that asymmetry is the point:
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
       * Erases this device's logbook. Resolves when the device holds nothing of the account
       * that is leaving; rejects if it could not, in which case the session is deliberately
       * **not** ended — see this module's docblock.
       */
      readonly wipe: () => Promise<void>;
    }
  | { readonly wired: false };

/**
 * The app's one local-logbook seam.
 *
 * A module-scope constant for `cloud`'s own reason (supabase.ts, "Why a module-scope
 * constant"): there is nothing to memoise wrongly and no second instance reachable. It
 * evaluates to an object literal and does nothing else — importing this module opens no
 * database, reads no row and starts nothing, which is what lets the sign-in surface import it
 * unconditionally while §1's "the app is fully usable without an account" stays true.
 */
export const localLogbook: LocalLogbook = { wired: false };

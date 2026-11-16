import { cloud } from './supabase';
import { type AuthSessionState } from './useAuthSession';

/**
 * **Whether Ponor offers an account right now** (issue #24) — the one owner of that rule, asked
 * by the first-run screen and by Settings, which carry the same card (`AccountOfferCard`).
 *
 * **A pure function of the screen's own session read, never a hook with a read of its own**
 * (review of PR #52). Both screens already call `useAuthSession` — Dives for the pending line and
 * pull-to-refresh, Settings for its destructive acts — and each call is its own `getSession()` and
 * its own `onAuthStateChange` subscription. A second one here would be the second reader §4.1
 * exists to prevent: for a moment the two could disagree, and Settings would draw both the card
 * and the Account row, or neither. So the screen reads once and hands that answer in.
 *
 * Three halves, each there for a diver it would otherwise mislead:
 *
 * - **The build has a backend.** `useAuthSession` answers "nobody" at once on a build without
 *   one, so without this the offer would show on exactly the build where it leads to "there is
 *   nothing to sign in to".
 * - **The session read has answered.** A `null` session before then means "not looked yet", not
 *   "nobody" — M1f's rule that a screen with no answer must not state one. Offering a sign-in
 *   while the keychain is still being read would say it to a diver who may well be signed in.
 * - **Nobody is signed in.** The offer is for a guest and never for anyone else.
 *
 * §1 is why there is nothing more to it: the account is optional, so there is no dismissal to
 * remember and no count of how often it was shown — the offer simply stands for as long as these
 * three are true, and signing in is what takes it away.
 */
export function offersAccount({ session, resolved }: AuthSessionState): boolean {
  return cloud.configured && resolved && session === null;
}

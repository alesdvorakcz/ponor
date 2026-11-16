import { cloud } from './supabase';
import { useAuthSession } from './useAuthSession';

/**
 * **Whether Ponor offers an account right now** (issue #24) — the one owner of that answer, read
 * by the first-run screen and by Settings, which carry the same card (`AccountOfferCard`). Two
 * screens asking it separately would be the second reader §4.1 exists to prevent, and the two
 * places would one day disagree about who is a guest.
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
export function useAccountOffer(): boolean {
  const { session, resolved } = useAuthSession();
  return cloud.configured && resolved && session === null;
}

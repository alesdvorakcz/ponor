import { cloud } from './supabase';

/**
 * **Who this device is signed in as, asked once** — the id, and nothing else about the session.
 *
 * It exists because §8's export has to know which community rows are *this diver's*
 * (`isOwnCatalogueRow`, domain/dataExport.ts), and `created_by` is a user id. That question is
 * asked at the moment the diver presses Export and never again.
 *
 * **A read, not a subscription, and that is the whole reason it is not `useAuthSession`.**
 * §3's Settings screen deliberately "says nothing about who is signed in", and its own docblock
 * gives the reason: that would be a second live read of the session on a screen opened at every
 * app launch, where `useAuthSession` is the one owner of that answer and the account screen is
 * where it is asked. A one-shot read inside a press handler adds no subscription, no listener
 * and no render, so the decision that screen recorded still holds.
 *
 * **Every failure is "nobody"**, which is `useAuthSession`'s and `syncEngine`'s stated rule for
 * the same read, in the same words: there is no difference a caller can act on between no
 * session and no readable session. Here the consequence is bounded and worth naming — a device
 * that cannot answer exports its own unpushed sites and centres (the flag tier of
 * `isOwnCatalogueRow`) and none of the ones the server has already echoed back. That is an
 * export missing rows, which the same paragraph calls the outcome to be most afraid of; it is
 * accepted here only because the alternative is refusing the diver a copy of their dives over a
 * keychain read, and because the same failure would already have stopped them signing in.
 */
export async function currentUserId(): Promise<string | null> {
  if (!cloud.configured) return null;
  try {
    const { data } = await cloud.client.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

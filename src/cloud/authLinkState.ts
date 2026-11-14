import { useSyncExternalStore } from 'react';

/**
 * **What the last mail link did, for the account screen to say** (2026-11-14).
 *
 * A link from the confirmation or reset mail arrives at the root of the app (`AuthLinks.tsx`),
 * not at a screen, and the screen that has to speak about it is mounted afterwards — or was
 * already showing a sign-in form. So the outcome is held here, outside any component, and read
 * with `useAuthLinkState`.
 *
 * - `working` — a link has arrived and its code is being exchanged. Said at once, so the diver
 *   does not land on a sign-in form and start typing into it.
 * - `signedIn` — a confirmation link signed the diver in; `adopted` is §7.4's count.
 * - `recovery` — a reset link signed the diver in, and what they came for is a new password.
 * - `passwordChanged` — that new password was saved.
 * - `failed` — the link could not be used; `message` is the app's own sentence.
 *
 * Module state rather than a context because the writer is a root effect and the reader is a
 * screen, and nothing between them has any business carrying it. It lives for the app's run and
 * no longer: a link's outcome is news, not a setting.
 */
export type AuthLinkState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'signedIn'; readonly adopted: number }
  | { readonly kind: 'recovery'; readonly adopted: number }
  | { readonly kind: 'passwordChanged' }
  | { readonly kind: 'failed'; readonly message: string };

let current: AuthLinkState = { kind: 'idle' };
const listeners = new Set<() => void>();

export function authLinkState(): AuthLinkState {
  return current;
}

export function setAuthLinkState(next: AuthLinkState): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAuthLinkState(): AuthLinkState {
  return useSyncExternalStore(subscribe, authLinkState, authLinkState);
}

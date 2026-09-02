import { type Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { cloud } from './supabase';

/**
 * **Whether anyone is signed in — the one live read of that, for the whole app.**
 *
 * Two fields, and the second is the same distinction `db/liveQuery.ts` draws for a database
 * read (§4.1): `session` alone cannot tell *"nobody is signed in"* from *"the keychain has not
 * answered yet"*, and the account screen renders a different thing for each. A screen that
 * drew the sign-in form while the session was still being restored would flash a form at a
 * diver who is already signed in, on every open, for as long as the keychain takes.
 */
export interface AuthSessionState {
  /** The signed-in session, or `null` for nobody. Never a partially-restored one: Supabase
   * hands over a whole session or nothing. */
  readonly session: Session | null;
  /** Whether that answer has been given yet. Immediately `true` when this build has no
   * backend, because then there is nothing to wait for and never will be. */
  readonly resolved: boolean;
}

/**
 * Subscribes to the auth session for as long as the calling screen is mounted.
 *
 * **It does nothing at all when there is no backend**, which is `supabase.ts`'s rule reaching
 * one module further out: "with the two variables absent, importing this module changes
 * nothing about the app... no keychain read on launch, no auth-refresh timer". `cloud` is a
 * discriminated union precisely so that rule cannot be skipped by accident, and the guard
 * below is inside the effect as well as in the initial state — one answers "what do we show",
 * the other answers "what do we start", and only the second is the one that costs anything.
 *
 * **Both a read and a subscription, because neither is enough alone.** `getSession()` answers
 * for the session that was already restored from the keychain when the client was built;
 * `onAuthStateChange` is what makes signing in and signing out change the screen, since
 * nothing in this app polls. The listener also fires `INITIAL_SESSION` shortly after
 * subscribing, so the two answers agree by construction and the later one always wins.
 *
 * **A rejected read is an answer, not a silence** — the same rule `isResolved`
 * (db/liveQuery.ts) states for a failed query. A keychain that cannot be read means nobody is
 * signed in as far as any screen can tell, and a state left unresolved on failure would leave
 * the account screen blank for ever with nothing to say why. It is not reported: there is no
 * diver-facing difference between "no session" and "no readable session", and §10's rule that
 * a sync failure is not shown covers the shape of this one.
 *
 * Not a module-level singleton subscription, unlike `cloud` itself. This is per-mount state,
 * and `onAuthStateChange` hands back an unsubscribe that has to be called — a module-scope
 * listener would have nothing to call it and would keep the last screen's `setState` alive
 * for the life of the process.
 */
export function useAuthSession(): AuthSessionState {
  const [state, setState] = useState<AuthSessionState>({
    session: null,
    resolved: !cloud.configured,
  });

  useEffect(() => {
    if (!cloud.configured) return;
    const client = cloud.client;

    // Guards the read below only. The listener needs none: its own unsubscribe runs in the
    // same cleanup, and a promise that lands after unmount has no such handle.
    let live = true;
    client.auth
      .getSession()
      .then(({ data }) => {
        if (live) setState({ session: data.session, resolved: true });
      })
      .catch(() => {
        if (live) setState({ session: null, resolved: true });
      });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setState({ session, resolved: true });
    });

    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
    // `cloud` is a module constant, not a reactive value: there is one client for the life of
    // the process (supabase.ts, "Why a module-scope constant"), so there is nothing here that
    // could change and cause this to re-subscribe.
  }, []);

  return state;
}

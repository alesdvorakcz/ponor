import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { completeAuthLink, isAuthLink } from './auth';
import { setAuthLinkState } from './authLinkState';
import { localLogbook } from './localLogbook';
import { cloud } from './supabase';

/**
 * **Where the links in the confirmation and reset mails land** (2026-11-14). Both mails send the
 * diver back to `ponor://` (`CONFIRMATION_REDIRECT`, cloud/auth.ts); before this, the app opened
 * and nothing happened — the address was confirmed on the server and the diver had to find the
 * account screen and type everything again, and a reset mail had no way back in at all.
 *
 * Mounted once at the root (app/_layout.tsx), beside `SyncTriggers`, and draws nothing. It reads
 * the link the app was opened with and every link that arrives while it runs, ignores all but
 * the mail links (`isAuthLink`), takes the diver to the account screen, and leaves the outcome
 * in `authLinkState` for that screen to say. Each link is used once: a code is good once, and a
 * platform may deliver the launch link twice.
 *
 * §1's rule holds — with no backend configured it listens for nothing.
 */
export function AuthLinks() {
  useEffect(() => {
    if (!cloud.configured) return undefined;
    const client = cloud.client;
    const used = new Set<string>();
    let live = true;

    const take = (url: string | null) => {
      if (url === null || !isAuthLink(url) || used.has(url)) return;
      used.add(url);
      setAuthLinkState({ kind: 'working' });
      router.navigate('/account');
      void completeAuthLink(client, url, localLogbook).then((outcome) => {
        if (!live) return;
        setAuthLinkState(outcome.kind === 'notAuthLink' ? { kind: 'idle' } : outcome);
      });
    };

    void Linking.getInitialURL().then(take);
    const subscription = Linking.addEventListener('url', ({ url }) => take(url));
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return null;
}

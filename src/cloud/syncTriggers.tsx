import { useEffect } from 'react';

import { onLocalWrite } from '../db/dirty';
import { useForegroundReturn } from '../hooks/useForegroundReturn';
import { syncEngine, type SyncEngine } from './syncEngine';
import { useAuthSession } from './useAuthSession';

/**
 * **DESIGN.md §7.5's triggers, subscribed for as long as the app is running.**
 *
 * §7.5 names four — "app foreground, connectivity restored, a debounced 10 s after any save,
 * and pull-to-refresh" — and this module holds the three that are subscriptions. The fourth is
 * a gesture and belongs to the screen it is made on (`DivesScreen.tsx`).
 *
 * Everything about *whether* a cycle may run, and about only one running at a time, is
 * `cloud/syncEngine.ts`'s. This file decides nothing; it only says when to ask. That split is
 * what lets the engine be tested without a renderer and this be tested without a database.
 *
 * ── The fifth trigger, which §7.5 does not name and the app cannot work without ────────────
 *
 * **A session arriving.** §7.5's list has no entry for it, and with only the four a diver who
 * signs in — or who simply opens the app already signed in — never pulls: `AppState` is
 * already `active` at launch, so there is no transition to `active` to fire on, and nothing
 * else here is about the account. That is not a corner case, it is the headline one: §7.4's
 * sign-out erases the device, and until M2h nothing in the app pulled at all, so signing out
 * and back in produced a correct, empty-looking logbook whose rows were safe on the server and
 * which nothing on the device would ever ask for.
 *
 * It is keyed on the **user id**, not on the session object. `onAuthStateChange` hands over a
 * fresh session on every token refresh, so an effect keyed on the object would fire a cycle
 * every time the access token rolled over — which is neither what §7.5 asks for nor free.
 *
 * ── What is not here ──────────────────────────────────────────────────────────────────────
 *
 * **No connectivity listener.** `@react-native-community/netinfo` is not installed and adding
 * it is a native module, a rebuild, and the owner's call. `syncEngine.ts`'s retry ladder is
 * what stands in for it; see `RETRY_FIRST_MS` there for what that does and does not buy.
 *
 * **No guard of its own on being signed out.** Every trigger below fires whether or not
 * anybody is signed in, and the engine refuses the cycle. One owner: a guard here as well
 * would be a second copy of a rule, differing from the first exactly in the case that matters
 * — a timer armed while signed in and firing ten seconds after the diver signed out.
 */
export function useSyncTriggers(engine: SyncEngine): void {
  const { session } = useAuthSession();
  const userId = session?.user.id ?? null;

  // §7.5: "a debounced 10 s after any save". `onLocalWrite` (db/dirty.ts) is the one place a
  // row becomes something the server has not seen, so this hears every save and — because a
  // cycle's own writes take no stamp — none of sync's own.
  useEffect(() => onLocalWrite(() => engine.requestAfterSave()), [engine]);

  // §7.5: "app foreground". **The transition, not the event** — iOS fires `change` for
  // `inactive` and `background` too, and returns through `inactive` on the way back, so a
  // handler that ran on every event would sync several times for one unlock.
  //
  // That rule was this file's own until §3's Settings location row wanted the same moment for
  // its own reason (M2m): the diver leaves for the system Settings app, changes the
  // permission, and comes back to a row that is stale unless something re-reads. So it moved
  // to `hooks/useForegroundReturn.ts` and this is now a caller of it — §4.1, and the same
  // subtlety would have been rewritten from memory on the second screen.
  useForegroundReturn(() => void engine.request());

  // The session, arriving or leaving. Signing out drops the save window and the retry ladder:
  // there is nothing left to send, the erase has already pushed what there was (§7.4), and a
  // timer left armed is the one thing that could pull an account's logbook back onto a device
  // that has just left it.
  useEffect(() => {
    if (userId === null) {
      engine.stop();
      return;
    }
    void engine.request();
  }, [engine, userId]);

  // Nothing outlives the app. In practice this runs once, at teardown — the component below is
  // mounted at the root for the process's life — but a timer that outlived its subscriber
  // would be a cycle nobody asked for, and the cleanup costs one line.
  useEffect(() => () => engine.stop(), [engine]);
}

/**
 * The hook as a component, so the app root can mount it as a child.
 *
 * **A child, and that is the point rather than a style.** `src/app/_layout.tsx` returns `null`
 * until `useMigrations()` reports success, and a hook called in that file would be called
 * before it — arming triggers against a database whose tables do not exist yet. As a child of
 * the tree that renders only after migrations have run, it cannot be. It also keeps this
 * testable: `src/app/` carries no tests by design (§4.1), and the one line it gains here is a
 * `<SyncTriggers />`.
 *
 * Renders nothing. There is no indicator in it — that is `usePendingChanges` on the screen
 * that shows it (§7.5, `DivesScreen.tsx`) — and nothing here draws.
 */
export function SyncTriggers(): null {
  useSyncTriggers(syncEngine);
  return null;
}

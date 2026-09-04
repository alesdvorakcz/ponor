import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * **"The app came back" — the transition to `active`, and never the bare event.**
 *
 * Two things in the app want that moment and want it for the same reason: something outside
 * the app may have changed while the diver was away. §7.5's sync trigger has wanted it since
 * M2h (`cloud/syncTriggers.tsx`), and §3's location row wants it because the *only* place its
 * answer can change is the system Settings app — the diver leaves, flips a switch, and comes
 * back to a row that is now wrong unless something re-reads (`screens/SettingsScreen.tsx`).
 *
 * **It is one rule and it is subtle, which is why it is here rather than written twice**
 * (§4.1, whose defining defect is exactly that). iOS fires `change` for `inactive` and
 * `background` too, and returns through `inactive` on the way back, so a handler that ran on
 * every event would fire three or four times for one unlock — and a handler that ran on every
 * `active` would fire for a notification shade pulled down and let go, with the app never
 * having left. `previous` is what tells a return from a re-announcement, and it is a plain
 * closure variable rather than a ref because the subscription owns it and nothing renders
 * from it.
 *
 * **`AppState` is already `active` at launch**, so there is no transition to fire on then.
 * That is a fact about this hook rather than a gap in it — a caller that also needs an answer
 * on arrival asks for one itself, as both of today's do.
 *
 * This was `useSyncTriggers`' own effect, moved here unchanged in its behaviour when the
 * second caller arrived (M2m). The one thing that is new is the latch below.
 */
export function useForegroundReturn(onReturn: () => void): void {
  /**
   * The callback the *last* render handed over, so the subscription can be made once and
   * still call something current.
   *
   * The alternative is `[onReturn]` in the dependency list, which re-subscribes whenever a
   * caller passes a fresh arrow — every keystroke on Settings, where the same screen holds a
   * text field. That would work (`AppState.currentState` is the truth, so a re-subscribe
   * re-seeds `previous` correctly), and it would make every caller responsible for memoising
   * a callback whose identity has nothing to do with what this hook promises. A subscription
   * that outlives a render is the contract worth having, and this is what pays for it.
   */
  const latest = useRef(onReturn);
  useEffect(() => {
    latest.current = onReturn;
  });

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasActive = previous === 'active';
      previous = next;
      if (next !== 'active' || wasActive) return;
      latest.current();
    });
    // Nothing outlives its subscriber: a listener left behind would go on calling into a tree
    // that no longer exists.
    return () => subscription.remove();
  }, []);
}

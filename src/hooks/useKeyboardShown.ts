import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEventName } from 'react-native';

/**
 * Which pair of keyboard events to listen for, given a platform (M3m).
 *
 * **Kept pure and separate from the hook below** — the same split `useWideLayout.ts` makes
 * between `isWide` and its hook, and for the same reason: this is the part that can be wrong,
 * and it can be wrong *silently*. `keyboardWillShow` is iOS-only. Written once for both
 * platforms it would simply never fire on Android — no error, no warning, just a hook stuck at
 * `false` and a bottom inset that never changes, which is indistinguishable from the code that
 * existed before this file. A pure function can be pinned against both names without a render.
 *
 * **iOS takes the `will` pair on purpose.** The keyboard's own animation is what a lifted
 * control travels alongside, so a screen that reacts on `did` re-pads a frame after
 * `KeyboardAvoidingView` has already moved, and the gap visibly snaps shut after the fact.
 * Android emits only `did`, so it has no such choice — and neither does the browser (§9's
 * testing target), where `react-native-web` emits the `did` pair alone. Everything that is not
 * iOS therefore gets the pair that is emitted everywhere, rather than a per-platform list this
 * app would have to keep in step with platforms it does not ship to.
 */
export function keyboardEventNames(platform: typeof Platform.OS): {
  show: KeyboardEventName;
  hide: KeyboardEventName;
} {
  return platform === 'ios'
    ? { show: 'keyboardWillShow', hide: 'keyboardWillHide' }
    : { show: 'keyboardDidShow', hide: 'keyboardDidHide' };
}

/**
 * **Whether a keyboard is currently covering the bottom of the screen** — read by the two
 * screens whose primary control the keyboard lifts, and by nothing else (M3m).
 *
 * It answers exactly one question and deliberately does not measure the keyboard: how far a
 * control moves is `KeyboardAvoidingView`'s answer, and a second opinion about it here is the
 * one-rule-in-two-places failure §4.1 names. All a caller wants to know is whether the home
 * indicator still needs clearing — see `liftedBottomInset` (theme/styles.ts), which owns what
 * to do with the answer.
 *
 * `false` until told otherwise, which is the state a screen mounts in and the safe one: a
 * control that guessed "up" on arrival would drop its home-indicator clearance on a screen
 * with no keyboard anywhere near it.
 */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Read inside the effect rather than at module scope so the names are resolved per mount
    // — `Platform.OS` is constant on a device, but a module-scope constant is also what makes
    // this untestable per platform without resetting the module registry.
    const { show, hide } = keyboardEventNames(Platform.OS);
    const shownSub = Keyboard.addListener(show, () => setShown(true));
    const hiddenSub = Keyboard.addListener(hide, () => setShown(false));
    // Both released. Dropping only one leaves this setting state on an unmounted screen every
    // time a keyboard opens or closes anywhere else in the app.
    return () => {
      shownSub.remove();
      hiddenSub.remove();
    };
  }, []);

  return shown;
}

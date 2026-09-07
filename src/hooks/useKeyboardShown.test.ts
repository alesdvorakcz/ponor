import { act, renderHook } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

import { keyboardEventNames, useKeyboardShown } from './useKeyboardShown';

/**
 * **The one thing here that can be wrong silently** (M3m). `keyboardWillShow` is iOS-only —
 * Android never emits it — so a hook written with the iOS names and shipped to both would
 * simply never fire on Android, with no error anywhere: the bottom inset would stay as it is
 * today, which is exactly the state this hook exists to change. It is a pure function so that
 * fact can be pinned without rendering anything, the same split `isWide` makes one file over.
 *
 * iOS gets `will` because the keyboard's own animation is what the control is being lifted
 * alongside; reacting on `did` there arrives a frame late and the padding visibly jumps.
 */
describe('keyboardEventNames', () => {
  it('listens for the events each platform actually emits', () => {
    expect(keyboardEventNames('ios')).toEqual({ show: 'keyboardWillShow', hide: 'keyboardWillHide' });
    // Android emits only the `did` pair, so asking for `will` there is asking for silence.
    expect(keyboardEventNames('android')).toEqual({ show: 'keyboardDidShow', hide: 'keyboardDidHide' });
  });

  it('gives every other platform the pair that is emitted everywhere', () => {
    // The browser (§9's testing target) among them: `react-native-web` emits the `did` pair
    // and nothing else, and a default of the iOS names would make this hook dead there too.
    expect(keyboardEventNames('web')).toEqual({ show: 'keyboardDidShow', hide: 'keyboardDidHide' });
  });
});

/** The handlers the hook registered, keyed by event, so a test can raise a keyboard without
 * one existing. Real subscription objects: the hook removes them on unmount and a stub with
 * no `remove` would pass while leaking a listener per mount. */
function captureListeners() {
  const handlers: Record<string, (() => void) | undefined> = {};
  const removed: string[] = [];
  const spy = jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, handler: () => void) => {
    handlers[event] = handler;
    return { remove: () => removed.push(event) };
  }) as unknown as typeof Keyboard.addListener);
  return { handlers, removed, restore: () => spy.mockRestore() };
}

describe('useKeyboardShown', () => {
  it('is false before a keyboard has appeared', async () => {
    const { restore } = captureListeners();
    try {
      const { result } = await renderHook(() => useKeyboardShown());
      // The state every screen mounts in, and the one that must not guess: a control reading
      // "the keyboard is up" on arrival would drop its home-indicator clearance on a screen
      // with no keyboard anywhere near it.
      expect(result.current).toBe(false);
    } finally {
      restore();
    }
  });

  it('follows the keyboard up and back down', async () => {
    const { handlers, restore } = captureListeners();
    try {
      const { result } = await renderHook(() => useKeyboardShown());

      await act(async () => handlers.keyboardWillShow?.());
      expect(result.current).toBe(true);

      await act(async () => handlers.keyboardWillHide?.());
      expect(result.current).toBe(false);
    } finally {
      restore();
    }
  });

  it('lets go of both listeners when the screen goes', async () => {
    const { removed, restore } = captureListeners();
    try {
      const { unmount } = await renderHook(() => useKeyboardShown());
      await unmount();
      // Both, not one: a hook that dropped only the show listener would keep setting state on
      // an unmounted screen every time a keyboard closed anywhere else in the app.
      expect(removed).toEqual(expect.arrayContaining(['keyboardWillShow', 'keyboardWillHide']));
      expect(removed).toHaveLength(2);
    } finally {
      restore();
    }
  });
});

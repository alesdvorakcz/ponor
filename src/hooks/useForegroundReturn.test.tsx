import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useForegroundReturn } from './useForegroundReturn';

/**
 * **The rule two features now share: a return to the foreground is a transition, not an
 * event.**
 *
 * It was `useSyncTriggers`' own effect and was tested there (`cloud/syncTriggers.test.tsx`,
 * §7.5's foreground trigger), against an engine. The tests below are that rule on its own,
 * against nothing — which is the point of moving it: §3's Settings row asks the same question
 * of the same API and must not get a second, subtly different answer to it (§4.1).
 *
 * `AppState.addEventListener` is spied rather than driven, for the reason that file records:
 * under Jest the native module behind it is a stub, so nothing would ever deliver an event.
 */
let handlers: ((state: AppStateStatus) => void)[];
let removals: number;

beforeEach(() => {
  handlers = [];
  removals = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    const listener = handler as (state: AppStateStatus) => void;
    if (event === 'change') handlers.push(listener);
    return {
      // **It really detaches**, unlike the counting stub `syncTriggers.test.tsx` uses. That
      // file asserts the removal was asked for; the last test below asserts what asking for it
      // buys, and a stub that only counted would go on delivering to an unmounted subscriber
      // and make that assertion unfalsifiable.
      remove: () => {
        removals += 1;
        handlers = handlers.filter((h) => h !== listener);
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function Harness({ onReturn }: { onReturn: () => void }) {
  useForegroundReturn(onReturn);
  return null;
}

/** Delivers one `AppState` change to every handler the hook registered. */
async function appStateChange(next: AppStateStatus) {
  await act(async () => {
    for (const handler of handlers) handler(next);
  });
}

it('calls back when the app returns to the foreground', async () => {
  const onReturn = jest.fn();
  await render(<Harness onReturn={onReturn} />);

  await appStateChange('background');
  expect(onReturn).not.toHaveBeenCalled();

  await appStateChange('active');
  expect(onReturn).toHaveBeenCalledTimes(1);
});

/**
 * **The transition, not the event**, and the reason this is worth a module. Unlocking a phone
 * delivers `inactive` then `active`; pulling the notification shade down and letting it go
 * delivers `inactive` then `active` again with the app never having left. A handler that ran
 * on every `active` would fire for both, and one that ran on every event would fire for the
 * `inactive` too — three or four calls for one unlock.
 */
it('ignores every event that is not a return to active', async () => {
  const onReturn = jest.fn();
  await render(<Harness onReturn={onReturn} />);

  await appStateChange('inactive');
  await appStateChange('background');
  await appStateChange('inactive');
  await appStateChange('active');
  expect(onReturn).toHaveBeenCalledTimes(1);

  // Already active: a second `active` is not a return to anything.
  await appStateChange('active');
  await appStateChange('active');
  expect(onReturn).toHaveBeenCalledTimes(1);
});

/**
 * **It subscribes once and calls the callback the last render handed over.**
 *
 * Both halves are one guarantee. The subscription is made on mount and never remade, so a
 * caller passing a fresh arrow every render — which is what a screen with a text field in it
 * does on every keystroke — would otherwise be calling back into the closure its FIRST render
 * built, over state that has since moved on. Asserted as "the second callback is the one that
 * runs, and the first one never does": a hook that re-subscribed per render would also pass
 * the first half of that and then run the handler twice.
 */
it('calls the newest callback, not the one the first render subscribed with', async () => {
  const first = jest.fn();
  const second = jest.fn();
  const tree = await render(<Harness onReturn={first} />);
  await tree.rerender(<Harness onReturn={second} />);

  await appStateChange('background');
  await appStateChange('active');

  expect(second).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
  expect(handlers).toHaveLength(1);
});

it('stops listening when its subscriber unmounts', async () => {
  const onReturn = jest.fn();
  const tree = await render(<Harness onReturn={onReturn} />);
  expect(removals).toBe(0);

  await tree.unmount();
  expect(removals).toBe(1);

  // ...and a handler delivered afterwards — the subscription this hook asked to be removed —
  // reaches nothing, which is what "removed" has to mean rather than merely "asked".
  await appStateChange('background');
  await appStateChange('active');
  expect(onReturn).not.toHaveBeenCalled();
});

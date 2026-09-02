import { act, render } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import { AppState, type AppStateStatus } from 'react-native';

import { stampLocalWrite } from '../db/dirty';
import type { SyncEngine } from './syncEngine';
import { SyncTriggers, useSyncTriggers } from './syncTriggers';
import { useAuthSession } from './useAuthSession';

jest.mock('./useAuthSession', () => ({ useAuthSession: jest.fn() }));

/**
 * **DESIGN.md §7.5's triggers: what asks for a cycle, and what must never ask for one twice.**
 *
 * The engine below is a stand-in on purpose. Whether a cycle is *allowed* — signed out, no
 * backend — and whether two can run at once are `cloud/syncEngine.ts`'s rules and are tested
 * against a real database and the fake server there. What is tested here is only the wiring,
 * and the wiring is where the silent mistakes are:
 *
 * · **A foreground handler that fires on every `AppState` event** syncs three or four times
 *   for one unlock — iOS goes `active → inactive → background` and back through `inactive` —
 *   and once for every notification shade pulled down and let go.
 * · **A listener that outlives its subscriber** keeps asking for cycles after the tree that
 *   wanted them is gone.
 * · **A session effect keyed on the session object** fires a cycle on every token refresh,
 *   because `onAuthStateChange` hands over a fresh object each time.
 * · **And the one that made this task urgent:** nothing at all keyed on a session *arriving*,
 *   so a diver who signs back in after §7.4's erase never pulls, and reads an empty logbook
 *   whose rows are safe on the server.
 */

const authSession = useAuthSession as jest.MockedFunction<typeof useAuthSession>;

/** A session with a given user, in the shape this hook reads and no more of one. */
function sessionFor(userId: string) {
  return { user: { id: userId } } as unknown as ReturnType<typeof useAuthSession>['session'];
}

function signedOut() {
  authSession.mockReturnValue({ session: null, resolved: true });
}

function signedIn(userId = 'a-diver') {
  authSession.mockReturnValue({ session: sessionFor(userId), resolved: true });
}

function fakeEngine(): jest.Mocked<SyncEngine> {
  return {
    request: jest.fn(async () => ({ kind: 'skipped' as const })),
    requestAfterSave: jest.fn(),
    runExclusive: jest.fn(async (work: () => Promise<unknown>) => work()),
    stop: jest.fn(),
  } as unknown as jest.Mocked<SyncEngine>;
}

/**
 * Every `AppState` `change` handler the render below registered, and the removals it made.
 *
 * Spied rather than emitted through the real `AppState`, because under Jest the native module
 * behind it is a stub and nothing would deliver an event — and because the removal is half of
 * what this file is checking.
 */
let appStateHandlers: ((state: AppStateStatus) => void)[];
let appStateRemovals: number;

beforeEach(() => {
  jest.clearAllMocks();
  signedOut();
  appStateHandlers = [];
  appStateRemovals = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'change') appStateHandlers.push(handler as (state: AppStateStatus) => void);
    return {
      remove: () => {
        appStateRemovals += 1;
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function Harness({ engine }: { engine: SyncEngine }) {
  useSyncTriggers(engine);
  return null;
}

/** Delivers one `AppState` change to every handler the hook registered. */
async function appStateChange(next: AppStateStatus) {
  await act(async () => {
    for (const handler of appStateHandlers) handler(next);
  });
}

describe('§7.5’s save trigger', () => {
  it('asks for a debounced cycle when a row is stamped for the server', async () => {
    const engine = fakeEngine();
    await render(<Harness engine={engine} />);

    expect(engine.requestAfterSave).not.toHaveBeenCalled();
    await act(async () => {
      stampLocalWrite();
    });
    expect(engine.requestAfterSave).toHaveBeenCalledTimes(1);
  });

  /**
   * **It is `requestAfterSave` and never `request`.** A cycle per save is what §7.5's window
   * exists to prevent — a diver editing a dive's depth, duration and two pressures is four
   * saves — and the difference between the two verbs is invisible on any screen.
   */
  it('never asks for an immediate cycle on a save', async () => {
    const engine = fakeEngine();
    await render(<Harness engine={engine} />);

    await act(async () => {
      stampLocalWrite();
      stampLocalWrite();
    });

    expect(engine.request).not.toHaveBeenCalled();
  });

  /** A listener that outlived its subscriber would go on asking for cycles for a tree that no
   * longer exists. */
  it('stops listening when it unmounts', async () => {
    const engine = fakeEngine();
    const tree = await render(<Harness engine={engine} />);
    await tree.unmount();

    await act(async () => {
      stampLocalWrite();
    });
    expect(engine.requestAfterSave).not.toHaveBeenCalled();
  });

  /**
   * **It asks even when nobody is signed in**, and that is the design rather than a hole: the
   * refusal has exactly one owner, and it is the engine, which re-reads the session at the
   * moment the cycle would run. A second copy of the rule here would differ from the first in
   * precisely the case that matters — a window armed while signed in, firing ten seconds after
   * the diver signed out.
   */
  it('leaves the signed-out refusal to the engine rather than keeping a copy of it', async () => {
    const engine = fakeEngine();
    signedOut();
    await render(<Harness engine={engine} />);

    await act(async () => {
      stampLocalWrite();
    });
    expect(engine.requestAfterSave).toHaveBeenCalledTimes(1);
  });
});

describe('§7.5’s foreground trigger', () => {
  it('syncs when the app comes back to the foreground', async () => {
    const engine = fakeEngine();
    await render(<Harness engine={engine} />);
    engine.request.mockClear();

    await appStateChange('background');
    expect(engine.request).not.toHaveBeenCalled();

    await appStateChange('active');
    expect(engine.request).toHaveBeenCalledTimes(1);
  });

  /**
   * **The transition, not the event.** Unlocking a phone delivers `inactive` then `active`;
   * pulling the notification shade down and letting it go delivers `inactive` then `active`
   * again with the app never having left. A handler that ran on every `active` would sync for
   * both, and one that ran on every event would sync for the `inactive` too.
   */
  it('ignores every event that is not a return to active', async () => {
    const engine = fakeEngine();
    await render(<Harness engine={engine} />);
    engine.request.mockClear();

    await appStateChange('inactive');
    await appStateChange('background');
    await appStateChange('inactive');
    await appStateChange('active');
    expect(engine.request).toHaveBeenCalledTimes(1);

    // Already active: a second `active` is not a return to anything.
    await appStateChange('active');
    await appStateChange('active');
    expect(engine.request).toHaveBeenCalledTimes(1);
  });

  it('removes its AppState subscription when it unmounts', async () => {
    const engine = fakeEngine();
    const tree = await render(<Harness engine={engine} />);
    expect(appStateRemovals).toBe(0);

    await tree.unmount();
    expect(appStateRemovals).toBe(1);
  });
});

describe('the trigger §7.5 does not name, and the app cannot work without', () => {
  /**
   * **The defect this whole task exists for.** §7.4's sign-out erases the device; signing back
   * in has to ask for the logbook, and nothing else here would. `AppState` is already `active`
   * at launch, so there is no foreground transition to fire on either — a diver who signs in
   * and never backgrounds the app would wait for ever.
   */
  it('syncs when a session arrives', async () => {
    const engine = fakeEngine();
    const tree = await render(<Harness engine={engine} />);
    expect(engine.request).not.toHaveBeenCalled();

    signedIn();
    await tree.rerender(<Harness engine={engine} />);
    expect(engine.request).toHaveBeenCalledTimes(1);
  });

  /**
   * **Keyed on the user, not on the session object.** `onAuthStateChange` delivers a fresh
   * session on every token refresh — roughly hourly — and an effect keyed on the object would
   * run a full cycle each time, which is neither what §7.5 asks for nor free on a boat.
   */
  it('does not sync again when the same diver’s token is refreshed', async () => {
    const engine = fakeEngine();
    signedIn('a-diver');
    const tree = await render(<Harness engine={engine} />);
    expect(engine.request).toHaveBeenCalledTimes(1);

    // A different session object for the same person, exactly as a refresh produces.
    authSession.mockReturnValue({ session: sessionFor('a-diver'), resolved: true });
    await tree.rerender(<Harness engine={engine} />);
    expect(engine.request).toHaveBeenCalledTimes(1);
  });

  it('syncs again when a different diver signs in', async () => {
    const engine = fakeEngine();
    signedIn('a-diver');
    const tree = await render(<Harness engine={engine} />);

    signedIn('another-diver');
    await tree.rerender(<Harness engine={engine} />);
    expect(engine.request).toHaveBeenCalledTimes(2);
  });

  /**
   * **A session ending drops what was scheduled**, which is the one thing standing between a
   * save window armed ten seconds ago and a cycle that pulls an account's whole logbook back
   * onto the device that has just left it (§7.4).
   */
  it('stops the engine when the session ends, and asks for nothing', async () => {
    const engine = fakeEngine();
    signedIn();
    const tree = await render(<Harness engine={engine} />);
    engine.request.mockClear();
    engine.stop.mockClear();

    signedOut();
    await tree.rerender(<Harness engine={engine} />);

    expect(engine.stop).toHaveBeenCalled();
    expect(engine.request).not.toHaveBeenCalled();
  });

  it('stops the engine when it unmounts', async () => {
    const engine = fakeEngine();
    signedIn();
    const tree = await render(<Harness engine={engine} />);
    engine.stop.mockClear();

    await tree.unmount();
    expect(engine.stop).toHaveBeenCalled();
  });
});

describe('the component the app root mounts', () => {
  /**
   * It draws nothing and subscribes everything — which is the whole of what `src/app/_layout.tsx`
   * gains, and that file carries no tests by design (§4.1). Rendered here against the app's real
   * engine with nobody signed in, which is what a checkout with no `.env` is: every trigger is
   * armed and every cycle would be refused.
   */
  it('renders nothing and subscribes to AppState', async () => {
    const tree = await render(<SyncTriggers />);

    expect(tree.toJSON()).toBeNull();
    expect(appStateHandlers.length).toBe(1);

    await tree.unmount();
    expect(appStateRemovals).toBe(1);
  });

  /**
   * **And the app root actually mounts it**, which nothing else here could show.
   *
   * §4.1 keeps `src/app/` free of tests on purpose — it holds thin route files — and that is
   * exactly why this rule needs a reader somewhere else: without that one line the whole of
   * §7.5 is dead code, every other test in this file still passes, and the only symptom is a
   * logbook that never syncs. Read off the source for `components/symbolName.ts`'s reason: a
   * rule that has to reach `src/app/` is held from outside it.
   *
   * **Below the migration gate**, and the position is as load-bearing as the presence. That
   * file returns `null` until `useMigrations()` reports success; a hook called in the component
   * body would arm triggers against a database whose tables do not exist yet. As a child of the
   * tree that renders only after `success`, it cannot.
   */
  it('is mounted by the app root, below the migration gate', () => {
    const layout = fs.readFileSync(path.join(__dirname, '..', 'app', '_layout.tsx'), 'utf8');

    expect(layout).toContain("from '../cloud/syncTriggers'");
    expect(layout).toContain('<SyncTriggers />');
    // Both anchors are quoted from that file, so a rewrite that moves the gate has to come
    // back here and say so rather than silently reordering the two.
    expect(layout).toContain('if (!success) return null;');
    expect(layout.indexOf('if (!success) return null;')).toBeLessThan(layout.indexOf('<SyncTriggers />'));
  });
});

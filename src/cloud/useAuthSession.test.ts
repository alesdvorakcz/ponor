import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useAuthSession } from './useAuthSession';

/**
 * `./supabase` is replaced by a **getter**, so each test can decide what the app's one `cloud`
 * looks like on the render it is about. A plain object in the factory would be read once at
 * import and fix every test to the same branch, which is the branch this hook is written to
 * skip entirely.
 *
 * The real module cannot be used here for the reason its own test records at length: it
 * decides once, at module scope, whether this build has a backend, so a suite that let the
 * machine's environment in would test something different on the owner's laptop than in CI.
 *
 * `mock`-prefixed because `babel-plugin-jest-hoist` lifts every `jest.mock` call above every
 * import and permits a factory to close over out-of-scope identifiers only when they are named
 * `mock…` — the same constraint `DiveFormScreen.test.tsx` records.
 */
let mockCloud: unknown = { configured: false, missing: [] };
jest.mock('./supabase', () => ({
  get cloud() {
    return mockCloud;
  },
}));

interface FakeAuth {
  getSession: jest.Mock;
  onAuthStateChange: jest.Mock;
}

const SESSION = { access_token: 'fake', user: { id: 'u1', email: 'ales@example.com' } };

/**
 * A configured cloud whose client records what the hook asked it, and hands back the callback
 * the hook subscribed with so a test can fire an auth event at it.
 */
function stubConfiguredCloud(): {
  auth: FakeAuth;
  unsubscribe: jest.Mock;
  fire: (session: unknown) => Promise<void>;
} {
  const unsubscribe = jest.fn();
  let listener: ((event: string, session: unknown) => void) | null = null;
  const auth: FakeAuth = {
    getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: jest.fn((callback: (event: string, session: unknown) => void) => {
      listener = callback;
      return { data: { subscription: { unsubscribe } } };
    }),
  };
  mockCloud = { configured: true, client: { auth } };
  return {
    auth,
    unsubscribe,
    // `act` is awaited, and `renderHook`/`unmount` below are too: this project's
    // `@testing-library/react-native` renders asynchronously, so an un-awaited `unmount()` is
    // not a function call that failed — it is a promise nobody waited for, and the assertion
    // after it reads the state as it was before the unmount.
    fire: async (session: unknown) => {
      if (listener === null) throw new Error('nothing subscribed');
      await act(async () => {
        listener?.('SIGNED_IN', session);
      });
    },
  };
}

afterEach(() => {
  mockCloud = { configured: false, missing: [] };
});

/**
 * `supabase.ts`'s rule, one module further out: "with the two variables absent, importing this
 * module changes nothing about the app... no keychain read on launch, no auth-refresh timer".
 *
 * **The unconfigured cloud below carries a client anyway**, which the type forbids and the
 * runtime allows. That is deliberate: a guard tested against a cloud with nothing behind it
 * would pass just as well if the guard were deleted, because there would be nothing there to
 * call. With a client present, only the guard keeps the hook off it.
 */
describe('with no backend in this build', () => {
  it('answers immediately, touches nothing, and subscribes to nothing', async () => {
    const auth: FakeAuth = {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
    };
    mockCloud = { configured: false, missing: ['EXPO_PUBLIC_SUPABASE_URL'], client: { auth } };

    const { result } = await renderHook(() => useAuthSession());

    expect(result.current).toEqual({ session: null, resolved: true });
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.onAuthStateChange).not.toHaveBeenCalled();
  });
});

describe('with a backend', () => {
  /**
   * The distinction `db/liveQuery.ts` draws for a database read, in the one place this app can
   * make it about a keychain: a `null` session on the first render means "not asked yet", and
   * a screen drawing the sign-in form on it would flash a form at a diver who is signed in,
   * on every open.
   */
  it('is unresolved until the session read answers', async () => {
    const { auth } = stubConfiguredCloud();
    let settle: ((value: unknown) => void) | undefined;
    auth.getSession.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const { result } = await renderHook(() => useAuthSession());
    expect(result.current).toEqual({ session: null, resolved: false });

    await act(async () => {
      settle?.({ data: { session: SESSION }, error: null });
    });
    expect(result.current).toEqual({ session: SESSION, resolved: true });
  });

  it('reports nobody signed in, resolved, when the keychain holds no session', async () => {
    stubConfiguredCloud();

    const { result } = await renderHook(() => useAuthSession());

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.session).toBeNull();
  });

  /**
   * A read that failed is an answer — `isResolved` (db/liveQuery.ts)'s own rule. Left
   * unresolved, the account screen would sit blank for ever with nothing to say why.
   */
  it('treats a failed session read as an answer rather than as a silence', async () => {
    const { auth } = stubConfiguredCloud();
    auth.getSession.mockRejectedValue(new Error('keychain unavailable'));

    const { result } = await renderHook(() => useAuthSession());

    await waitFor(() => expect(result.current).toEqual({ session: null, resolved: true }));
  });

  /** Nothing in this app polls, so this subscription is the whole of how signing in and
   * signing out change a screen. */
  it('follows the session when the auth state changes under it', async () => {
    const stub = stubConfiguredCloud();
    const { result } = await renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.resolved).toBe(true));

    await stub.fire(SESSION);
    expect(result.current.session).toBe(SESSION);

    await stub.fire(null);
    expect(result.current.session).toBeNull();
  });

  /**
   * `onAuthStateChange` hands back an unsubscribe that has to be called. Without this the
   * listener outlives every screen that ever opened, holding a dead `setState` and being
   * re-added on the next visit.
   */
  it('unsubscribes when the screen holding it goes away', async () => {
    const stub = stubConfiguredCloud();
    const { unmount } = await renderHook(() => useAuthSession());
    await waitFor(() => expect(stub.auth.onAuthStateChange).toHaveBeenCalledTimes(1));

    await unmount();

    expect(stub.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

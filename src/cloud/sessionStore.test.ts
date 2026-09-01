import * as SecureStore from 'expo-secure-store';

import { sessionStore } from './sessionStore';

/**
 * The keychain half of Supabase's session storage (DESIGN.md §4, "Auth session in the
 * keychain, not AsyncStorage").
 *
 * Spied rather than mocked: the point of these tests is that the three names this file calls
 * are the three names `expo-secure-store` actually exports, and a `jest.mock` factory would
 * happily invent whichever names the implementation asked for. The module imports cleanly
 * under Jest because the `jest-expo` preset ships its own `ExpoSecureStore` mock — no
 * hand-written `__mocks__` entry is needed here, unlike `expo-sqlite`.
 */
describe('sessionStore (keychain)', () => {
  const getItemAsync = jest.spyOn(SecureStore, 'getItemAsync');
  const setItemAsync = jest.spyOn(SecureStore, 'setItemAsync');
  const deleteItemAsync = jest.spyOn(SecureStore, 'deleteItemAsync');

  beforeEach(() => {
    getItemAsync.mockReset().mockResolvedValue(null);
    setItemAsync.mockReset().mockResolvedValue(undefined);
    deleteItemAsync.mockReset().mockResolvedValue(undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('reads a session out of the keychain', async () => {
    getItemAsync.mockResolvedValue('{"access_token":"abc"}');

    await expect(sessionStore.getItem('sb-demo-auth-token')).resolves.toBe('{"access_token":"abc"}');
    expect(getItemAsync).toHaveBeenCalledWith('sb-demo-auth-token');
  });

  it('reports a key the keychain does not hold as null, not as a throw', async () => {
    getItemAsync.mockResolvedValue(null);

    await expect(sessionStore.getItem('sb-demo-auth-token')).resolves.toBeNull();
  });

  it('writes a session into the keychain, key first', async () => {
    await sessionStore.setItem('sb-demo-auth-token', '{"access_token":"abc"}');

    expect(setItemAsync).toHaveBeenCalledWith('sb-demo-auth-token', '{"access_token":"abc"}');
  });

  it('signs out by deleting the key, not by writing an empty value over it', async () => {
    await sessionStore.removeItem('sb-demo-auth-token');

    expect(deleteItemAsync).toHaveBeenCalledWith('sb-demo-auth-token');
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  /**
   * The arity rule from `sessionStore.ts`'s docblock, defended rather than merely asserted.
   *
   * `SecureStore.getItemAsync(key, options)` takes a second argument that chooses the
   * keychain service and the accessibility class; `SupportedStorage`'s `getItem` takes one.
   * Writing `getItem: SecureStore.getItemAsync` compiles and passes every test above — and
   * the day a Supabase release passes a second argument, that argument silently becomes
   * SecureStore options and the session moves to a different keychain entry than the one it
   * was written to. The wrapper is what makes that impossible, so the test calls with a
   * second argument on purpose and checks it was dropped.
   */
  it('drops any extra argument rather than letting it become a SecureStore option', async () => {
    const looselyTyped = sessionStore as unknown as {
      getItem: (...args: unknown[]) => Promise<string | null>;
      setItem: (...args: unknown[]) => Promise<void>;
      removeItem: (...args: unknown[]) => Promise<void>;
    };
    const smuggled = { keychainService: 'somewhere-else' };

    await looselyTyped.getItem('sb-demo-auth-token', smuggled);
    await looselyTyped.setItem('sb-demo-auth-token', 'value', smuggled);
    await looselyTyped.removeItem('sb-demo-auth-token', smuggled);

    expect(getItemAsync).toHaveBeenCalledWith('sb-demo-auth-token');
    expect(setItemAsync).toHaveBeenCalledWith('sb-demo-auth-token', 'value');
    expect(deleteItemAsync).toHaveBeenCalledWith('sb-demo-auth-token');
  });
});

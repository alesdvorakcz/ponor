import { currentUserId } from './currentUser';

/**
 * **Who the device is signed in as, and what every way of not knowing amounts to.**
 *
 * `./supabase` is replaced by a **getter**, exactly as `useAuthSession.test.ts` replaces it and
 * for the same reason: the real module decides once, at module scope, whether this build has a
 * backend, so a suite that let the machine's environment in would test a different branch on
 * the owner's laptop than in CI.
 *
 * `mock`-prefixed because `babel-plugin-jest-hoist` lifts every `jest.mock` above every import
 * and permits a factory to close over an out-of-scope identifier only when it is named `mock…`.
 */
let mockCloud: unknown = { configured: false, missing: [] };
jest.mock('./supabase', () => ({
  get cloud() {
    return mockCloud;
  },
}));

const withSession = (getSession: jest.Mock) => {
  mockCloud = { configured: true, client: { auth: { getSession } } };
  return getSession;
};

beforeEach(() => {
  mockCloud = { configured: false, missing: [] };
});

describe('currentUserId', () => {
  it('is the signed-in diver’s id', async () => {
    withSession(jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }));
    await expect(currentUserId()).resolves.toBe('u1');
  });

  it('is nobody when no one is signed in', async () => {
    withSession(jest.fn().mockResolvedValue({ data: { session: null } }));
    await expect(currentUserId()).resolves.toBeNull();
  });

  it('is nobody when the keychain will not answer', async () => {
    // `useAuthSession` and `syncEngine` both state this rule for the same read: there is no
    // difference a caller can act on between no session and no readable session.
    withSession(jest.fn().mockRejectedValue(new Error('keychain unavailable')));
    await expect(currentUserId()).resolves.toBeNull();
  });

  it('asks nothing at all on a build with no backend', async () => {
    const getSession = jest.fn();
    mockCloud = { configured: false, missing: ['EXPO_PUBLIC_SUPABASE_URL'] };
    await expect(currentUserId()).resolves.toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });
});

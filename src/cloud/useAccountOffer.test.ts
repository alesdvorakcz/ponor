import { renderHook } from '@testing-library/react-native';

import { useAccountOffer } from './useAccountOffer';
import { useAuthSession } from './useAuthSession';

/**
 * `./supabase` behind a getter, so each test decides whether this build has a backend — the
 * pattern `useAuthSession.test.ts` records. `./useAuthSession` is mocked outright: what it
 * answers is that hook's own subject, and this one only reads the answer.
 */
let mockCloud: unknown = { configured: true, client: {} };
jest.mock('./supabase', () => ({
  get cloud() {
    return mockCloud;
  },
}));
jest.mock('./useAuthSession', () => ({ useAuthSession: jest.fn() }));

const mockUseAuthSession = useAuthSession as unknown as jest.Mock;

beforeEach(() => {
  mockCloud = { configured: true, client: {} };
  mockUseAuthSession.mockReset();
});

it('offers an account to a guest once the session read has answered', async () => {
  mockUseAuthSession.mockReturnValue({ session: null, resolved: true });
  expect((await renderHook(() => useAccountOffer())).result.current).toBe(true);
});

it('offers nothing while the session read is out', async () => {
  // A `null` session before the read answers is "not looked yet", not "nobody": offering a
  // sign-in now would say it to a diver who may well be signed in.
  mockUseAuthSession.mockReturnValue({ session: null, resolved: false });
  expect((await renderHook(() => useAccountOffer())).result.current).toBe(false);
});

it('offers nothing to a diver who is signed in', async () => {
  mockUseAuthSession.mockReturnValue({ session: { user: { id: 'u1' } }, resolved: true });
  expect((await renderHook(() => useAccountOffer())).result.current).toBe(false);
});

it('offers nothing on a build with no backend', async () => {
  // `useAuthSession` answers at once with nobody on such a build — so without this half the
  // offer would show on exactly the build where it leads to "there is nothing to sign in to".
  mockCloud = { configured: false, missing: ['EXPO_PUBLIC_SUPABASE_URL'] };
  mockUseAuthSession.mockReturnValue({ session: null, resolved: true });
  expect((await renderHook(() => useAccountOffer())).result.current).toBe(false);
});

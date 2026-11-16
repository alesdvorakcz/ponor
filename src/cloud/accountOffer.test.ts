import { offersAccount } from './accountOffer';

/**
 * `./supabase` behind a getter, so each test decides whether this build has a backend — the
 * pattern `useAuthSession.test.ts` records. The session state is handed in: it is each screen's
 * own one read of `useAuthSession` (review of PR #52 — a second read would be a second
 * subscription free to disagree with the first, §4.1).
 */
let mockCloud: unknown = { configured: true, client: {} };
jest.mock('./supabase', () => ({
  get cloud() {
    return mockCloud;
  },
}));

beforeEach(() => {
  mockCloud = { configured: true, client: {} };
});

it('offers an account to a guest once the session read has answered', () => {
  expect(offersAccount({ session: null, resolved: true })).toBe(true);
});

it('offers nothing while the session read is out', () => {
  // A `null` session before the read answers is "not looked yet", not "nobody": offering a
  // sign-in now would say it to a diver who may well be signed in.
  expect(offersAccount({ session: null, resolved: false })).toBe(false);
});

it('offers nothing to a diver who is signed in', () => {
  expect(offersAccount({ session: { user: { id: 'u1' } } as never, resolved: true })).toBe(false);
});

it('offers nothing on a build with no backend', () => {
  // `useAuthSession` answers at once with nobody on such a build — so without this half the
  // offer would show on exactly the build where it leads to "there is nothing to sign in to".
  mockCloud = { configured: false, missing: ['EXPO_PUBLIC_SUPABASE_URL'] };
  expect(offersAccount({ session: null, resolved: true })).toBe(false);
});

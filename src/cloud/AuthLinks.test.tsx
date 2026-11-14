import { act, render } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';

import { completeAuthLink, type LinkOutcome } from './auth';
import { authLinkState, setAuthLinkState } from './authLinkState';
import { AuthLinks } from './AuthLinks';
import { localLogbook } from './localLogbook';

jest.mock('expo-linking', () => ({ getInitialURL: jest.fn(), addEventListener: jest.fn() }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('./auth', () => ({ ...jest.requireActual('./auth'), completeAuthLink: jest.fn() }));

let mockCloud: unknown = { configured: true, client: { itIsTheFakeClient: true } };
jest.mock('./supabase', () => ({
  get cloud() {
    return mockCloud;
  },
}));

const getInitialURL = Linking.getInitialURL as jest.Mock;
const addEventListener = Linking.addEventListener as jest.Mock;
const navigate = router.navigate as jest.Mock;
const complete = completeAuthLink as unknown as jest.Mock;
const remove = jest.fn();

/** The handler the component registered for links that arrive while it is running. */
function linkListener(): (event: { url: string }) => void {
  const handler = addEventListener.mock.calls[0]?.[1];
  if (typeof handler !== 'function') throw new Error('no url listener registered');
  return handler as (event: { url: string }) => void;
}

/** Lets the outcome's promise and the state write after it run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockCloud = { configured: true, client: { itIsTheFakeClient: true } };
  getInitialURL.mockResolvedValue(null);
  addEventListener.mockReturnValue({ remove });
  complete.mockResolvedValue({ kind: 'signedIn', adopted: 2 } satisfies LinkOutcome);
  setAuthLinkState({ kind: 'idle' });
});

afterEach(() => {
  jest.clearAllMocks();
});

// The link in the confirmation or reset mail opens the app — cold, or while it is running —
// and the account screen is where its outcome is said.
it('takes a mail link the app was opened with to the account screen, and signs in with it', async () => {
  getInitialURL.mockResolvedValue('ponor://?code=abc');
  await render(<AuthLinks />);
  await settle();

  expect(navigate).toHaveBeenCalledWith('/account');
  expect(complete).toHaveBeenCalledWith({ itIsTheFakeClient: true }, 'ponor://?code=abc', localLogbook);
  expect(authLinkState()).toEqual({ kind: 'signedIn', adopted: 2 });
});

it('does the same for a link that arrives while the app is open', async () => {
  await render(<AuthLinks />);
  await settle();
  let answer: (outcome: LinkOutcome) => void = () => {};
  complete.mockReturnValue(new Promise<LinkOutcome>((resolve) => (answer = resolve)));

  await act(() => linkListener()({ url: 'ponor://?code=r-1' }));
  // Said at once, before the network answers, so the screen the diver lands on is not a sign-in
  // form they might start typing into.
  expect(authLinkState()).toEqual({ kind: 'working' });
  answer({ kind: 'recovery', adopted: 0 });
  await settle();

  expect(navigate).toHaveBeenCalledWith('/account');
  expect(authLinkState()).toEqual({ kind: 'recovery', adopted: 0 });
});

// Every other link the app is opened with — its own routes, the development client's — is the
// router's business and none of this module's.
it('leaves every other link alone', async () => {
  getInitialURL.mockResolvedValue('exp+ponor://expo-development-client/?url=http%3A%2F%2F192.168.1.2%3A8081');
  await render(<AuthLinks />);
  await settle();
  await act(() => linkListener()({ url: 'ponor://account' }));
  await settle();

  expect(navigate).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  expect(authLinkState()).toEqual({ kind: 'idle' });
});

// A code is good once. The same link delivered twice — on launch and again as an event, which a
// platform may do — must not be exchanged twice, or the second attempt fails and its sentence
// replaces the first attempt's success.
it('uses one link once, however many times it is delivered', async () => {
  getInitialURL.mockResolvedValue('ponor://?code=abc');
  await render(<AuthLinks />);
  await settle();
  await act(() => linkListener()({ url: 'ponor://?code=abc' }));
  await settle();

  expect(complete).toHaveBeenCalledTimes(1);
});

it('says why a link could not be used', async () => {
  complete.mockResolvedValue({ kind: 'failed', message: 'That link has expired. Ask for a new one.' } satisfies LinkOutcome);
  getInitialURL.mockResolvedValue('ponor://?error_code=otp_expired');
  await render(<AuthLinks />);
  await settle();

  expect(authLinkState()).toEqual({ kind: 'failed', message: 'That link has expired. Ask for a new one.' });
});

// §1: a build with no backend behaves as if this file did not exist.
it('listens for nothing in a build with no backend', async () => {
  mockCloud = { configured: false, missing: ['EXPO_PUBLIC_SUPABASE_URL'] };
  await render(<AuthLinks />);
  await settle();

  expect(getInitialURL).not.toHaveBeenCalled();
  expect(addEventListener).not.toHaveBeenCalled();
});

it('stops listening when it goes', async () => {
  const t = await render(<AuthLinks />);
  await settle();
  await t.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

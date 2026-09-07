import { setActiveLanguage } from '../i18n';
import {
  AuthApiError,
  AuthRetryableFetchError,
  type SupabaseClient,
} from '@supabase/supabase-js';

import {
  accountDeletedDeviceKept,
  authenticate,
  credentialRefusal,
  CONFIRMATION_REDIRECT,
  confirmationRequired,
  credentialsRejected,
  deleteAccount,
  deleteAccountFailed,
  deleteAccountUnavailable,
  DELETE_ACCOUNT_RPC,
  emailMalformed,
  emailRequired,
  emailTaken,
  endSession,
  messageFor,
  passwordRequired,
  passwordTooWeak,
  serverUnreachable,
  signInFailed,
  signOutFailed,
  signOutUnavailable,
  signUpFailed,
  signupDisabled,
  startOver,
  startOverFailed,
  startOverUnavailable,
  startOverUnpushed,
  tooManyTries,
  unpushedChanges,
  wipeFailed,
  type AuthMode,
} from './auth';
import { localLogbook, type LocalLogbook } from './localLogbook';

/**
 * **No real sign-in has ever been performed from this tree, and none can be.** There are no
 * credentials for the owner's Supabase project here and none were sought; this repository is
 * public and the only key in it is the publishable one in a gitignored `.env`. Everything
 * below runs against a fake client.
 *
 * What keeps that from being a test of a fiction: the **errors are real**. `AuthApiError` and
 * `AuthRetryableFetchError` are the installed library's own classes with the codes its own
 * `ErrorCode` union declares, so `messageFor`'s mapping is checked against the shape a server
 * actually produces rather than against a hand-made object that agrees with it by
 * construction. `@supabase/supabase-js` is deliberately **not** mocked in this file for the
 * same reason.
 */

/** A distinguishable session. Nothing here reads its contents — `authenticate` decides on the
 * presence of one, which is precisely the property being tested. */
const SESSION = { access_token: 'fake', user: { id: 'u1' } } as never;
const USER = { id: 'u1', email: 'ales@example.com' } as never;

interface FakeAuth {
  signInWithPassword: jest.Mock;
  signUp: jest.Mock;
  signOut: jest.Mock;
}

/** A client with the calls this module makes and nothing else — the three `auth` ones, and
 * since M3j the one RPC (`delete_account`). Cast at this one boundary so no test below has
 * to. */
function fakeClient(): { client: SupabaseClient; auth: FakeAuth; rpc: jest.Mock } {
  const auth: FakeAuth = {
    signInWithPassword: jest.fn().mockResolvedValue({ data: { session: SESSION, user: USER }, error: null }),
    signUp: jest.fn().mockResolvedValue({ data: { session: null, user: USER }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
  };
  const rpc = jest
    .fn()
    .mockResolvedValue({ data: { deleted: true, dive_sites_kept: 0, dive_centers_kept: 0 }, error: null });
  return { client: { auth, rpc } as unknown as SupabaseClient, auth, rpc };
}

/** A wired seam whose ports are spies, so the order and the fact of each call can be asserted
 * rather than inferred from a result. */
function wiredLogbook(
  over: { adopt?: jest.Mock; wipe?: jest.Mock; startOver?: jest.Mock; erase?: jest.Mock } = {},
) {
  const adopt = over.adopt ?? jest.fn().mockResolvedValue(0);
  const wipe = over.wipe ?? jest.fn().mockResolvedValue({ done: true });
  const startOver = over.startOver ?? jest.fn().mockResolvedValue({ done: true });
  const erase = over.erase ?? jest.fn().mockResolvedValue(undefined);
  const logbook: LocalLogbook = { wired: true, adopt, wipe, startOver, erase };
  return { logbook, adopt, wipe, startOver, erase };
}

const UNWIRED: LocalLogbook = { wired: false };

describe('credentialRefusal', () => {
  it('asks for the email before anything is sent', () => {
    expect(credentialRefusal({ email: '', password: 'hunter2' })).toEqual({
      // The row, not just the sentence: "Enter your email address." shipped under *Password*
      // until this screen was put on a phone and read.
      field: 'email',
      message: emailRequired(),
    });
  });

  /** A soft keyboard supplies these on its own, and an address of spaces is not an address. */
  it('treats a whitespace-only email as no email at all', () => {
    expect(credentialRefusal({ email: '   ', password: 'hunter2' })).toEqual({
      field: 'email',
      message: emailRequired(),
    });
  });

  it('asks for the password once there is an email', () => {
    expect(credentialRefusal({ email: 'ales@example.com', password: '' })).toEqual({
      field: 'password',
      message: passwordRequired(),
    });
  });

  /**
   * **A password of spaces is a password**, and this is the assertion that says the two rows
   * are not trimmed alike. Applying the email's rule to the password would silently reject —
   * and, worse, silently alter — a passphrase a diver chose, so that the same keystrokes that
   * created an account would not open it again.
   */
  it('accepts a password made of spaces, which the email rule would have refused', () => {
    expect(credentialRefusal({ email: 'ales@example.com', password: '   ' })).toBeNull();
  });

  it('lets a filled pair through', () => {
    expect(credentialRefusal({ email: 'ales@example.com', password: 'hunter2' })).toBeNull();
  });
});

describe('messageFor', () => {
  /**
   * The whole table, so a code that stops being mapped fails here rather than reaching a diver
   * as "Couldn't sign in. Try again." — which is a true sentence and tells them nothing.
   */
  it.each([
    ['invalid_credentials', credentialsRejected()],
    ['user_already_exists', emailTaken()],
    ['email_exists', emailTaken()],
    ['weak_password', passwordTooWeak()],
    ['email_address_invalid', emailMalformed()],
    ['validation_failed', emailMalformed()],
    ['signup_disabled', signupDisabled()],
    ['over_request_rate_limit', tooManyTries()],
    ['over_email_send_rate_limit', tooManyTries()],
    ['email_not_confirmed', confirmationRequired()],
  ])('answers %s with its own sentence', (code, expected) => {
    expect(messageFor(new AuthApiError('server text', 400, code), 'signIn')).toBe(expected);
  });

  /**
   * The one error a diver will misdiagnose. With confirmation switched on (owner's call, M2e)
   * an unconfirmed account answers a *correct* password with `email_not_confirmed`, and every
   * other thing on screen is a password field — so if this ever collapsed into
   * `credentialsRejected` a diver would retype a working password until they gave up.
   */
  it('never tells an unconfirmed account that its password is wrong', () => {
    const unconfirmed = messageFor(new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'), 'signIn');
    expect(unconfirmed).not.toBe(credentialsRejected());
    expect(unconfirmed).toBe(confirmationRequired());
  });

  it('names the network when the request never completed', () => {
    expect(messageFor(new AuthRetryableFetchError('Failed to fetch', 0), 'signIn')).toBe(serverUnreachable());
    expect(messageFor(new AuthRetryableFetchError('Failed to fetch', 0), 'signUp')).toBe(serverUnreachable());
  });

  it('falls back to the sentence for the act that failed, not to one sentence for both', () => {
    const unknown = new AuthApiError('teapot', 418, 'a_code_from_a_newer_server');
    expect(messageFor(unknown, 'signIn')).toBe(signInFailed());
    expect(messageFor(unknown, 'signUp')).toBe(signUpFailed());
  });

  it('says something for a thrown value that is not an error at all', () => {
    expect(messageFor('plain string', 'signIn')).toBe(signInFailed());
    expect(messageFor(null, 'signUp')).toBe(signUpFailed());
    expect(messageFor(undefined, 'signIn')).toBe(signInFailed());
  });
});

/**
 * **The password must not travel, and this is where that is enforced rather than intended.**
 *
 * The failure this defends is specific: a validation error can echo the input that produced
 * it, so a `messageFor` that returned `error.message` would put the secret on the screen, into
 * any screenshot of it, and — once §9 wires Sentry in M3 — into a breadcrumb on somebody
 * else's server. The password is planted inside the error's own text, which is exactly the
 * shape that would leak.
 */
describe('the password never comes back out', () => {
  const SECRET = 'correct-horse-battery-staple';

  const everyErrorShape = (): unknown[] => [
    new AuthApiError(`rejected: ${SECRET}`, 400, 'invalid_credentials'),
    new AuthApiError(`rejected: ${SECRET}`, 400, 'weak_password'),
    new AuthApiError(`rejected: ${SECRET}`, 422, 'validation_failed'),
    new AuthApiError(`rejected: ${SECRET}`, 400, 'a_code_from_a_newer_server'),
    new AuthRetryableFetchError(`rejected: ${SECRET}`, 0),
    new Error(`rejected: ${SECRET}`),
    `rejected: ${SECRET}`,
  ];

  it.each(['signIn', 'signUp'] as AuthMode[])('keeps it out of every mapped message (%s)', (mode) => {
    const shapes = everyErrorShape();
    // The sweep is worth nothing if it sweeps nothing, and it has to include the fallback arm
    // — the one an edit is most likely to "improve" into `error.message`.
    expect(shapes.length).toBeGreaterThanOrEqual(7);
    for (const shape of shapes) expect(messageFor(shape, mode)).not.toContain(SECRET);
  });

  it('keeps it out of what a failed attempt reports to the screen', async () => {
    const { client, auth } = fakeClient();
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError(`rejected: ${SECRET}`, 400, 'invalid_credentials'),
    });

    const outcome = await authenticate(client, 'signIn', { email: 'a@b.c', password: SECRET }, UNWIRED);

    expect(outcome).toEqual({ kind: 'failed', message: credentialsRejected() });
  });

  /**
   * A `console.warn(error)` on a failed sign-in is a password-shaped string in a crash report,
   * because Sentry's React Native SDK turns console output into breadcrumbs by default. §9
   * wires Sentry in M3; this is decided now, because afterwards the leak is invisible from
   * this file.
   */
  it('says nothing on any console, on any path', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

    try {
      const { client, auth } = fakeClient();
      const { logbook } = wiredLogbook({ adopt: jest.fn().mockRejectedValue(new Error('nope')) });

      // A refusal, a rejection, a throw, a success with a failing adoption, and a sign-out —
      // every path out of this module, with the secret in hand on each of them.
      await authenticate(client, 'signIn', { email: '', password: SECRET }, logbook);
      auth.signInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: new AuthApiError(`rejected: ${SECRET}`, 400, 'invalid_credentials'),
      });
      await authenticate(client, 'signIn', { email: 'a@b.c', password: SECRET }, logbook);
      auth.signInWithPassword.mockRejectedValueOnce(new Error(`exploded: ${SECRET}`));
      await authenticate(client, 'signIn', { email: 'a@b.c', password: SECRET }, logbook);
      await authenticate(client, 'signIn', { email: 'a@b.c', password: SECRET }, logbook);
      await endSession(client, logbook);

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('authenticate', () => {
  it('does not reach the network for a pair it can refuse itself', async () => {
    const { client, auth } = fakeClient();

    const outcome = await authenticate(client, 'signIn', { email: ' ', password: 'x' }, UNWIRED);

    // The field travels with the message, so the screen can put it under the row it names.
    expect(outcome).toEqual({ kind: 'failed', message: emailRequired(), field: 'email' });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  /**
   * The pair of rules that are one line apart in the source and opposite in effect. An address
   * with a trailing space matches no account; a password with a trailing space **is** a
   * different password, and a client that quietly trimmed it would accept a passphrase at
   * sign-up and reject the same keystrokes at sign-in.
   */
  it('trims the email and leaves the password exactly as typed', async () => {
    const { client, auth } = fakeClient();

    await authenticate(client, 'signIn', { email: '  Ales@Example.com \n', password: '  hunter 2  ' }, UNWIRED);

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'Ales@Example.com',
      password: '  hunter 2  ',
    });
  });

  it('signs in through signInWithPassword and never through signUp', async () => {
    const { client, auth } = fakeClient();

    const outcome = await authenticate(client, 'signIn', { email: 'a@b.c', password: 'p' }, UNWIRED);

    expect(outcome).toEqual({ kind: 'signedIn', adopted: 0 });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('creates an account through signUp and never through signInWithPassword', async () => {
    const { client, auth } = fakeClient();

    await authenticate(client, 'signUp', { email: 'a@b.c', password: 'p' }, UNWIRED);

    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.c',
      password: 'p',
      options: { emailRedirectTo: CONFIRMATION_REDIRECT },
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  /**
   * **The redirect is passed, and it is the app's own scheme.**
   *
   * Omitting it is not an error anywhere: Supabase falls back to the project's Site URL, the
   * address is still confirmed server-side, and the diver is dropped on whatever that setting
   * says — `http://localhost:3000` on a fresh project. The account works, the landing is dead,
   * and nothing raises. That is what happened on this project's first real sign-up.
   *
   * Two assertions rather than one, because they fail for different reasons: the first says the
   * option is *sent*, the second says the value still matches `app.config.ts`. A scheme rename
   * that updated only the config would leave the first green.
   */
  it('sends the confirmation back to the app, at the scheme app.config.ts publishes', async () => {
    const { client, auth } = fakeClient();

    await authenticate(client, 'signUp', { email: 'a@b.c', password: 'p' }, UNWIRED);

    const [args] = auth.signUp.mock.calls[0] as [{ options?: { emailRedirectTo?: string } }];
    expect(args.options?.emailRedirectTo).toBe(CONFIRMATION_REDIRECT);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appConfig = require('../../app.config.ts') as { default: { scheme: string } };
    expect(CONFIRMATION_REDIRECT).toBe(`${appConfig.default.scheme}://`);
  });

  /**
   * §7.4's adoption: "every local row is marked dirty and pushed", and the count is what the
   * app says out loud afterwards.
   */
  it('adopts this phone’s rows on a sign-in and reports how many dives went', async () => {
    const { client } = fakeClient();
    const { logbook, adopt } = wiredLogbook({ adopt: jest.fn().mockResolvedValue(4) });

    const outcome = await authenticate(client, 'signIn', { email: 'a@b.c', password: 'p' }, logbook);

    expect(adopt).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'signedIn', adopted: 4 });
  });

  /**
   * §1: an auth failure never blocks logging, and §7.4 makes the adoption "a statement, not a
   * dialog" — so a wall built out of a failed adoption is still a wall. Both ways it can fail
   * leave the diver signed in with nothing said.
   */
  it('signs the diver in even when the adoption rejects', async () => {
    const { client } = fakeClient();
    const { logbook } = wiredLogbook({ adopt: jest.fn().mockRejectedValue(new Error('database is locked')) });

    await expect(authenticate(client, 'signIn', { email: 'a@b.c', password: 'p' }, logbook)).resolves.toEqual({
      kind: 'signedIn',
      adopted: 0,
    });
  });

  it('signs the diver in when the local-logbook seam is not wired at all', async () => {
    const { client } = fakeClient();

    await expect(authenticate(client, 'signIn', { email: 'a@b.c', password: 'p' }, UNWIRED)).resolves.toEqual({
      kind: 'signedIn',
      adopted: 0,
    });
  });

  /**
   * The owner switched email confirmation **on** (M2e), so this is the ordinary result of
   * creating an account: a user, no session, and a link waiting in an inbox.
   */
  it('reports a sign-up as a confirmation waiting, with the address it went to', async () => {
    const { client, auth } = fakeClient();
    auth.signUp.mockResolvedValue({ data: { session: null, user: USER }, error: null });

    const outcome = await authenticate(client, 'signUp', { email: ' ales@example.com ', password: 'p' }, UNWIRED);

    // The NORMALISED address, which is what the mail went to and what the diver has to be able
    // to check against the one they meant to type.
    expect(outcome).toEqual({ kind: 'confirmationSent', email: 'ales@example.com' });
  });

  /**
   * Nothing to push to until the address is confirmed. Adopting here would leave a device full
   * of dirty rows and no account, and would put "4 dives were added to your logbook" on screen
   * about a logbook that does not exist yet.
   */
  it('adopts nothing when a sign-up only sent a confirmation', async () => {
    const { client, auth } = fakeClient();
    auth.signUp.mockResolvedValue({ data: { session: null, user: USER }, error: null });
    const { logbook, adopt } = wiredLogbook({ adopt: jest.fn().mockResolvedValue(4) });

    await authenticate(client, 'signUp', { email: 'a@b.c', password: 'p' }, logbook);

    expect(adopt).not.toHaveBeenCalled();
  });

  /**
   * The session decides which arm, not the mode — so if the owner ever switches confirmation
   * off again, sign-up starts signing divers in and adopting their dives on the same line of
   * code, instead of this app carrying a hard-coded copy of a project setting.
   */
  it('treats a sign-up that DID return a session as a sign-in, adoption and all', async () => {
    const { client, auth } = fakeClient();
    auth.signUp.mockResolvedValue({ data: { session: SESSION, user: USER }, error: null });
    const { logbook, adopt } = wiredLogbook({ adopt: jest.fn().mockResolvedValue(2) });

    const outcome = await authenticate(client, 'signUp', { email: 'a@b.c', password: 'p' }, logbook);

    expect(outcome).toEqual({ kind: 'signedIn', adopted: 2 });
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  it('reports a sign-in that came back with no session rather than believing it', async () => {
    const { client, auth } = fakeClient();
    auth.signInWithPassword.mockResolvedValue({ data: { session: null, user: null }, error: null });

    await expect(authenticate(client, 'signIn', { email: 'a@b.c', password: 'p' }, UNWIRED)).resolves.toEqual({
      kind: 'failed',
      message: signInFailed(),
    });
  });

  it('reports a sign-up that came back with neither user nor session', async () => {
    const { client, auth } = fakeClient();
    auth.signUp.mockResolvedValue({ data: { session: null, user: null }, error: null });

    await expect(authenticate(client, 'signUp', { email: 'a@b.c', password: 'p' }, UNWIRED)).resolves.toEqual({
      kind: 'failed',
      message: signUpFailed(),
    });
  });

  it('turns a throw from underneath the client into a sentence instead of an exception', async () => {
    const { client, auth } = fakeClient();
    auth.signInWithPassword.mockRejectedValue(new AuthRetryableFetchError('Network request failed', 0));

    await expect(authenticate(client, 'signIn', { email: 'a@b.c', password: 'p' }, UNWIRED)).resolves.toEqual({
      kind: 'failed',
      message: serverUnreachable(),
    });
  });
});

/**
 * §7.4's sign-out, which is "the one destructive action in v1" and is therefore the one place
 * an ordering mistake destroys something.
 */
describe('endSession', () => {
  /**
   * **The order is the safety property.** Wiping first means the two ways this can fail are
   * *nothing happened* and *the logbook went but the session stayed* — and neither of them is
   * a signed-out device still holding one person's logbook, which §7.4 names as "the only way
   * a second account could ever see them".
   */
  it('wipes this device before it ends the session, never after', async () => {
    const order: string[] = [];
    const { client, auth } = fakeClient();
    auth.signOut.mockImplementation(async () => {
      order.push('signOut');
      return { error: null };
    });
    const { logbook } = wiredLogbook({
      wipe: jest.fn().mockImplementation(async () => {
        order.push('wipe');
        return { done: true };
      }),
    });

    await expect(endSession(client, logbook)).resolves.toEqual({ ok: true });
    expect(order).toEqual(['wipe', 'signOut']);
  });

  /**
   * Supabase signs out **globally** unless told otherwise, revoking every refresh token the
   * account has — so signing out on the phone would sign the diver out of the tablet too. §7
   * is built on one person owning several devices; one leaving must not evict the others.
   */
  it('signs out this device only', async () => {
    const { client, auth } = fakeClient();
    const { logbook } = wiredLogbook();

    await endSession(client, logbook);

    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  /**
   * The refusal for a build whose seam is not wired (`localLogbook.ts`). The shipped seam is
   * wired from M2g, so this arm is now unreachable through the app and is kept for the same
   * reason `signOutUnavailable` is: the assertion that matters is the second one, and signing
   * out without wiping would leave the device holding a logbook that the confirmation dialog
   * had just promised to remove.
   */
  it('refuses to sign out at all when the device cannot be wiped yet', async () => {
    const { client, auth } = fakeClient();

    await expect(endSession(client, UNWIRED)).resolves.toEqual({
      ok: false,
      message: signOutUnavailable(),
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('leaves the session alone when the wipe itself rejects', async () => {
    const { client, auth } = fakeClient();
    const { logbook } = wiredLogbook({ wipe: jest.fn().mockRejectedValue(new Error('database is locked')) });

    await expect(endSession(client, logbook)).resolves.toEqual({ ok: false, message: wipeFailed() });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('says both halves when the logbook went and the session did not', async () => {
    const { client, auth } = fakeClient();
    auth.signOut.mockResolvedValue({ error: new AuthApiError('nope', 500, 'unexpected_failure') });
    const { logbook, wipe } = wiredLogbook();

    await expect(endSession(client, logbook)).resolves.toEqual({ ok: false, message: signOutFailed() });
    expect(wipe).toHaveBeenCalledTimes(1);
  });

  it('reports a throw from the client the same way it reports a returned error', async () => {
    const { client, auth } = fakeClient();
    auth.signOut.mockRejectedValue(new Error('storage exploded'));
    const { logbook } = wiredLogbook();

    await expect(endSession(client, logbook)).resolves.toEqual({ ok: false, message: signOutFailed() });
  });

  /**
   * §7.4's wipe refusing because this phone is still holding rows the account has not received
   * (`cloud/localLogbook.ts`). **It is not a failure**, and the two things it must not do are
   * both here: it must not end the session, and it must not be reported with `wipeFailed`,
   * whose sentence says the erase was attempted and could not be done.
   */
  it('keeps the session and says why when the device still owes the server', async () => {
    const { client, auth } = fakeClient();
    const { logbook } = wiredLogbook({ wipe: jest.fn().mockResolvedValue({ done: false, pending: 3 }) });

    await expect(endSession(client, logbook)).resolves.toEqual({
      ok: false,
      message: unpushedChanges(),
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  /** The two refusals are different sentences, because they ask the diver for different things:
   * one is "connect and try again", the other is "this did not work". A single message for both
   * would tell a diver at sea that their phone is broken. */
  it('tells a refusal apart from a failed erase', async () => {
    expect(unpushedChanges()).not.toBe(wipeFailed());
    expect(unpushedChanges()).not.toBe(signOutFailed());
    expect(unpushedChanges()).not.toBe(signOutUnavailable());
  });
});

describe('startOver — §7.4’s second destructive act (M3j)', () => {
  /**
   * **The session's side of a start over is nothing at all**, which is the whole distinction
   * between this act and the two either side of it: §7.4's table says the account survives. A
   * start over that signed the diver out would leave them looking at a sign-in form after asking
   * to empty a logbook they are still the owner of.
   */
  it('empties the logbook and leaves the diver signed in', async () => {
    const { client, auth, rpc } = fakeClient();
    const { logbook, startOver: sweep } = wiredLogbook();

    await expect(startOver(logbook)).resolves.toEqual({ ok: true });

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    // Named so the unused client cannot be read as an oversight: this function takes none.
    expect(client).toBeDefined();
  });

  /** It is the start-over sequence it runs, not the sign-out one — those differ by the
   * tombstones, which are the only thing that makes the deletion reach a second device. */
  it('runs the start-over sequence and never the plain wipe', async () => {
    const { logbook, wipe, startOver: sweep } = wiredLogbook();

    await startOver(logbook);

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(wipe).not.toHaveBeenCalled();
  });

  /**
   * **The refusal is its own sentence, and this is the assertion that keeps it one.** Sign-out's
   * `unpushedChanges` says "nothing was cleared, and you're still signed in" — true there, and a
   * plain lie here, where the tombstones are written and the diver's logbook is already empty on
   * screen. Reusing it would be the app telling a diver nothing happened while they look at the
   * evidence that something did.
   */
  it('says what is true of a start over that could not be delivered', async () => {
    const { logbook } = wiredLogbook({
      startOver: jest.fn().mockResolvedValue({ done: false, pending: 3 }),
    });

    await expect(startOver(logbook)).resolves.toEqual({
      ok: false,
      message: startOverUnpushed(),
    });
    expect(startOverUnpushed()).not.toBe(unpushedChanges());
  });

  it('tells a refusal apart from an erase that rejected', async () => {
    const { logbook } = wiredLogbook({
      startOver: jest.fn().mockRejectedValue(new Error('database is locked')),
    });

    await expect(startOver(logbook)).resolves.toEqual({ ok: false, message: startOverFailed() });
    expect(startOverFailed()).not.toBe(startOverUnpushed());
  });

  it('refuses on a build whose seam is not wired', async () => {
    await expect(startOver(UNWIRED)).resolves.toEqual({
      ok: false,
      message: startOverUnavailable(),
    });
  });
});

describe('deleteAccount — §8’s App Store requirement (M3j)', () => {
  /**
   * ── **No account has ever been deleted from this repository.** ────────────────────────────
   *
   * There are no credentials for the owner's project here, none were sought, and his own
   * logbook is on it. Everything below drives a `rpc` spy; `cloud/localLogbook.test.ts` drives
   * `src/testing/fakeSyncServer.ts`, which models the foreign-key policy the migration
   * describes. Neither is Postgres, and the migration itself names the one statement nobody
   * here can verify — whether the role that runs it may delete from `auth.users` at all.
   */

  /**
   * **The call takes no arguments, and that is a security property rather than a signature.**
   * M2c: "it takes NO ARGUMENTS AT ALL, so there is no parameter through which another diver's
   * account could be named. The account it deletes is `auth.uid()` and can be nothing else."
   * Asserted on the argument list, because a caller passing an object the server ignores is how
   * a future one comes to pass an object it does not.
   */
  it('calls delete_account by name and hands it nothing', async () => {
    const { client, rpc } = fakeClient();
    const { logbook } = wiredLogbook();

    await deleteAccount(client, logbook);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual([DELETE_ACCOUNT_RPC]);
    expect(DELETE_ACCOUNT_RPC).toBe('delete_account');
  });

  /**
   * **The order, and it is M2e's rule rather than a preference**: a destructive action may not
   * run before the thing that makes it safe. If the deletion does not happen, nothing about the
   * device may change — and the call is the step that fails for ordinary reasons, where the
   * local delete is not.
   */
  it('deletes the account, then the device, then the session', async () => {
    const order: string[] = [];
    const { client, auth, rpc } = fakeClient();
    rpc.mockImplementation(async () => {
      order.push('rpc');
      return { data: { deleted: true, dive_sites_kept: 0, dive_centers_kept: 0 }, error: null };
    });
    auth.signOut.mockImplementation(async () => {
      order.push('signOut');
      return { error: null };
    });
    const { logbook } = wiredLogbook({
      erase: jest.fn().mockImplementation(async () => {
        order.push('erase');
      }),
    });

    await deleteAccount(client, logbook);

    expect(order).toEqual(['rpc', 'erase', 'signOut']);
  });

  /**
   * **The push-first gate is deliberately absent here, and this is what says so.**
   * `localLogbook.erase` carries the argument; the short of it is that the gate keeps the
   * promise that the logbook comes back on the next sign-in, and there is no next sign-in — so
   * `wipe` would push a whole logbook to a server that has already destroyed it, then refuse the
   * erase because the push failed, and leave the logbook on the phone.
   */
  it('erases without the gate, and never through the gated wipe', async () => {
    const { client } = fakeClient();
    const { logbook, erase, wipe } = wiredLogbook();

    await deleteAccount(client, logbook);

    expect(erase).toHaveBeenCalledTimes(1);
    expect(wipe).not.toHaveBeenCalled();
  });

  /**
   * §5, and `delete_account` computes these counts before the delete for exactly this: "so the
   * app can tell a departing diver what it is leaving behind".
   */
  it('reports what the account left behind in the community catalogue', async () => {
    const { client, rpc } = fakeClient();
    rpc.mockResolvedValue({
      data: { deleted: true, dive_sites_kept: 3, dive_centers_kept: 1 },
      error: null,
    });
    const { logbook } = wiredLogbook();

    await expect(deleteAccount(client, logbook)).resolves.toEqual({
      kind: 'deleted',
      sitesKept: 3,
      centresKept: 1,
    });
  });

  /** A server answering in a shape this build does not know still deleted an account. The
   * counts are the part that may go missing, never the outcome. */
  it('still reports the deletion when the counts are unreadable', async () => {
    const { client, rpc } = fakeClient();
    const { logbook } = wiredLogbook();

    for (const data of [null, 'true', { deleted: true }, { dive_sites_kept: 'lots' }, { dive_sites_kept: -2 }]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(deleteAccount(client, logbook)).resolves.toEqual({
        kind: 'deleted',
        sitesKept: 0,
        centresKept: 0,
      });
    }
  });

  /**
   * **The offline case, and nothing at all may have happened.** A diver on a boat presses
   * *Delete account*; the call never lands. The device must be untouched and the session must
   * survive — a wipe here would destroy a logbook for an act that did not occur.
   */
  it('touches neither the device nor the session when the call is refused', async () => {
    const { client, auth, rpc } = fakeClient();
    rpc.mockResolvedValue({ data: null, error: { message: 'fetch failed', code: '08006' } });
    const { logbook, erase } = wiredLogbook();

    await expect(deleteAccount(client, logbook)).resolves.toEqual({
      kind: 'failed',
      message: deleteAccountFailed(),
    });
    expect(erase).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('reports a throw from the client the same way it reports a returned error', async () => {
    const { client, rpc } = fakeClient();
    rpc.mockRejectedValue(new Error('storage exploded'));
    const { logbook, erase } = wiredLogbook();

    await expect(deleteAccount(client, logbook)).resolves.toEqual({
      kind: 'failed',
      message: deleteAccountFailed(),
    });
    expect(erase).not.toHaveBeenCalled();
  });

  /**
   * **This module never builds a message out of what a server wrote**, and the RPC is a new way
   * for one to arrive. The same check `messageFor` gets, with a password planted in the error:
   * a `.rpc()` failure can echo whatever was in the request, and §9 wires Sentry in M3.
   */
  it('never puts the server’s own words in front of a diver', async () => {
    const { client, rpc } = fakeClient();
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'failed for user with password correct-horse-battery-staple', code: 'P0001' },
    });
    const { logbook } = wiredLogbook();

    const outcome = await deleteAccount(client, logbook);

    expect(outcome).toEqual({ kind: 'failed', message: deleteAccountFailed() });
    expect(JSON.stringify(outcome)).not.toContain('correct-horse-battery-staple');
  });

  /**
   * **The one unrepairable state gets its own sentence.** The account is gone and this device
   * still holds a copy, and no amount of trying again brings back an account to re-sync it
   * against — so the message names the only remedy left, which is the diver's.
   */
  it('says so when the account went and the device could not be cleared', async () => {
    const { client, auth } = fakeClient();
    const { logbook } = wiredLogbook({
      erase: jest.fn().mockRejectedValue(new Error('database is locked')),
    });

    await expect(deleteAccount(client, logbook)).resolves.toEqual({
      kind: 'failed',
      message: accountDeletedDeviceKept(),
    });
    // The session still goes: leaving one in place adds a device that goes on trying to sync
    // to a logbook nobody can reach.
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(accountDeletedDeviceKept()).not.toBe(deleteAccountFailed());
  });

  /**
   * **Refused before the account is touched**, which is the same ordering rule the whole
   * function is built on: a build that cannot clear the phone must not be able to delete the
   * account it would then be holding a logbook for.
   */
  it('does not call the RPC at all on a build whose seam is not wired', async () => {
    const { client, rpc } = fakeClient();

    await expect(deleteAccount(client, UNWIRED)).resolves.toEqual({
      kind: 'failed',
      message: deleteAccountUnavailable(),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  /** `scope: 'local'`, and a sign-out that fails afterwards does not turn a deletion that
   * happened into one that did not — the token authenticates an account that no longer
   * exists, so there is nothing for a sentence about it to be about. */
  it('ends the session locally, and a failure to do so is not reported', async () => {
    const { client, auth } = fakeClient();
    auth.signOut.mockRejectedValue(new Error('keychain refused'));
    const { logbook } = wiredLogbook();

    await expect(deleteAccount(client, logbook)).resolves.toEqual({
      kind: 'deleted',
      sitesKept: 0,
      centresKept: 0,
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

/**
 * The state of the seam this build actually ships with, asserted rather than assumed — every
 * behaviour above is a claim about the app only while this holds.
 *
 * M2e wrote this test the other way round (`wired` was `false`, and the test said out loud that
 * it was "meant to be deleted by whoever wires it"). M2g wired it, so the assertion turns over
 * rather than going away: `endSession`'s `signOutUnavailable` arm is now unreachable through
 * the app, and if this ever flipped back, that is the sentence a diver would meet at the one
 * control §7.4 calls destructive.
 */
describe('the shipped local-logbook seam', () => {
  it('is wired, so the app in this tree really erases on sign-out', () => {
    expect(localLogbook.wired).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
// Czech (M3h)
// ---------------------------------------------------------------------------------------

/**
 * **Asserted as words rather than against the functions themselves**, and the difference is the
 * whole value of it: every other test in this file compares `messageFor(...)` with the same
 * function it dispatches to, which pins the DISPATCH and can never fail over what a sentence
 * says. These two are the wording, in the language that has to be looked up for it.
 */
describe('in Czech', () => {
  afterEach(() => {
    setActiveLanguage('en');
  });

  it('says what it refuses in Czech, one sentence per cause', () => {
    setActiveLanguage('cs');
    expect(credentialRefusal({ email: '', password: 'x' })?.message).toBe(
      'Zadejte svoji e-mailovou adresu.',
    );
    expect(messageFor({ code: 'invalid_credentials' }, 'signIn')).toBe(
      'Tento e-mail a heslo neodpovídají žádnému účtu.',
    );
    expect(messageFor({ code: 'email_not_confirmed' }, 'signIn')).toBe(
      'Tento účet zatím není potvrzený. Otevřete odkaz v e-mailu, který na tu adresu přišel, a pak se přihlaste.',
    );
    // The two "anything else" sentences stay two, because they name what did not happen.
    expect(messageFor({ code: 'unheard_of' }, 'signIn')).toBe('Přihlášení se nezdařilo. Zkuste to znovu.');
    expect(messageFor({ code: 'unheard_of' }, 'signUp')).toBe('Účet se nepodařilo vytvořit. Zkuste to znovu.');
  });
});

import {
  AuthApiError,
  AuthRetryableFetchError,
  type SupabaseClient,
} from '@supabase/supabase-js';

import {
  authenticate,
  credentialRefusal,
  CONFIRMATION_REDIRECT,
  CONFIRMATION_REQUIRED,
  CREDENTIALS_REJECTED,
  EMAIL_MALFORMED,
  EMAIL_REQUIRED,
  EMAIL_TAKEN,
  endSession,
  messageFor,
  PASSWORD_REQUIRED,
  PASSWORD_TOO_WEAK,
  SERVER_UNREACHABLE,
  SIGN_IN_FAILED,
  SIGN_OUT_FAILED,
  SIGN_OUT_UNAVAILABLE,
  SIGN_UP_FAILED,
  SIGNUP_DISABLED,
  TOO_MANY_TRIES,
  UNPUSHED_CHANGES,
  WIPE_FAILED,
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

/** A client with the three calls this module makes and nothing else. Cast at this one
 * boundary so no test below has to. */
function fakeClient(): { client: SupabaseClient; auth: FakeAuth } {
  const auth: FakeAuth = {
    signInWithPassword: jest.fn().mockResolvedValue({ data: { session: SESSION, user: USER }, error: null }),
    signUp: jest.fn().mockResolvedValue({ data: { session: null, user: USER }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
  };
  return { client: { auth } as unknown as SupabaseClient, auth };
}

/** A wired seam whose two ports are spies, so the order and the fact of each call can be
 * asserted rather than inferred from a result. */
function wiredLogbook(over: { adopt?: jest.Mock; wipe?: jest.Mock } = {}) {
  const adopt = over.adopt ?? jest.fn().mockResolvedValue(0);
  const wipe = over.wipe ?? jest.fn().mockResolvedValue({ done: true });
  const logbook: LocalLogbook = { wired: true, adopt, wipe };
  return { logbook, adopt, wipe };
}

const UNWIRED: LocalLogbook = { wired: false };

describe('credentialRefusal', () => {
  it('asks for the email before anything is sent', () => {
    expect(credentialRefusal({ email: '', password: 'hunter2' })).toEqual({
      // The row, not just the sentence: "Enter your email address." shipped under *Password*
      // until this screen was put on a phone and read.
      field: 'email',
      message: EMAIL_REQUIRED,
    });
  });

  /** A soft keyboard supplies these on its own, and an address of spaces is not an address. */
  it('treats a whitespace-only email as no email at all', () => {
    expect(credentialRefusal({ email: '   ', password: 'hunter2' })).toEqual({
      field: 'email',
      message: EMAIL_REQUIRED,
    });
  });

  it('asks for the password once there is an email', () => {
    expect(credentialRefusal({ email: 'ales@example.com', password: '' })).toEqual({
      field: 'password',
      message: PASSWORD_REQUIRED,
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
    ['invalid_credentials', CREDENTIALS_REJECTED],
    ['user_already_exists', EMAIL_TAKEN],
    ['email_exists', EMAIL_TAKEN],
    ['weak_password', PASSWORD_TOO_WEAK],
    ['email_address_invalid', EMAIL_MALFORMED],
    ['validation_failed', EMAIL_MALFORMED],
    ['signup_disabled', SIGNUP_DISABLED],
    ['over_request_rate_limit', TOO_MANY_TRIES],
    ['over_email_send_rate_limit', TOO_MANY_TRIES],
    ['email_not_confirmed', CONFIRMATION_REQUIRED],
  ])('answers %s with its own sentence', (code, expected) => {
    expect(messageFor(new AuthApiError('server text', 400, code), 'signIn')).toBe(expected);
  });

  /**
   * The one error a diver will misdiagnose. With confirmation switched on (owner's call, M2e)
   * an unconfirmed account answers a *correct* password with `email_not_confirmed`, and every
   * other thing on screen is a password field — so if this ever collapsed into
   * `CREDENTIALS_REJECTED` a diver would retype a working password until they gave up.
   */
  it('never tells an unconfirmed account that its password is wrong', () => {
    const unconfirmed = messageFor(new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'), 'signIn');
    expect(unconfirmed).not.toBe(CREDENTIALS_REJECTED);
    expect(unconfirmed).toBe(CONFIRMATION_REQUIRED);
  });

  it('names the network when the request never completed', () => {
    expect(messageFor(new AuthRetryableFetchError('Failed to fetch', 0), 'signIn')).toBe(SERVER_UNREACHABLE);
    expect(messageFor(new AuthRetryableFetchError('Failed to fetch', 0), 'signUp')).toBe(SERVER_UNREACHABLE);
  });

  it('falls back to the sentence for the act that failed, not to one sentence for both', () => {
    const unknown = new AuthApiError('teapot', 418, 'a_code_from_a_newer_server');
    expect(messageFor(unknown, 'signIn')).toBe(SIGN_IN_FAILED);
    expect(messageFor(unknown, 'signUp')).toBe(SIGN_UP_FAILED);
  });

  it('says something for a thrown value that is not an error at all', () => {
    expect(messageFor('plain string', 'signIn')).toBe(SIGN_IN_FAILED);
    expect(messageFor(null, 'signUp')).toBe(SIGN_UP_FAILED);
    expect(messageFor(undefined, 'signIn')).toBe(SIGN_IN_FAILED);
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

    expect(outcome).toEqual({ kind: 'failed', message: CREDENTIALS_REJECTED });
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
    expect(outcome).toEqual({ kind: 'failed', message: EMAIL_REQUIRED, field: 'email' });
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
      message: SIGN_IN_FAILED,
    });
  });

  it('reports a sign-up that came back with neither user nor session', async () => {
    const { client, auth } = fakeClient();
    auth.signUp.mockResolvedValue({ data: { session: null, user: null }, error: null });

    await expect(authenticate(client, 'signUp', { email: 'a@b.c', password: 'p' }, UNWIRED)).resolves.toEqual({
      kind: 'failed',
      message: SIGN_UP_FAILED,
    });
  });

  it('turns a throw from underneath the client into a sentence instead of an exception', async () => {
    const { client, auth } = fakeClient();
    auth.signInWithPassword.mockRejectedValue(new AuthRetryableFetchError('Network request failed', 0));

    await expect(authenticate(client, 'signIn', { email: 'a@b.c', password: 'p' }, UNWIRED)).resolves.toEqual({
      kind: 'failed',
      message: SERVER_UNREACHABLE,
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
   * reason `SIGN_OUT_UNAVAILABLE` is: the assertion that matters is the second one, and signing
   * out without wiping would leave the device holding a logbook that the confirmation dialog
   * had just promised to remove.
   */
  it('refuses to sign out at all when the device cannot be wiped yet', async () => {
    const { client, auth } = fakeClient();

    await expect(endSession(client, UNWIRED)).resolves.toEqual({
      ok: false,
      message: SIGN_OUT_UNAVAILABLE,
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('leaves the session alone when the wipe itself rejects', async () => {
    const { client, auth } = fakeClient();
    const { logbook } = wiredLogbook({ wipe: jest.fn().mockRejectedValue(new Error('database is locked')) });

    await expect(endSession(client, logbook)).resolves.toEqual({ ok: false, message: WIPE_FAILED });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('says both halves when the logbook went and the session did not', async () => {
    const { client, auth } = fakeClient();
    auth.signOut.mockResolvedValue({ error: new AuthApiError('nope', 500, 'unexpected_failure') });
    const { logbook, wipe } = wiredLogbook();

    await expect(endSession(client, logbook)).resolves.toEqual({ ok: false, message: SIGN_OUT_FAILED });
    expect(wipe).toHaveBeenCalledTimes(1);
  });

  it('reports a throw from the client the same way it reports a returned error', async () => {
    const { client, auth } = fakeClient();
    auth.signOut.mockRejectedValue(new Error('storage exploded'));
    const { logbook } = wiredLogbook();

    await expect(endSession(client, logbook)).resolves.toEqual({ ok: false, message: SIGN_OUT_FAILED });
  });

  /**
   * §7.4's wipe refusing because this phone is still holding rows the account has not received
   * (`cloud/localLogbook.ts`). **It is not a failure**, and the two things it must not do are
   * both here: it must not end the session, and it must not be reported with `WIPE_FAILED`,
   * whose sentence says the erase was attempted and could not be done.
   */
  it('keeps the session and says why when the device still owes the server', async () => {
    const { client, auth } = fakeClient();
    const { logbook } = wiredLogbook({ wipe: jest.fn().mockResolvedValue({ done: false, pending: 3 }) });

    await expect(endSession(client, logbook)).resolves.toEqual({
      ok: false,
      message: UNPUSHED_CHANGES,
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  /** The two refusals are different sentences, because they ask the diver for different things:
   * one is "connect and try again", the other is "this did not work". A single message for both
   * would tell a diver at sea that their phone is broken. */
  it('tells a refusal apart from a failed erase', async () => {
    expect(UNPUSHED_CHANGES).not.toBe(WIPE_FAILED);
    expect(UNPUSHED_CHANGES).not.toBe(SIGN_OUT_FAILED);
    expect(UNPUSHED_CHANGES).not.toBe(SIGN_OUT_UNAVAILABLE);
  });
});

/**
 * The state of the seam this build actually ships with, asserted rather than assumed — every
 * behaviour above is a claim about the app only while this holds.
 *
 * M2e wrote this test the other way round (`wired` was `false`, and the test said out loud that
 * it was "meant to be deleted by whoever wires it"). M2g wired it, so the assertion turns over
 * rather than going away: `endSession`'s `SIGN_OUT_UNAVAILABLE` arm is now unreachable through
 * the app, and if this ever flipped back, that is the sentence a diver would meet at the one
 * control §7.4 calls destructive.
 */
describe('the shipped local-logbook seam', () => {
  it('is wired, so the app in this tree really erases on sign-out', () => {
    expect(localLogbook.wired).toBe(true);
  });
});

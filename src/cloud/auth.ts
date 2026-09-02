import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';

import { type LocalLogbook, type WipeOutcome } from './localLogbook';

/**
 * **Signing in, signing up and signing out — the three acts, and every sentence a diver reads
 * about them.**
 *
 * DESIGN.md §5 fixes the method: "email and password first", chosen by the owner in M2 after a
 * one-time code and a magic link were each ruled out by the free tier. §7.4 fixes what
 * signing in and signing out do to the device. This module is those rules as functions, with
 * no React in it, so both halves can be tested without a screen.
 *
 * ## The password is the one secret this app handles
 *
 * It reaches exactly two places: the field the diver types it into, and the argument of the
 * Supabase call below. Nothing here logs, stores, wraps or re-throws it, and — the rule with
 * teeth — **no message this module returns is ever built from a server's own error text**.
 * Every sentence is one of the constants below, chosen by error *code*.
 *
 * That is not squeamishness about wording, though the wording matters too (§0.6: a field
 * error is text, and "Invalid login credentials" is not a sentence a diver should read). It is
 * what stops a secret travelling. A validation error can echo the input that produced it, and
 * `messageFor` returning `error.message` would put that echo on screen, into whatever a
 * screenshot catches, and — once §9 wires Sentry in M3 — into a breadcrumb on somebody else's
 * server. Returning from a fixed set makes that impossible rather than unlikely, and
 * `auth.test.ts` asserts it with a password planted inside the error.
 *
 * The same rule is why nothing here calls `console`: Sentry's React Native SDK turns console
 * output into breadcrumbs by default, so a `console.warn(error)` on a failed sign-in is a
 * password-shaped string in a crash report. The decision is made here, before Sentry exists,
 * because after it exists the leak is invisible from this file.
 */

/**
 * Which of the two things this screen does. §5 puts both on one screen; the mode is what the
 * heading, the action's label and the call below are three views of, so it is one value and
 * not three booleans.
 */
export type AuthMode = 'signIn' | 'signUp';

/** What the diver typed, as typed. Normalised inside `authenticate`, never by the caller. */
export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/** Which of the two rows a message belongs under. */
export type CredentialField = 'email' | 'password';

/**
 * A refusal this app made itself, and **the row it is about**.
 *
 * The field travels with the message because §0.6 puts a field error "under the row it belongs
 * to", and only the refusals made here can name a row: the server answers a wrong password and
 * an unknown address with one `invalid_credentials` on purpose, so anything coming back from it
 * is about the pair and lands under the second row of it. Found by looking at the screen —
 * "Enter your email address." rendered under *Password*, which is a sentence pointing two rows
 * up.
 */
export interface CredentialRefusal {
  readonly field: CredentialField;
  readonly message: string;
}

/**
 * How an attempt ended — **three states, not two**, because the owner switched email
 * confirmation **on** (M2e) and a successful sign-up is now not a sign-in.
 *
 * That is the whole reason this is a discriminated union rather than an `ok` boolean. With
 * confirmation on, `signUp` returns a user and **no session**: the account exists, nobody is
 * signed in, and nothing has been adopted because nothing has been pushed. A shape with one
 * success arm would have made that state either a lie (`adopted: 0` beside a screen saying
 * "signed in") or an error (a red note under a form after something that worked). It is
 * neither, so it is its own arm and every caller has to render it.
 *
 * `adopted` is §7.4's count: how many dives this phone handed to the account it just signed
 * into. `0` covers all three ordinary ways there is nothing to announce — a fresh phone, an
 * adoption that failed, and a build whose local-logbook seam is not wired yet (see
 * `localLogbook.ts`) — because the app says nothing in all three, and a caller that had to
 * tell them apart to stay silent would be inventing a distinction with no reader.
 *
 * `email` on the confirmation arm is the **normalised** address the mail actually went to,
 * not the raw text the diver typed. Showing it back is the point: a typo at registration is
 * exactly what confirmation catches, and it is caught only if the diver can see the address.
 */
export type AuthOutcome =
  | { readonly kind: 'signedIn'; readonly adopted: number }
  | { readonly kind: 'confirmationSent'; readonly email: string }
  | {
      readonly kind: 'failed';
      readonly message: string;
      /**
       * Set only when this app itself decided which row was wrong — see `CredentialRefusal`.
       * **Absent is a real answer**, not an omission: a server that will not say whether the
       * address or the password was wrong is a server this app must not appear to have heard
       * an answer from.
       */
      readonly field?: CredentialField;
    };

/** How signing out ended. No count: sign-out has nothing to report but its own success. */
export type SignOutOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/*
 * ── What the diver reads ──────────────────────────────────────────────────────────────────
 *
 * Every one of these is a whole sentence in the app's own register, and every one of them is
 * reachable — a message with no code pointing at it would be a claim the app cannot make.
 * They are exported so the screen's test can assert on the same strings the diver sees rather
 * than on a substring somebody retyped.
 */

/** Nothing was typed in the email row. Refused here rather than at the server: the answer is
 * certain, and a round trip to be told so is a round trip a diver on a boat may not have. */
export const EMAIL_REQUIRED = 'Enter your email address.';
/** Nothing was typed in the password row. */
export const PASSWORD_REQUIRED = 'Enter your password.';
/**
 * The wrong password, or an email with no account behind it.
 *
 * **It names the pair and not either half, because the server refuses to say which.** Supabase
 * answers both cases with one `invalid_credentials`, deliberately: an error that distinguished
 * them would let anyone test whether a given address has a Ponor account. Saying "no account
 * with that email" here would be this app inventing an answer the server withheld, and
 * inventing it wrongly half the time.
 */
export const CREDENTIALS_REJECTED = 'That email and password don’t match an account.';
/** Sign-up against an address that already has an account. */
export const EMAIL_TAKEN = 'That email already has an account — sign in instead.';
/**
 * The server's password policy said no.
 *
 * **Deliberately quotes no number.** The minimum is a Supabase project setting, so a sentence
 * saying "at least six characters" would be this app keeping a second copy of a rule it does
 * not own (§4.1) — and the copy would be wrong the day the owner changes the setting, with
 * nothing to notice.
 */
export const PASSWORD_TOO_WEAK = 'That password is too weak — try a longer one.';
/** The address is not an address. */
export const EMAIL_MALFORMED = 'That doesn’t look like an email address.';
/** Sign-ups are switched off for the project. */
export const SIGNUP_DISABLED = 'New accounts are switched off right now.';
/** The server is rate-limiting this address or this device. */
export const TOO_MANY_TRIES = 'Too many tries. Wait a minute and try again.';
/**
 * **Signing in to an account whose address has not been confirmed yet — the one error here a
 * diver will misdiagnose, so it gets its own sentence.**
 *
 * The owner switched email confirmation **on** (M2e), so this is now an ordinary state rather
 * than a misconfiguration: sign up, do not open the link, try to sign in. Supabase answers
 * `email_not_confirmed`, whose own text is a variant of "Email not confirmed" — and everything
 * around it on screen is a password field. Left on `CREDENTIALS_REJECTED` a diver would retype
 * a correct password four times and conclude the app is broken, which is the exact failure the
 * project's own §0.6 rule about error text exists to prevent.
 *
 * So it names a cause that is not the password and says what to do about it. It does **not**
 * say "your password is right", though it almost certainly is: whether the credential check
 * runs before or after the confirmation check is the server's business, and an app asserting
 * something it cannot see is how this project's spec has drifted before.
 */
export const CONFIRMATION_REQUIRED =
  'This account isn’t confirmed yet. Open the link in the email sent to that address, then sign in.';
/**
 * The network. §1: "the whole app runs offline from on-device SQLite" — so this says the thing
 * a diver actually needs to know, which is that nothing is lost, rather than reporting a
 * failure as if something were at stake.
 */
export const SERVER_UNREACHABLE =
  'Couldn’t reach the server. Your logbook is safe on this phone — try again when you’re online.';
/** Anything else, per mode. Two sentences rather than one, because they name what did not
 * happen and those are different things. */
export const SIGN_IN_FAILED = 'Couldn’t sign in. Try again.';
export const SIGN_UP_FAILED = 'Couldn’t create the account. Try again.';

/**
 * The build cannot erase the local logbook yet, so it did not sign out (`localLogbook.ts`).
 *
 * Signing out without wiping is the one thing this must not do: §7.4 makes the erase the
 * *content* of sign-out, and the diver has just read a dialog saying their logbook will be
 * removed from this device. A control that refuses out loud can be fixed; a dialog that lies
 * about what happened cannot.
 */
export const SIGN_OUT_UNAVAILABLE = 'Sign-out can’t clear this device yet, so nothing was signed out.';
/** The erase itself rejected. Same refusal, without the "yet". */
export const WIPE_FAILED = 'Couldn’t clear this device’s logbook, so nothing was signed out.';
/**
 * **This phone is holding something the account has not received, so it was not erased.**
 *
 * §7.4 makes sign-out "the one destructive action in v1", and the dialog in front of it
 * promises the logbook stays in the account and comes back on the next sign-in. That promise
 * is true of a row that has been pushed and false of one that has not — so the wipe pushes
 * first and refuses when anything is still flagged (`cloud/localLogbook.ts`). This is the
 * refusal, and it is the ordinary answer for a diver signing out at sea rather than a
 * malfunction, which is why it says what to do rather than what went wrong.
 *
 * It quotes no number. §0.6 wants error text that names an action, and "3 changes" invites a
 * diver to go looking for three things no screen can point at.
 */
export const UNPUSHED_CHANGES =
  'This phone has dives your account hasn’t received yet. Connect and try again — nothing was cleared, and you’re still signed in.';
/** The logbook went and the session did not. Says both halves, because the diver is now
 * looking at an empty logbook and is owed the reason. */
export const SIGN_OUT_FAILED = 'This device’s logbook was cleared, but signing out didn’t finish. Try again.';

/**
 * What must be typed before anything is sent, or `null` when the pair is worth a call.
 *
 * **Two rules and no more.** It does not check the shape of the address — `email_address_invalid`
 * below is the server's answer to that, and a regular expression here would be a second,
 * worse copy of a rule somebody else owns (§4.1), differing from it exactly at the addresses
 * people argue about. It does not check the password's length either, for the reason
 * `PASSWORD_TOO_WEAK` records.
 *
 * One refusal at a time, and it **names its own row** (§0.6: "a field error is text... under
 * the row it belongs to"). The email is asked for first because it is the first row: a diver
 * with both empty is told about the one their eye is already on, and the second is asked the
 * moment the first is answered.
 */
export function credentialRefusal({ email, password }: Credentials): CredentialRefusal | null {
  if (email.trim() === '') return { field: 'email', message: EMAIL_REQUIRED };
  if (password === '') return { field: 'password', message: PASSWORD_REQUIRED };
  return null;
}

/** The `code` on an `AuthError`, if this is one at all. Structural rather than
 * `isAuthApiError`, so a `CustomAuthError` — which carries a code and is not an API error —
 * is read the same way, and so a plain thrown value simply has no code. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The one sentence for a failed attempt, chosen by the server's error **code** and never
 * built from its text.
 *
 * See this module's docblock for why the second half of that is the load-bearing one. The
 * codes are `@supabase/auth-js`'s own `ErrorCode` union; unrecognised ones — including codes
 * from a server newer than the installed client, which that union's own comment warns about —
 * fall to the mode's plain sentence rather than to anything the server wrote.
 */
export function messageFor(error: unknown, mode: AuthMode): string {
  // Checked before the code, because a fetch failure has no code to switch on: `AuthRetryableFetchError`
  // is constructed client-side when the request never completed, which is the ordinary state
  // of a phone on a boat.
  if (isAuthRetryableFetchError(error)) return SERVER_UNREACHABLE;

  switch (codeOf(error)) {
    case 'invalid_credentials':
      return CREDENTIALS_REJECTED;
    case 'user_already_exists':
    case 'email_exists':
      return EMAIL_TAKEN;
    case 'weak_password':
      return PASSWORD_TOO_WEAK;
    case 'email_address_invalid':
    case 'validation_failed':
      return EMAIL_MALFORMED;
    case 'signup_disabled':
      return SIGNUP_DISABLED;
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return TOO_MANY_TRIES;
    case 'email_not_confirmed':
      return CONFIRMATION_REQUIRED;
    default:
      return mode === 'signUp' ? SIGN_UP_FAILED : SIGN_IN_FAILED;
  }
}

/**
 * §7.4's adoption, and the promise that it can never cost a diver their sign-in.
 *
 * "Local dives are always adopted, even by an account that already has dives... The app states
 * what it did afterwards rather than asking first: a prompt at sign-in is a wall in front of
 * the one flow §1 promises is optional." A wall is a wall whether it asks a question or
 * reports a failure, so every way this can go wrong — an unwired seam, a rejected write —
 * resolves to `0`, which is the app saying nothing.
 */
async function adopt(logbook: LocalLogbook): Promise<number> {
  if (!logbook.wired) return 0;
  try {
    return await logbook.adopt();
  } catch {
    return 0;
  }
}

/**
 * Signs in, or creates an account — one function, because the two differ in one call and
 * everything around them is identical, and **one function is what keeps the mode from
 * disagreeing with itself**: the same value picks the call, the message on failure and the
 * arm returned.
 *
 * **The email is trimmed and the password is not.** A soft keyboard appends a space to an
 * address as readily as it capitalises one, and an address with a trailing space matches
 * nothing; a password with a trailing space is a *different password*, and a client that
 * silently trimmed it would accept a password at sign-up and reject the same keystrokes at
 * sign-in — or the reverse, once one build trims and another does not. So one is normalised
 * and the other is passed through byte for byte.
 *
 * **Signing up does not sign anybody in** (owner's call, M2e: email confirmation is on, with a
 * `ponor://` redirect). Supabase returns a user and a null session, the diver has to open a
 * link in an email first, and `confirmationSent` is what says so — carrying the normalised
 * address, because seeing it is the only way a diver catches the typo the confirmation exists
 * to catch.
 *
 * **The session is still what decides which arm**, rather than the mode. If confirmation is
 * ever switched off again, `signUp` starts returning a session and this reports `signedIn`
 * with the local dives adopted, on the same line of code — the app follows the project
 * setting instead of hard-coding a copy of it.
 *
 * **Nothing is adopted on the confirmation path, and that is not an omission.** §7.4 adopts by
 * flagging rows for a push, and there is nobody to push to until the address is confirmed and
 * a session exists; flagging them here would leave a device full of dirty rows and no account,
 * and would put "4 dives were added to your logbook" on screen about a logbook that does not
 * exist yet.
 */
export async function authenticate(
  client: SupabaseClient,
  mode: AuthMode,
  credentials: Credentials,
  logbook: LocalLogbook,
): Promise<AuthOutcome> {
  const refusal = credentialRefusal(credentials);
  if (refusal !== null) return { kind: 'failed', message: refusal.message, field: refusal.field };

  const email = credentials.email.trim();
  const password = credentials.password;

  try {
    if (mode === 'signUp') {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) return { kind: 'failed', message: messageFor(error, mode) };
      if (data.session === null) {
        // A user with no session is confirmation waiting to happen — unless there is no user
        // either, which is a shape the client does not document and this app has no sentence
        // for. Reported as the plain failure rather than as a confirmation nobody was sent.
        if (data.user === null) return { kind: 'failed', message: SIGN_UP_FAILED };
        return { kind: 'confirmationSent', email };
      }
    } else {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) return { kind: 'failed', message: messageFor(error, mode) };
      // No error and no session is not a state the client documents either. It is reported
      // rather than trusted, because the alternative is a screen that switches to "signed in"
      // on a session that does not exist.
      if (data.session === null) return { kind: 'failed', message: SIGN_IN_FAILED };
    }
  } catch (thrown) {
    // The client answers with `{ error }` rather than throwing, so reaching here means
    // something below it did — a fetch polyfill, a storage adapter. Mapped through the same
    // function for the same reason: whatever it wrote, the diver does not read it.
    return { kind: 'failed', message: messageFor(thrown, mode) };
  }

  return { kind: 'signedIn', adopted: await adopt(logbook) };
}

/**
 * Signs out — **the wipe first, and the session only if the wipe succeeded.**
 *
 * §7.4: "Signing out wipes the local logbook... a device that keeps one person's dives after
 * they have left is the only way a second account could ever see them." That makes the order
 * a safety property rather than a preference. Wiping first means the two ways this can fail
 * are *nothing happened* and *the logbook went but the session stayed* — and neither of them
 * is a signed-out device still holding a logbook, which is the one outcome §7.4 exists to
 * prevent. The reverse order makes that outcome the ordinary result of a failed erase.
 *
 * **A refusal is a third way, and it is not a failure of anything.** The wipe pushes this
 * device's pending rows first and declines to erase what the server has not acknowledged
 * (`cloud/localLogbook.ts`); a diver signing out on a boat gets `UNPUSHED_CHANGES` and keeps
 * both their logbook and their session. It is told apart from a rejected erase by the value
 * the wipe returns rather than by the class of a thrown error, because a diver reads a
 * different sentence for each and `WIPE_FAILED` would be the wrong one — it says the erase was
 * attempted and could not be done, and here it was not attempted at all.
 *
 * **`scope: 'local'`, not the default.** Supabase signs out globally unless told otherwise,
 * which revokes every refresh token the account has — so signing out on the phone would sign
 * the diver out of the tablet as well. §7 is built on one person owning several devices
 * (whole-row last-write-wins is safe precisely "because every private row has exactly one
 * author"), so one device leaving must not evict the others.
 *
 * The failure it does *not* report is the ordinary offline one: `signOut` removes the local
 * session before returning its error whenever the server refused or could not be reached, so
 * a diver signing out at sea is signed out. That is why the screen keeps this message beside
 * the *signed-in* view — if the session did go, the view has already changed and there is
 * nothing left for the sentence to be about.
 */
export async function endSession(
  client: SupabaseClient,
  logbook: LocalLogbook,
): Promise<SignOutOutcome> {
  if (!logbook.wired) return { ok: false, message: SIGN_OUT_UNAVAILABLE };

  let wiped: WipeOutcome;
  try {
    wiped = await logbook.wipe();
  } catch {
    return { ok: false, message: WIPE_FAILED };
  }
  if (!wiped.done) return { ok: false, message: UNPUSHED_CHANGES };

  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) return { ok: false, message: SIGN_OUT_FAILED };
  } catch {
    return { ok: false, message: SIGN_OUT_FAILED };
  }

  return { ok: true };
}

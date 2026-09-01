import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { sessionStore } from './sessionStore';

/**
 * The two build-time variables that decide whether this app has a backend at all.
 *
 * Named as a type rather than left as loose strings because they are read in three places
 * that must agree — the reads at the bottom of this file, `.env.example`, and whatever later
 * reports which one a build forgot — and a misspelling in any of them is invisible until a
 * store build silently has no cloud.
 */
export type CloudEnvVar = 'EXPO_PUBLIC_SUPABASE_URL' | 'EXPO_PUBLIC_SUPABASE_ANON_KEY';

/** What the environment amounts to, before anything has tried to connect with it. */
export type CloudCredentials =
  | { readonly configured: true; readonly url: string; readonly anonKey: string }
  | { readonly configured: false; readonly missing: readonly CloudEnvVar[] };

/**
 * Whether this build has a backend, and the one client if it does.
 *
 * **The shape is a discriminated union and not `SupabaseClient | null`, on purpose.** A
 * nullable client is a null-pointer with a deadline: every call site is one forgotten `?.`
 * away from `Cannot read property 'auth' of null`, and — worse here — the forgetting compiles
 * fine on the owner's machine, where the variables *are* set, and crashes only where they are
 * not. A union forces the question to be asked before the client can be reached:
 * `cloud.client` does not exist as a property until `cloud.configured` has been narrowed to
 * `true`, so "is there a backend" stops being a convention and becomes something the compiler
 * refuses to let a caller skip.
 *
 * Rejected: the **throwing proxy** `db/client.web.ts` uses for its not-yet-open database.
 * That shape is right there and wrong here, and the difference is worth stating because the
 * two look alike. The browser's database is *arriving* — the proxy stands in for about twelve
 * milliseconds, and anything that touches it early is a bug in this app's own start-up order,
 * so throwing is the correct report. A missing backend is not arriving. It is the ordinary,
 * indefinite, **specified** state of this app: §1 says the whole thing runs offline from
 * on-device SQLite and "an account is only needed to back up, sync a second device, and
 * contribute named sites", and M1 shipped and met its done-when with no backend in existence.
 * Turning that supported state into an exception at the deepest point of a call stack is
 * exactly the crash this module is written to prevent.
 *
 * The unconfigured branch carries two facts rather than one, because there are two ways to
 * have no backend and a later diagnostic wants to tell them apart. `missing` names the
 * variables this build did not supply. `cause` is set instead when both *were* supplied and
 * `createClient` refused them — see `connectCloud` for why that is caught rather than thrown.
 * Neither is printed anywhere by this module; see the rule below.
 */
export type Cloud =
  | { readonly configured: true; readonly client: SupabaseClient }
  | { readonly configured: false; readonly missing: readonly CloudEnvVar[]; readonly cause?: Error };

/** Blank, whitespace-only and absent are one answer: no value. Returns the usable form. */
function value(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * The pure half: what a given environment says, with no client built and nothing imported
 * that could have a side effect. Extracted so both branches are testable without env
 * gymnastics — the same split `useDives.ts` makes for `composeDives`.
 *
 * **An empty string is a missing value, not a supplied one.** `EXPO_PUBLIC_SUPABASE_URL=`
 * with nothing after it is an ordinary thing to have in a half-filled `.env`, and it reaches
 * this function as `''`. Passing that straight through would hand `createClient('')` a value
 * it rejects — verified against 2.112.4, which throws `supabaseUrl is required.` — so without
 * this, a half-filled `.env` and no `.env` at all would take two different paths to the same
 * conclusion, one of them through an exception. Whitespace is trimmed for the same reason and
 * one more: it makes `missing` name the variable the owner actually has to fix, instead of
 * reporting a `cause` from a library that was handed a blank.
 */
export function readCloudCredentials(
  env: Readonly<Partial<Record<CloudEnvVar, string>>>,
): CloudCredentials {
  const url = value(env.EXPO_PUBLIC_SUPABASE_URL);
  const anonKey = value(env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

  const missing: CloudEnvVar[] = [];
  if (url === null) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (anonKey === null) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (url === null || anonKey === null) return { configured: false, missing };

  return { configured: true, url, anonKey };
}

/**
 * Builds the client, or reports that there is none. Exported for the tests that have to see
 * both branches; the app reads `cloud` below and never calls this itself.
 *
 * **When there are no credentials this function does nothing at all.** It does not call
 * `createClient`, it does not touch `sessionStore`, it does not log, and it does not wait —
 * it returns a value. That sentence is this module's whole contract, so it is worth being
 * concrete about what it rules out: no keychain read on launch, no auth-refresh timer, no
 * `visibilitychange` listener, no console line on every start telling a diver who never asked
 * for an account about a variable they have never heard of. `supabase.test.ts` asserts each
 * of those, because a later caller that "just moves the client up a line to keep it simple"
 * would break all of them at once and nothing on any screen would look different.
 *
 * **A refusal from `createClient` is caught and degraded, not allowed to escape.** This looks
 * like swallowing an error and is the opposite. `createClient` validates synchronously and
 * throws — measured against 2.112.4: `supabaseUrl is required.`, `supabaseKey is required.`,
 * `Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.` Since the client is built at
 * module scope (see below), an escaping throw is not an error report, it is a **white screen
 * on launch**: the first import of this module anywhere in the graph takes the whole app
 * down, offline logbook and all, over a typo in a variable that §1 says the app does not need
 * in the first place. A mistyped URL must cost the diver the *cloud*, which they may not be
 * using, and nothing else. §10's rule that a local save failure is shown and a sync failure is
 * not comes down on the same side.
 *
 * What that costs is a typo the owner cannot see, so it is not swallowed either: the error
 * travels on `Cloud.cause`. **This module owns the fact and not the telling** (§4.1) — it has
 * no screen, no locale and no idea whether anyone is looking, and a `console.warn` here fires
 * on every launch of every build forever, which is the noise this file exists to avoid. The
 * sign-in surface M2 builds is what reads `cause` and says so, once, to someone who asked.
 */
export function connectCloud(credentials: CloudCredentials): Cloud {
  if (!credentials.configured) return { configured: false, missing: credentials.missing };

  try {
    return {
      configured: true,
      client: createClient(credentials.url, credentials.anonKey, {
        auth: {
          // DESIGN.md §4: the session goes in the keychain, not AsyncStorage. On web this is
          // the browser's own store and emphatically not a keychain — sessionStore.web.ts.
          storage: sessionStore,
          persistSession: true,
          autoRefreshToken: true,
          // Off because nothing in this build produces a redirect for it to read. Left at its
          // default (`true`) the auth client parses `window.location` on construction looking
          // for a token fragment, which on web means this module starts inspecting the URL of
          // a page that has never had an OAuth callback in it. Whoever wires §5's three
          // sign-in methods turns it on for the platform that needs it, having decided what a
          // callback URL is here; until then the honest value is the one that does nothing.
          detectSessionInUrl: false,
        },
      }),
    };
  } catch (cause) {
    return {
      configured: false,
      missing: [],
      cause: cause instanceof Error ? cause : new Error(String(cause)),
    };
  }
}

/**
 * **The app's one Supabase client, or the fact that there isn't one.**
 *
 * ## The rule this module exists for
 *
 * **With `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` absent, importing
 * this module changes nothing about the app.** It throws nothing, logs nothing, starts no
 * timer, opens no keychain, reaches no network, and delays no launch — it evaluates two
 * string reads and a comparison. Every screen behaves exactly as it did before this file
 * existed, and the test suite proves it by staying green with no credentials anywhere near
 * it. That is not a nicety for the days before the Supabase project exists. It is DESIGN.md
 * §1 — the whole app runs offline from on-device SQLite, and an account is only needed to
 * back up, sync a second device and contribute named sites — and it stays true for every
 * diver who never signs in, forever.
 *
 * The way this rule dies is not by being argued with. It dies when a later caller finds it
 * convenient to `await cloud.client.auth.getSession()` somewhere that runs on launch, or to
 * "warn if the cloud isn't set up", and the suite stays green because the machine running it
 * has credentials. If you are editing this file, that is the defect to keep in view.
 *
 * ## Why a module-scope constant
 *
 * Because the alternative is worse in a specific way. A lazy `getCloud()` needs memoisation,
 * and memoisation that is wrong builds a **second** `GoTrueClient` against the same storage
 * key — Supabase warns about exactly this, and two auth clients racing to refresh one
 * refresh token is a signed-out diver, not a slow one. A `const` is the memo, with no
 * machinery to get wrong and no second instance reachable. It costs nothing when unconfigured
 * (see above), and when configured it does what the sign-in surface would have had to do
 * anyway, a little earlier: `createClient` is synchronous, and the session restore it kicks
 * off is not awaited by anything here.
 *
 * ## Why the two reads are spelled out literally
 *
 * `process.env.EXPO_PUBLIC_SUPABASE_URL` is written as a member expression, twice, rather
 * than the environment being passed to `readCloudCredentials` as `process.env`. That is
 * load-bearing and it is invisible in a dev build.
 *
 * `babel-preset-expo`'s `expo-inline-or-reference-env-vars` plugin walks member expressions
 * and rewrites only what it can see. In development it points `process.env.EXPO_PUBLIC_*` at
 * `expo/virtual/env`, which *is* `process.env`, so anything works. In a **production** build
 * it replaces each one with the value as a **literal**, at build time. A bare `process.env`
 * is not a member expression it recognises and is left exactly as written — and a shipped
 * React Native bundle has no `.env` file and no dotenv, so the only `process.env` keys that
 * exist on the device are the handful Metro defines itself (`NODE_ENV` and friends). Neither
 * of these two is among them. So the object-passing version reads two `undefined`s, reports
 * itself unconfigured, and ships a store binary with no backend in it — from a machine where
 * every test and every dev build said the opposite.
 *
 * `supabase.test.ts` runs this file through the repo's own Babel config in production mode
 * and asserts the values are inlined, because that is the only place the difference shows.
 */
export const cloud: Cloud = connectCloud(
  readCloudCredentials({
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  }),
);

import { transformSync, type TransformCaller } from '@babel/core';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { sessionStore } from './sessionStore';
import { connectCloud, readCloudCredentials, type CloudEnvVar } from './supabase';

/**
 * `createClient` is mocked for every test in this file, and that is doing real work rather
 * than avoiding it. A genuine `SupabaseClient` constructs a `GoTrueClient`, which reads
 * storage and schedules an auto-refresh timer the moment it exists — so a suite that built
 * one would leave a live timer behind and, worse, would make "was a client built?" impossible
 * to ask. That question *is* the guarantee below: with no credentials, nothing is built.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

interface SupabaseJsMock {
  createClient: jest.Mock;
}

/** Distinguishable from anything the real library could return. */
const FAKE_CLIENT = { itIsTheFakeClient: true };

const URL_VAR: CloudEnvVar = 'EXPO_PUBLIC_SUPABASE_URL';
const KEY_VAR: CloudEnvVar = 'EXPO_PUBLIC_SUPABASE_ANON_KEY';

/**
 * Loads `supabase.ts` from scratch with exactly the environment named — nothing else.
 *
 * **The environment is cleared first, deliberately, and no test in this file reads the
 * statically imported `cloud`.** The module decides once, at module scope, whether this build
 * has a backend, so a test that let the machine's own environment leak in would assert
 * something different on the owner's laptop (where a `.env` may exist) than in CI. The suite
 * has to be green with credentials and without them, and it has to be *testing the same
 * thing* in both cases.
 *
 * `jest.resetModules()` re-runs the mock factory too, so the mocked `createClient` is a new
 * function each time and has to be fetched here rather than captured once at the top.
 *
 * `jest.requireActual` rather than a bare `require`, and neither out of preference: a
 * top-level `import` cannot re-evaluate a module, `await import()` is left untransformed by
 * `babel-preset-expo` and dies in Jest's CJS runtime ("A dynamic import callback was invoked
 * without --experimental-vm-modules"), and `require()` is the one form this repo's ESLint
 * rejects. It names only `./supabase`, which nothing mocks, so the `@supabase/supabase-js`
 * the module reaches for is still the mock declared above — the assertions here would be
 * meaningless otherwise, and several of them would fail loudly rather than quietly.
 */
function loadCloudModule(env: Partial<Record<CloudEnvVar, string>>): {
  cloud: typeof import('./supabase').cloud;
  createClient: jest.Mock;
} {
  jest.resetModules();
  delete process.env[URL_VAR];
  delete process.env[KEY_VAR];
  Object.assign(process.env, env);

  const supabaseJs = jest.requireMock<SupabaseJsMock>('@supabase/supabase-js');
  supabaseJs.createClient.mockReset().mockReturnValue(FAKE_CLIENT);

  const loaded = jest.requireActual<typeof import('./supabase')>('./supabase');
  return { cloud: loaded.cloud, createClient: supabaseJs.createClient };
}

describe('readCloudCredentials', () => {
  it('reports a build that supplied both variables as configured', () => {
    expect(
      readCloudCredentials({
        EXPO_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      }),
    ).toEqual({ configured: true, url: 'https://demo.supabase.co', anonKey: 'anon-key' });
  });

  it('trims a value that came out of a .env with whitespace around it', () => {
    expect(
      readCloudCredentials({
        EXPO_PUBLIC_SUPABASE_URL: '  https://demo.supabase.co ',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: '\tanon-key\n',
      }),
    ).toEqual({ configured: true, url: 'https://demo.supabase.co', anonKey: 'anon-key' });
  });

  it('names both variables when a build supplied neither', () => {
    expect(readCloudCredentials({})).toEqual({ configured: false, missing: [URL_VAR, KEY_VAR] });
  });

  it('names only the variable that is actually missing', () => {
    expect(readCloudCredentials({ EXPO_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co' })).toEqual({
      configured: false,
      missing: [KEY_VAR],
    });
    expect(readCloudCredentials({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' })).toEqual({
      configured: false,
      missing: [URL_VAR],
    });
  });

  /**
   * `EXPO_PUBLIC_SUPABASE_URL=` with nothing after it is what a half-filled `.env` looks
   * like, and it arrives as `''`. Treating it as a supplied value hands `createClient('')` a
   * string it rejects by throwing — so this is the difference between "no backend" and "the
   * app fell over at import", from an edit that looks like nothing.
   */
  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
  ])('treats a %s value as no value at all', (_label, blank) => {
    expect(
      readCloudCredentials({
        EXPO_PUBLIC_SUPABASE_URL: blank,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: blank,
      }),
    ).toEqual({ configured: false, missing: [URL_VAR, KEY_VAR] });
  });
});

describe('connectCloud', () => {
  const { createClient } = jest.requireMock<SupabaseJsMock>('@supabase/supabase-js');

  beforeEach(() => {
    createClient.mockReset().mockReturnValue(FAKE_CLIENT);
  });

  it('builds nothing whatsoever when there are no credentials', () => {
    const cloud = connectCloud({ configured: false, missing: [URL_VAR, KEY_VAR] });

    expect(cloud).toEqual({ configured: false, missing: [URL_VAR, KEY_VAR] });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('hands createClient the url and the anon key, in that order', () => {
    const cloud = connectCloud({
      configured: true,
      url: 'https://demo.supabase.co',
      anonKey: 'anon-key',
    });

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient.mock.calls[0]?.[0]).toBe('https://demo.supabase.co');
    expect(createClient.mock.calls[0]?.[1]).toBe('anon-key');
    expect(cloud).toEqual({ configured: true, client: FAKE_CLIENT });
  });

  /**
   * DESIGN.md §4's stack table, in the one place it can be checked: "Auth session in the
   * keychain, not AsyncStorage". Identity, not shape — the session store this asserts is the
   * platform-resolved module, so on a device build it is the keychain and in a browser it is
   * `sessionStore.web.ts`, and neither can be swapped for an inline object without this
   * failing.
   */
  it('persists the session through the platform session store', () => {
    connectCloud({ configured: true, url: 'https://demo.supabase.co', anonKey: 'anon-key' });

    const options = createClient.mock.calls[0]?.[2] as { auth?: Record<string, unknown> };
    expect(options.auth?.storage).toBe(sessionStore);
    expect(options.auth?.persistSession).toBe(true);
    expect(options.auth?.autoRefreshToken).toBe(true);
  });

  it('does not go looking for a session in the page URL', () => {
    connectCloud({ configured: true, url: 'https://demo.supabase.co', anonKey: 'anon-key' });

    const options = createClient.mock.calls[0]?.[2] as { auth?: Record<string, unknown> };
    expect(options.auth?.detectSessionInUrl).toBe(false);
  });

  /**
   * A typo in a URL must cost the diver the cloud and nothing else. `createClient` validates
   * synchronously and throws — and this client is built at module scope, so an escaping throw
   * is not an error message, it is the offline logbook failing to launch over a backend §1
   * says it does not need.
   */
  it('degrades to no backend when createClient refuses the credentials', () => {
    const refusal = new Error('Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.');
    createClient.mockImplementation(() => {
      throw refusal;
    });

    const cloud = connectCloud({ configured: true, url: 'not-a-url', anonKey: 'anon-key' });

    expect(cloud).toEqual({ configured: false, missing: [], cause: refusal });
  });

  it('still reports an Error when something non-Error is thrown at it', () => {
    createClient.mockImplementation(() => {
      throw 'plain string';
    });

    const cloud = connectCloud({ configured: true, url: 'https://demo.supabase.co', anonKey: 'k' });

    expect(cloud.configured).toBe(false);
    expect(cloud.configured === false && cloud.cause).toBeInstanceOf(Error);
    expect(cloud.configured === false && cloud.cause?.message).toBe('plain string');
  });
});

/**
 * The rule the whole module exists for (DESIGN.md §1: the app runs offline from on-device
 * SQLite, and an account is only needed to back up, sync a second device and contribute named
 * sites). M1 shipped and met its done-when with no backend in existence; importing this
 * module must not change that for anyone who never signs in.
 */
describe('importing the module with no credentials', () => {
  it('does not throw', () => {
    expect(() => loadCloudModule({})).not.toThrow();
  });

  it('reports no backend, naming both variables the build did not supply', () => {
    const { cloud } = loadCloudModule({});

    expect(cloud.configured).toBe(false);
    expect(cloud.configured === false && cloud.missing).toEqual([URL_VAR, KEY_VAR]);
    expect(cloud.configured === false && cloud.cause).toBeUndefined();
  });

  it('constructs no client, so there is no keychain read and no refresh timer', () => {
    const { createClient } = loadCloudModule({});

    expect(createClient).not.toHaveBeenCalled();
  });

  /**
   * A console line here would fire on every launch of every build, forever, for a diver who
   * never asked for an account. This module owns the *fact* that there is no backend; the
   * sign-in surface M2 builds owns the telling (§4.1).
   */
  it('says nothing at all on the way past', () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) => jest.spyOn(console, method).mockImplementation(() => {}));

    try {
      loadCloudModule({});
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('importing the module with credentials', () => {
  it('builds the one client from them', () => {
    const { cloud, createClient } = loadCloudModule({
      EXPO_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    });

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient.mock.calls[0]?.[0]).toBe('https://demo.supabase.co');
    expect(createClient.mock.calls[0]?.[1]).toBe('anon-key');
    expect(cloud).toEqual({ configured: true, client: FAKE_CLIENT });
  });

  /**
   * Catches the two reads being wired to each other's variable — which produces a working app
   * whenever both are set, and a wrong answer about *which* one is missing whenever one is
   * not. Supplying only the URL must leave only the anon key missing.
   */
  it('reads each variable under its own name', () => {
    const { cloud: urlOnly } = loadCloudModule({
      EXPO_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
    });
    expect(urlOnly.configured === false && urlOnly.missing).toEqual([KEY_VAR]);

    const { cloud: keyOnly } = loadCloudModule({
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    });
    expect(keyOnly.configured === false && keyOnly.missing).toEqual([URL_VAR]);
  });
});

/**
 * Two facts about the real library, asserted because the rest of this file mocks it away and
 * because **nothing in `src/app/` imports `supabase.ts` yet** — so until the sign-in surface
 * lands, this is the only place the installed package is loaded at all. Without it, a
 * dependency that does not resolve under this project's module resolution would sit undetected
 * until the first screen tried to use it.
 */
describe('@supabase/supabase-js, as installed', () => {
  const real = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');

  it('resolves and evaluates under this project’s resolver', () => {
    expect(typeof real.createClient).toBe('function');
  });

  /**
   * The premise `readCloudCredentials`' blank-is-absent rule rests on, and the premise behind
   * catching rather than rethrowing in `connectCloud`. Both are reasoning about what this
   * library does with a bad value; if a future version stops throwing here, the comments
   * explaining those two decisions become fiction and this is what says so.
   *
   * Only invalid arguments are passed: a *successful* `createClient` would construct a real
   * `GoTrueClient`, which schedules an auto-refresh timer this suite would then have to clean
   * up. Every call below throws before anything is constructed.
   */
  it('refuses a blank or malformed value by throwing, synchronously', () => {
    expect(() => real.createClient('', '')).toThrow(/supabaseUrl is required/);
    expect(() => real.createClient('   ', 'anon-key')).toThrow(/supabaseUrl is required/);
    expect(() => real.createClient('https://demo.supabase.co', '')).toThrow(
      /supabaseKey is required/,
    );
    expect(() => real.createClient('not-a-url', 'anon-key')).toThrow(/Invalid supabaseUrl/);
  });
});

/**
 * The one guarantee that cannot be observed by running the app in development, and therefore
 * the one most likely to be broken by an edit that looks tidier.
 *
 * `babel-preset-expo`'s `expo-inline-or-reference-env-vars` plugin rewrites
 * `process.env.EXPO_PUBLIC_*` **member expressions** and nothing else. In development it
 * points them at `expo/virtual/env`, which is literally `process.env`, so every spelling
 * works. In production it substitutes the value as a string literal at build time — and a
 * shipped React Native bundle has no `.env` and no dotenv, so neither variable exists on the
 * device to fall back on. Handing `readCloudCredentials(process.env)` the whole object passes
 * every test, every dev build and every simulator run, and ships a store binary that quietly
 * has no backend.
 *
 * This runs the real file through the repo's own `babel.config.js` — not a hand-assembled
 * preset list, which could go on agreeing with a config that had dropped `babel-preset-expo`
 * entirely.
 */
describe('the production bundle', () => {
  const REPO_ROOT = resolve(__dirname, '..', '..');
  const SOURCE_PATH = join(__dirname, 'supabase.ts');
  const SENTINEL_URL = 'https://inlined-at-build-time.supabase.co';
  const SENTINEL_KEY = 'inlined-anon-key-sentinel';

  /**
   * `@types/babel__core` models only the caller keys Babel itself defines, so Expo's
   * `isDev` / `platform` / `bundler` need the cast. `isDev: false` is what
   * `babel-preset-expo`'s own `getIsProd` reads to decide between referencing and inlining.
   */
  const METRO_PRODUCTION_CALLER = {
    name: 'metro',
    bundler: 'metro',
    platform: 'ios',
    isDev: false,
    supportsStaticESM: true,
  } as unknown as TransformCaller;

  function transformForProduction(): string {
    const before = { url: process.env[URL_VAR], key: process.env[KEY_VAR] };
    process.env[URL_VAR] = SENTINEL_URL;
    process.env[KEY_VAR] = SENTINEL_KEY;

    try {
      const result = transformSync(readFileSync(SOURCE_PATH, 'utf8'), {
        filename: SOURCE_PATH,
        cwd: REPO_ROOT,
        root: REPO_ROOT,
        caller: METRO_PRODUCTION_CALLER,
      });
      return result?.code ?? '';
    } finally {
      if (before.url === undefined) delete process.env[URL_VAR];
      else process.env[URL_VAR] = before.url;
      if (before.key === undefined) delete process.env[KEY_VAR];
      else process.env[KEY_VAR] = before.key;
    }
  }

  it('carries both values as literals, because a device has nothing to read them from', () => {
    const code = transformForProduction();

    expect(code).toContain(SENTINEL_URL);
    expect(code).toContain(SENTINEL_KEY);
  });

  it('leaves no runtime process.env read behind for a device to come up empty on', () => {
    expect(transformForProduction()).not.toContain('process.env');
  });
});

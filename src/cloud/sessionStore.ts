import type { SupabaseClientOptions } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

/**
 * The three calls Supabase's auth client makes to persist a session, **derived from the
 * option they are handed to** rather than restated here.
 *
 * `@supabase/supabase-js` does not re-export `SupportedStorage` (it lives in
 * `@supabase/auth-js`, which is a transitive dependency this package.json does not name), so
 * the two honest choices were to import across that boundary or to write the three signatures
 * out again. Both are second copies of a rule someone else owns. §4.1's *derive, or tie at
 * compile time* says instead to take the type from the exact position the value occupies:
 * `createClient`'s `auth.storage`. If Supabase widens or narrows that contract, this alias
 * moves with it and the two implementations below stop compiling — which is the whole point.
 */
export type SessionStore = NonNullable<NonNullable<SupabaseClientOptions<string>['auth']>['storage']>;

/**
 * Where a signed-in diver's auth session lives on a phone or tablet: **the device keychain**,
 * which is DESIGN.md §4's stack-table entry in as many words — "Auth session in the keychain,
 * not AsyncStorage" — and §8's compliance line, "tokens in the device keychain".
 *
 * `sessionStore.web.ts` is the browser's half, and it is not a keychain; read its docblock
 * before assuming this file's guarantee travels.
 *
 * **The three calls are wrapped rather than passed by reference**, and that is not style.
 * `SecureStore.getItemAsync(key, options)` takes a second argument; `SupportedStorage`'s
 * `getItem` is `Storage['getItem']`, which takes one. Handing the reference over directly
 * compiles today and silently turns any second argument a future Supabase release decides to
 * pass into a `SecureStoreOptions` — a different keychain service, or a different
 * accessibility class, chosen by accident. Wrapping pins the arity at the boundary.
 *
 * **Two SecureStore options are deliberately left at their defaults, and both are worth
 * naming** so the next reader knows they were considered rather than missed:
 *
 * - `requireAuthentication` stays `false`. Turning it on puts a Face ID / fingerprint prompt
 *   in front of *every* session read, which the auth client performs on launch and on every
 *   token refresh. §0.5's constraint is wet hands on an open deck; a biometric gate on a
 *   background token refresh is the opposite of that.
 * - `keychainAccessible` stays `WHEN_UNLOCKED`. §7's sync triggers are app-foreground,
 *   connectivity-restored, a debounce after a save, and pull-to-refresh — every one of them
 *   happens with the device unlocked and the app in front of the diver, so nothing needs to
 *   read this while the phone is locked. A background sync would need `AFTER_FIRST_UNLOCK`
 *   and should change this line deliberately, not discover it as a bug.
 *
 * Note that `expo-secure-store` is a **native module**: it is compiled into the dev client,
 * so a build made before it was installed cannot run this file. Under Jest it is the
 * `jest-expo` preset's own `ExpoSecureStore` mock that stands in, which is why importing this
 * module in a test does not need a hand-written mock the way `expo-sqlite` did
 * (`__mocks__/expo-sqlite.js`).
 */
export const sessionStore: SessionStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

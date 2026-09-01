import type { sessionStore as nativeSessionStore, SessionStore } from './sessionStore';

/**
 * Where a signed-in diver's auth session lives in a browser. Web only; Metro picks this file
 * over `sessionStore.ts` for `--platform web`, and Jest's haste platforms are iOS-only, so
 * nothing here reaches a device build.
 *
 * **It exists because `expo-secure-store` has no browser implementation at all** — and not
 * the polite kind. `expo-secure-store/build/ExpoSecureStore.web.js` is literally `export
 * default {}`, so `SecureStore.getItemAsync` reaches for `getValueWithKeyAsync` on an empty
 * object and throws a `TypeError`; the library's own `isAvailableAsync()` is
 * `!!ExpoSecureStore.getValueWithKeyAsync`, which is `false` there. That is a rung *below*
 * the `Alert.alert` case `confirmDestructive.web.ts` was written for: an empty function
 * silently does nothing, an empty object throws. Supabase's auth client reads storage during
 * its own initialisation, so the native file in a browser is not a missing feature, it is a
 * crash at start-up.
 *
 * **`localStorage` is what a browser has, and it is not a keychain. Say it plainly:** every
 * script running on this origin can read the session out of it, it survives until something
 * clears site data, and it has no OS-level protection of any kind. Nothing here approximates
 * iOS's Keychain or Android's Keystore, and no amount of wrapping would — the browser exposes
 * no such store. This is the same delegation `confirmDestructive.web.ts` makes to
 * `window.confirm` and `DateTimeField.web.tsx` makes to the browser's own date input: the
 * platform's answer, with its properties stated rather than implied.
 *
 * **What makes that acceptable is §9, and only §9.** The browser is a *testing target, not a
 * supported platform* — no store listing, no parity promise. A real signed-in account in a
 * browser is a thing the owner does on their own machine to exercise sync, and the diver's
 * actual logbook lives in on-device SQLite regardless (§1). If the web app is ever promoted
 * to a product, this file is one of the things that has to be re-argued, because the security
 * property changes and the sentence above stops being a footnote.
 *
 * Rejected: **in-memory storage**, which would refuse to persist a credential anywhere
 * unsafe. It also signs the tester out on every page reload — and surviving a reload is
 * precisely the property §9 records the web spike proving for the data layer, so an auth
 * layer that could not would make the browser useless for testing exactly the thing it was
 * pulled forward to test. Rejected too: **`sessionStorage`**, which is the same trade with a
 * shorter fuse (per-tab, gone on close) and no security gain worth the confusion.
 *
 * **No `try`/`catch` around `localStorage`, deliberately.** A browser that refuses site data
 * throws on the accessor itself — but that browser has already failed this app one layer
 * down: `client.web.ts` opens the database through wa-sqlite in OPFS, which needs the same
 * permission and more besides (§10's cross-origin-isolation entry). There is no state in
 * which auth storage is the first thing to fail, so a guard here would only convert a clear
 * error into a session that quietly never persists.
 */
export const sessionStore: SessionStore = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    window.localStorage.removeItem(key);
  },
};

type Assert<T extends true> = T;

/**
 * Type-level proof that the browser's store is still substitutable for the keychain one — the
 * same device `WebConfirmDestructiveMatchesNative` (platform/confirmDestructive.web.ts) and
 * `WebLoadAppFontsMatchesNative` (theme/loadFonts.web.ts) use. `supabase.ts` imports one name
 * and must not be able to tell which implementation it got.
 *
 * **What it catches:** this file narrowing the contract — dropping a method, or returning a
 * shape `createClient`'s `auth.storage` would reject. **What it does not catch:** the two
 * files agreeing on a signature while this one reads and writes the wrong place; only running
 * it does that, and `sessionStore.test.ts` covers the native half where Jest can see it.
 *
 * The import above is `import type`, so Babel erases it: TypeScript reads `./sessionStore` as
 * the native file (it does not apply Metro's platform extensions), while the web bundle never
 * resolves the specifier and cannot import itself.
 */
export type WebSessionStoreMatchesNative = Assert<
  typeof sessionStore extends typeof nativeSessionStore ? true : false
>;

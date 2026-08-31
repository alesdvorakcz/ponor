/**
 * Registering the app's typefaces with the platform — the native half, which has nothing to
 * do because the platform already has them.
 *
 * On iOS and Android the faces are compiled into the binary by expo-font's config plugin
 * (`app.config.ts`, from `tokens.js`'s `fontFiles`), so by the time any JavaScript runs
 * `Archivo-Medium` and `IBMPlexMono_500Medium` are already resolvable names and there is
 * nothing left to load. This function exists so that `fonts.ts` can state "make this
 * platform's faces available" once, without a `Platform.OS` branch and without knowing that
 * one of the two platforms answers by having done it already.
 *
 * `loadFonts.web.ts` is the half that does work: expo-font's config plugin is native-only,
 * so a browser starts with no Archivo and no IBM Plex Mono at all and has to be handed them
 * at runtime.
 *
 * Deliberately empty, and deliberately not skipped at the call site: a no-op call is one
 * function call at module-evaluation time on a device, which is the price of the split
 * living here instead of in shared UI code.
 */
export function loadAppFonts(): void {}

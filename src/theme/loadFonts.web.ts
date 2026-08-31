import { Archivo_400Regular } from '@expo-google-fonts/archivo/400Regular';
import { Archivo_500Medium } from '@expo-google-fonts/archivo/500Medium';
import { Archivo_600SemiBold } from '@expo-google-fonts/archivo/600SemiBold';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { loadAsync } from 'expo-font';

import type { loadAppFonts as nativeLoadAppFonts } from './loadFonts';

/**
 * The six faces DESIGN.md §0.2 spends the whole type system on, as browser assets.
 *
 * **Every key here is a shorthand property, so the key IS the imported binding** — a
 * misspelled family name would not compile, and the string can never drift from the file it
 * came from. The list itself has to be written out because Metro resolves `require`/`import`
 * specifiers statically: a path computed from `tokens.js`'s `fontFiles` at runtime would
 * bundle nothing at all. What cannot be derived is instead *tied*, per §4.1 — `fonts.test.ts`
 * pins this key set equal to `tokens.js`'s own set of family names, so a face added or
 * renamed there and forgotten here reddens `npm test` rather than quietly rendering serif in
 * a browser. That test is the guarantee; there is no runtime check, because there is no
 * useful runtime response to a face nobody bundled.
 *
 * Exported for that test alone.
 */
export const WEB_FONT_SOURCES = {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
};

/**
 * Registers Archivo and IBM Plex Mono with the browser. Web only; Metro picks this file over
 * `loadFonts.ts` for `--platform web`, and Jest's platforms are iOS-only, so nothing here
 * runs in a device build.
 *
 * It exists because **expo-font's config plugin is native-only**. It has an iOS half and an
 * Android half and no web half at all, so the `fonts` array in `app.config.ts` embeds these
 * faces in the two binaries and contributes exactly nothing to a browser build. The spike
 * build rendered the entire app — headings, trip headers, the mono depth figures — in the
 * browser's default serif, and §0.2's whole point is that a figure is mono and a name is
 * sans: the app was usable and not evaluable.
 *
 * `expo-font`'s *runtime* `loadAsync` is the web half the plugin lacks. On web it resolves
 * each asset to a URL and injects an `@font-face` rule under the family name it was given,
 * which is the same name `fonts.ts` hands `styles.ts` on this platform (the
 * `@expo-google-fonts` file names — see that file for why iOS needs PostScript names
 * instead and web does not). Nothing here re-states a font name; the names come from the
 * imports above, and the app asks for the same strings it always did.
 *
 * **Fire-and-forget, on purpose.** The call sits at module scope in `fonts.ts`, so the
 * request starts as the bundle evaluates — earlier than any component could ask for it — and
 * nothing waits on it. A browser re-renders text when a face finishes loading, so the worst
 * case is a frame of fallback type; gating the app on it would mean a platform branch in
 * shared UI code to buy back one frame on a platform §9 calls a testing target. A failure
 * surfaces as an unhandled rejection in the console rather than being swallowed, which is
 * the loud end of the trade: fonts that silently do not load are the exact defect this file
 * exists to fix.
 */
export function loadAppFonts(): void {
  void loadAsync(WEB_FONT_SOURCES);
}

type Assert<T extends true> = T;

/**
 * Type-level proof that the browser's loader is still substitutable for the native no-op —
 * the same device `WebDateTimeFieldMatchesNative` (DateTimeField.web.tsx) and
 * `TankFormFieldsMatchTank` (diveFormSchema.ts) use. `fonts.ts` imports one name and must
 * not be able to tell which implementation it got.
 *
 * **What it catches:** this file growing a contract of its own — a required argument, or a
 * `Promise` return that the native file does not offer and the call site would have to
 * handle differently per platform. **What it does not catch:** the two files agreeing on a
 * signature while this one loads the wrong faces; `fonts.test.ts` covers that half.
 *
 * The import above is `import type`, so Babel erases it: TypeScript reads `./loadFonts` as
 * the native file (it does not apply Metro's platform extensions), while the web bundle
 * never resolves the specifier and cannot import itself.
 */
export type WebLoadAppFontsMatchesNative = Assert<
  typeof loadAppFonts extends typeof nativeLoadAppFonts ? true : false
>;

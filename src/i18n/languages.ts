/**
 * **The set of languages the app ships**, on its own so that two modules can read it without
 * either importing the other (M3h).
 *
 * It lived in `src/i18n/index.ts` until `pluralRules.ts` needed it: that module is called
 * *from* `index.ts`, before `i18next.init`, so the pair would have been a real runtime cycle
 * around a module whose body initialises the instance — the shape `format/display.ts` already
 * spends a paragraph avoiding one file over. `index.ts` re-exports both names, so every caller
 * outside this directory is unchanged.
 */

/** A language the app actually ships. Both are complete; neither is a fallback for the other
 * in the sense §1 means, because both are written. */
export const LANGUAGES = ['en', 'cs'] as const;

export type Language = (typeof LANGUAGES)[number];

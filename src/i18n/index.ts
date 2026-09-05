/*
 * `import/no-named-as-default-member` is off for this file, and only this file. i18next's
 * documented API *is* its default export's members — `i18next.use`, `i18next.t`,
 * `i18next.changeLanguage` — and it also re-exports each of them as a named binding bound to
 * that same default instance. The rule cannot tell the two apart, so it warns four times about
 * calls that are exactly what the library's own README writes. Switching to the named forms
 * would buy nothing and would make it read as though there were two instances in play.
 */
/* eslint-disable import/no-named-as-default-member */
import { getLocales } from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';

import { cs } from './cs';
import { en } from './en';
import { LANGUAGES, type Language } from './languages';
import { installPluralRulesPolyfill } from './pluralRules';

/**
 * **The app's one i18next instance** (DESIGN.md §4: `i18next` + `expo-localization`, English
 * and Czech from day one), initialised here at import and never anywhere else.
 *
 * ── Who reads it ──────────────────────────────────────────────────────────────────────────
 *
 * §4.1's owners are unchanged and that is the whole design of this file. `format/display.ts`
 * still owns every conversion of a stored value into diver-facing text and `format/units.ts`
 * still owns the unit words; what changed is that they now *look the word up* instead of
 * spelling it. A screen that translated a salinity label itself would be a second owner, and
 * nothing would fail — so the rule is that a screen keys only its OWN chrome (its title, its
 * buttons, its notices) and asks `format/display.ts` for anything that came out of a dive.
 *
 * ── Why the language is not a parameter, where the unit system is ─────────────────────────
 *
 * `format/display.ts` takes `system` from its caller and reads nothing from inside itself,
 * because two callers on one screen may legitimately want different units — a form field
 * showing what the diver typed, beside a figure showing what is stored. Language has no such
 * case: there is exactly one answer for the whole app at any instant, and threading it through
 * forty formatters and every one of their tests would buy a parameter nobody would ever pass
 * differently. So it is read from here.
 *
 * The cost of that is a re-render problem, and `useT` below is the answer to it.
 *
 * ── Keys are checked by the compiler ─────────────────────────────────────────────────────
 *
 * `TranslationKey` is derived from `en.ts` itself, so a mistyped or removed key is a build
 * error rather than a screen quietly rendering `dives.titel`. §4.1's "derive, or tie at compile
 * time", applied to the one thing about translation that is otherwise checked by nothing.
 */

export { LANGUAGES, type Language } from './languages';

/**
 * **What a missing string falls back to** (§1: never block). i18next resolves a key the active
 * language does not hold against this one, so the worst case a diver can reach is an English
 * sentence in a Czech screen — legible, and obviously wrong to whoever reads it. A blank was
 * never a candidate: it would leave a labelled row with nothing in it, which is the one thing
 * §0.6 spends an em dash to avoid.
 *
 * English is the fallback because English is the app (`en.ts`), so this is not a preference
 * between two translations — it is the source falling back to itself.
 */
const FALLBACK_LANGUAGE: Language = 'en';

/** What §3's Settings row can be set to: either language, or whatever the phone says. */
export const LANGUAGE_PREFERENCES = ['system', ...LANGUAGES] as const;

export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

/**
 * Whether a value read back out of the local `settings` table names a language preference —
 * `isUnitSystem`'s exact shape one file over (`format/units.ts`), for the exact reason: the
 * table is `text`/`text`, so every read has to decide what the string means, and a value from a
 * future build offering a third language is not one this build can honour.
 */
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return typeof value === 'string' && (LANGUAGE_PREFERENCES as readonly string[]).includes(value);
}

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * **What the phone is set to, reduced to a language this app has** — §3's "device locale by
 * default".
 *
 * Only the language subtag is read. `cs-CZ` and a hypothetical `cs-SK` are the same Czech to
 * this app, and a diver whose phone is set to German gets English rather than nothing: there is
 * no third resource file, and `supportedLngs` would refuse the tag anyway.
 *
 * Guarded, because this is the one thing here that talks to the platform. `getLocales()` is
 * synchronous and cannot normally fail, but it is a native module and this function is called
 * during module initialisation — the one moment where a throw takes the whole app with it, on
 * a screen the diver has not even seen (§1).
 */
export function deviceLanguage(): Language {
  try {
    const code = getLocales().at(0)?.languageCode;
    return isLanguage(code) ? code : FALLBACK_LANGUAGE;
  } catch {
    return FALLBACK_LANGUAGE;
  }
}

/** The language a stored preference actually means — itself, or the device's when the diver has
 * expressed none. The one place `'system'` is resolved; nothing else compares against it. */
export function resolveLanguage(preference: LanguagePreference): Language {
  return preference === 'system' ? deviceLanguage() : preference;
}

/**
 * Every plural suffix i18next appends. English uses two of them and Czech four (§0.5) — which
 * is exactly why the parity test between the two resource files strips them before comparing,
 * and why `TranslationKey` below does too: a caller writes `count.dives` and never
 * `count.dives_few`.
 */
type PluralSuffix = 'one' | 'two' | 'few' | 'many' | 'other';

type WithoutPlural<K extends string> = K extends `${infer Base}_${PluralSuffix}` ? Base : K;

/** Every dotted path to a string in `en.ts`, with plural suffixes folded away. */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? WithoutPlural<K> : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Paths<typeof en.translation>;

/** What may be interpolated into a string. `count` is the one with a meaning of its own:
 * i18next reads it to pick a plural form, and Czech's four are the reason this task exists. */
export type TranslationValues = Readonly<Record<string, string | number>>;

/**
 * `initAsync: false` so the instance is usable on the line after this one. The default defers
 * resource loading to a `setTimeout`, which would leave `format/display.ts` returning raw keys
 * for the first frame and every test asserting against them. The resources here are bundled
 * objects rather than a backend, so there is nothing for the deferral to wait on.
 *
 * `escapeValue: false` because nothing here renders HTML. With i18next's default an apostrophe
 * interpolated into a sentence arrives as `&#39;`, and half the app's sentences have one.
 *
 */
/**
 * **Before `init`, because i18next caches a plural rule the first time it resolves one.**
 *
 * Hermes on iOS has no `Intl.PluralRules`, and i18next's fallback for a runtime without one is
 * `count === 1 ? 'one' : 'other'` — English's rule, applied to Czech, which is the exact
 * failure this milestone exists to prevent. `pluralRules.ts` carries the whole account,
 * including why no gate caught it. It does nothing at all where a real ICU exists.
 */
installPluralRulesPolyfill();

void i18next.use(initReactI18next).init({
  resources: { en, cs },
  lng: deviceLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: LANGUAGES,
  initAsync: false,
  interpolation: { escapeValue: false },
});

/**
 * **`figure`: how a number reaches a sentence, in the language the sentence is in.**
 *
 * i18next interpolates a raw value with `String(value)`, so a Czech string built around a bare
 * `{{count}}` renders *1.5 ponoru* — the right word beside the wrong mark. Every template that
 * carries a number therefore writes `{{count, figure}}`, and `i18n/index.test.ts` refuses a bare
 * `{{count}}` in either resource file so the suffix cannot be forgotten at one of them.
 *
 * **Not i18next's own built-in `number`**, which is `Intl.NumberFormat` and therefore GROUPS: a
 * 1284-dive logbook's English header would become *1,284 dives*. English is the app rather than
 * a translation of it (`en.ts`), so a formatter that rewrites an English figure is out.
 *
 * Registered after `init` because that is when the formatter exists — v26 always installs its
 * own `Formatter` and binds `interpolation.format` to it, which is also why the documented
 * `interpolation.format` option is dead here and this is the route that works.
 */
i18next.services.formatter?.add('figure', (value: unknown) =>
  typeof value === 'number' ? numberText(value) : String(value),
);

/**
 * **The mark between a figure's whole part and its fraction, in the language the app is in** —
 * `.` in English, `,` in Czech.
 *
 * The one owner of it, read by two callers that could not share a call site: `figureText`
 * (format/units.ts), which writes the figures the app builds itself, and the interpolation
 * callback above, which writes the ones i18next drops into a sentence. Written twice, a Czech
 * header could read *41,2 m* on one line and *1.5 ponoru* on the next.
 *
 * It is a resource key rather than a constant here so a reviewer sees it change where every
 * other difference between the two languages is (`figure.decimalSeparator`, en.ts/cs.ts).
 */
export function decimalSeparator(): string {
  return i18next.t('figure.decimalSeparator');
}

/** A number as this language writes it — the `figure` formatter's whole job. No grouping: see
 * that registration for why `Intl.NumberFormat` is not used. */
function numberText(value: number): string {
  const separator = decimalSeparator();
  const text = String(value);
  return separator === '.' ? text : text.replace('.', separator);
}

/**
 * **One string, in the language the app is currently in.**
 *
 * Not `i18next.t` directly, and the wrapper is what buys `TranslationKey`: i18next's own `t`
 * accepts any string, so a key that does not exist is a runtime shrug rather than a build
 * failure. It also keeps every caller in this codebase pointing at one import, which is what
 * makes "who is allowed to translate" a question with an answer.
 */
export function t(key: TranslationKey, values?: TranslationValues): string {
  return i18next.t(key, values);
}

/**
 * **The language a render is happening in, and the subscription that makes a language change
 * visible.**
 *
 * This is the piece the module-global `t` above needs. A component that only calls `t` reads
 * the right words the first time and then never hears that they changed; `useTranslation`
 * subscribes it to i18next's `languageChanged`, so switching the setting in §3's Settings row
 * repaints the app rather than the next navigation doing it.
 *
 * **Who has to call it is a narrow list, and the rule is "nothing above me will re-render".**
 * A component redraws when its parent does, so an ordinary child of a screen needs nothing:
 * `DayStrip`, `EmptyState` and `ReorderControls` all had a call here and it was deleted,
 * because no mutation could make its absence fail — which is the definition of a line that is
 * not doing anything. Two kinds of caller are left, and each has a test that goes red without
 * it:
 *
 * - **A screen, and each tab layout.** They are the roots of their own render trees:
 *   `LanguageSync` is a sibling in the root layout and its state change reaches nobody, so
 *   without this a diver would change the setting and see the old words until they navigated.
 * - **A `memo`'d component.** `DiveRow` is the one, and it is the sharp case: its words come
 *   from `format/display.ts` and from `t`, neither of which is a prop, so `memo` would happily
 *   keep drawing yesterday's language. (In the app `DivesScreen` recreates `onPress` each
 *   render and defeats the memo by accident, which is exactly why that test holds the props
 *   stable — see it.)
 *
 * It is not a break from this codebase's rule that a screen decides once and its components
 * stay pure functions of their props: `scheme` and `units` are threaded because a component may
 * legitimately be asked to render in either, and a test wants to do exactly that. Language has
 * one answer for the whole app, so there is nothing to decide and nothing for a prop to vary —
 * what these two need is not the value but the *subscription*, which a prop cannot give.
 *
 * Returns `t` rather than i18next's own bound function, so a caller keeps the checked key type.
 */
export function useT(): typeof t {
  // The result is deliberately unused: what this call is for is the subscription, not the
  // function it hands back.
  useTranslation();
  return t;
}

/**
 * Puts the app into a language. The one writer of i18next's active language — `LanguageSync`
 * in real use, and a test that wants to look at Czech.
 *
 * Idempotent on purpose: `changeLanguage` fires `languageChanged` whether or not anything
 * changed, and every subscribed component re-renders when it does.
 */
export function setActiveLanguage(language: Language): void {
  if (i18next.language === language) return;
  void i18next.changeLanguage(language);
}

/**
 * **What each of §3's three language options is called on its own chip.**
 *
 * A language is written in itself — *English*, *Čeština* — and that is the load-bearing part
 * rather than a convention borrowed from other apps: a diver who lands in the wrong language
 * has to be able to read their own way out, and *Angličtina* on a Czech screen is no help at
 * all to somebody who does not read Czech. So only the *Device* option is translated, because
 * it names a behaviour rather than a language.
 *
 * It lives here rather than in `format/display.ts` for the same split that puts `unitLabel` in
 * `format/units.ts` and `formatUnitSystem` next door: this is a fact about the language set,
 * not a stored dive value becoming text, and this module is the one that has the set.
 */
const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', cs: 'Čeština' };

export function languageLabel(preference: LanguagePreference): string {
  return preference === 'system' ? t('settings.languageDevice') : LANGUAGE_NAMES[preference];
}

/** What language the app is in right now. Read by tests and by nothing in the app: a screen
 * that branched on this would be deciding something the resource files already decided. */
export function activeLanguage(): string {
  return i18next.language;
}

export { i18next };

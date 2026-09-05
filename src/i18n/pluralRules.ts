import { LANGUAGES, type Language } from './languages';

/**
 * **`Intl.PluralRules` does not exist in Hermes on iOS, and without it Czech gets English's
 * rule** (M3h, found on the simulator — see below for why no test could).
 *
 * ── What was actually happening ───────────────────────────────────────────────────────────
 *
 * i18next picks a plural form through `Intl.PluralRules`, and its `PluralResolver` has a
 * documented fallback for a runtime that has none:
 *
 * ```js
 * const dummyRule = { select: count => count === 1 ? 'one' : 'other',
 *                     resolvedOptions: () => ({ pluralCategories: ['one', 'other'] }) };
 * ```
 *
 * That is English's rule, applied to Czech. On the device the map's own sheet read
 * *"2 ponorů"* where Czech wants *"2 ponory"* — `count.dives_few` and `count.dives_many` were
 * never reachable at all, because `pluralCategories` said the language had two forms. Every
 * four-form key this milestone and M3g wrote was half dead in the app.
 *
 * ── Why no gate caught it, which is the part worth keeping ────────────────────────────────
 *
 * M3g pinned `Intl.PluralRules` with a test of its own, correctly identifying this as the
 * dependency the four forms rest on — but **that test runs under Jest, which is Node, which
 * has full ICU**. It can only ever prove that the *test runner* can decline a Czech noun.
 * M3g also checked the simulator and reported `1 ponor` and `11 ponorů` rendering correctly;
 * both of those are `one` and `other`, which the two-form fallback gets right, so the
 * observation could not have failed either. It takes a count of 2, 3 or 4 to tell the two
 * rules apart, and nothing looked at one.
 *
 * ── What this is, and what it is not ──────────────────────────────────────────────────────
 *
 * It is the CLDR **cardinal** rule for the two languages this app ships, installed as
 * `Intl.PluralRules` **only when the runtime has none**. Where a real ICU exists — Node, the
 * browser, Hermes on Android — nothing here runs and i18next keeps using it.
 *
 * It is **not** a second owner of the plural rule. i18next still selects the form and the
 * resource files still hold the words; this supplies the table ICU would have supplied. The
 * alternative was a dependency (`intl-pluralrules` is i18next's own recommendation for React
 * Native), and it was not taken because it carries ~200 locales' rules for the two this app
 * has, and because a rule this short is better read than trusted. Recorded for DESIGN.md §4.
 *
 * **Cardinal only.** `type: 'ordinal'` answers `other` for every count, which is exactly right
 * for Czech (its ordinal rule has one category) and wrong for English (`1st`/`2nd`/`3rd`/`4th`)
 * — and unreachable, because nothing in this app writes an ordinal key. Stated rather than
 * silently approximated, so the next person adding one finds this paragraph.
 */

/** The four categories CLDR uses for the languages here. `two` exists in CLDR and in neither
 * of these languages, so it is deliberately absent. */
export type PluralCategory = 'one' | 'few' | 'many' | 'other';

/**
 * One language's cardinal rule and the categories it can produce.
 *
 * **The categories are declared rather than derived from `select`**, because i18next reads
 * them for a different purpose: `getSuffixes` builds the list of keys a plural may live under,
 * so a rule whose `select` returns `few` while its `pluralCategories` omits it would resolve
 * to nothing. Two statements of one fact, which is why the test asserts they agree.
 */
interface CardinalRule {
  readonly categories: readonly PluralCategory[];
  readonly select: (count: number) => PluralCategory;
}

/**
 * **CLDR's cardinal rules, one per language this app ships**, keyed by `Language` so a third
 * language is a compile error here until somebody writes its rule (§4.1's "derive, or tie at
 * compile time"). A language with no rule would silently get English's, which is the whole
 * defect this file exists to close.
 *
 * `i` is the integer part and `v` the count of visible fraction digits, in CLDR's own terms.
 * The app only ever counts array lengths, so `v` is 0 in practice — but `formatDiveCount(1.5)`
 * is reachable from a test and from any future non-integer figure, and Czech's `many` is
 * exactly the fractional case.
 */
const CARDINAL_RULES: Record<Language, CardinalRule> = {
  // en: one → i = 1 and v = 0; other → everything else.
  en: {
    categories: ['one', 'other'],
    select: (count) => (Number.isInteger(count) && Math.abs(count) === 1 ? 'one' : 'other'),
  },
  // cs: one → i = 1 and v = 0; few → i = 2..4 and v = 0; many → v != 0; other → the rest
  // (which is 0 and 5 upwards).
  cs: {
    categories: ['one', 'few', 'many', 'other'],
    select: (count) => {
      if (!Number.isInteger(count)) return 'many';
      const whole = Math.abs(count);
      if (whole === 1) return 'one';
      return whole >= 2 && whole <= 4 ? 'few' : 'other';
    },
  },
};

/** Which rule a locale code gets — the language subtag alone (`cs-CZ` is Czech), and English
 * for anything this app has no rule for, which is what the runtime would have done anyway. */
export function cardinalRuleFor(locale: string): CardinalRule {
  const subtag = locale.toLowerCase().split(/[-_]/u)[0] ?? '';
  const known = (LANGUAGES as readonly string[]).includes(subtag);
  return known ? CARDINAL_RULES[subtag as Language] : CARDINAL_RULES.en;
}

/** The category a count falls in, for one of this app's own languages. Exported for the test
 * that walks the boundaries — 1, 2, 4, 5, 0 and a fraction — rather than trusting the rule. */
export function pluralCategoryOf(language: Language, count: number): PluralCategory {
  return CARDINAL_RULES[language].select(count);
}

export function pluralCategoriesOf(language: Language): readonly PluralCategory[] {
  return CARDINAL_RULES[language].categories;
}

/** The shape i18next actually reads off a `PluralRules` instance: `select`, and
 * `resolvedOptions().pluralCategories`. Nothing else is used, and nothing else is provided. */
interface MinimalPluralRules {
  select: (count: number) => PluralCategory;
  resolvedOptions: () => { locale: string; type: 'cardinal' | 'ordinal'; pluralCategories: string[] };
}

/**
 * **Installs the rules above as `Intl.PluralRules`, and only where there is none.**
 *
 * Returns whether it installed anything, so the test can state both halves: that a runtime
 * with ICU is left alone, and that a runtime without one comes away able to decline a Czech
 * noun. Called from `src/i18n/index.ts` before `init`, because i18next caches a rule per
 * language the first time it resolves one.
 */
export function installPluralRulesPolyfill(): boolean {
  const intl = globalThis.Intl as (typeof Intl & { PluralRules?: unknown }) | undefined;
  if (intl === undefined) return false;
  if (typeof intl.PluralRules === 'function') return false;

  function Polyfilled(this: unknown, locale?: string, options?: { type?: 'cardinal' | 'ordinal' }): MinimalPluralRules {
    const code = locale ?? 'en';
    const type = options?.type ?? 'cardinal';
    // Ordinal answers `other` throughout — see this file's docblock for why that is right for
    // Czech, wrong for English, and unreachable in this app.
    const rule = type === 'ordinal' ? null : cardinalRuleFor(code);
    return {
      select: (count: number) => (rule === null ? 'other' : rule.select(Number(count))),
      resolvedOptions: () => ({
        locale: code,
        type,
        pluralCategories: rule === null ? ['other'] : [...rule.categories],
      }),
    };
  }

  (intl as { PluralRules?: unknown }).PluralRules = Polyfilled;
  return true;
}

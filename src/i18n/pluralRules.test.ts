import { createInstance, type i18n } from 'i18next';

import { cs } from './cs';
import { en } from './en';
import { LANGUAGES } from './languages';
import {
  cardinalRuleFor,
  installPluralRulesPolyfill,
  pluralCategoriesOf,
  pluralCategoryOf,
} from './pluralRules';

/**
 * **The gate M3g's own `Intl.PluralRules` test could not be.**
 *
 * That test asks whether *this runner* can decline a Czech noun, and Jest is Node with full
 * ICU, so it answers yes on a machine where the app answers no. Hermes on iOS has no
 * `Intl.PluralRules` at all: i18next then uses `count === 1 ? 'one' : 'other'` and reports the
 * language as having two categories, so `_few` and `_many` are not merely unselected — they
 * are unreachable. On the simulator the map's sheet read *"2 ponorů"* for two dives.
 *
 * So this file tests **the rule** rather than the runtime's possession of one, and then tests
 * i18next **with the runtime's rule taken away**, which is the only shape of test that would
 * have gone red before the polyfill existed.
 */

// ---------------------------------------------------------------------------------------
// The rules themselves, at the boundaries CLDR draws them at
// ---------------------------------------------------------------------------------------

/**
 * Every boundary of Czech's cardinal rule, and both sides of each — 1/2, 4/5, and 0, plus the
 * fraction that is the whole of what `many` is for. A test at 1 and 5 alone would pass under
 * English's rule, which is what the app was actually running.
 */
it('declines Czech at every boundary CLDR draws', () => {
  expect(pluralCategoryOf('cs', 1)).toBe('one');
  expect(pluralCategoryOf('cs', 2)).toBe('few');
  expect(pluralCategoryOf('cs', 3)).toBe('few');
  expect(pluralCategoryOf('cs', 4)).toBe('few');
  expect(pluralCategoryOf('cs', 5)).toBe('other');
  expect(pluralCategoryOf('cs', 11)).toBe('other');
  expect(pluralCategoryOf('cs', 0)).toBe('other');
  // `many` is the fractional category, not "a lot" — 1,5 ponoru.
  expect(pluralCategoryOf('cs', 1.5)).toBe('many');
  expect(pluralCategoryOf('cs', 22.5)).toBe('many');
});

it('leaves English on its own two forms', () => {
  expect(pluralCategoryOf('en', 1)).toBe('one');
  expect(pluralCategoryOf('en', 0)).toBe('other');
  expect(pluralCategoryOf('en', 2)).toBe('other');
  expect(pluralCategoryOf('en', 1.5)).toBe('other');
});

/**
 * **`pluralCategories` and `select` are two statements of one fact**, and i18next reads them
 * for different jobs: `select` picks the suffix, `pluralCategories` decides which suffixed
 * keys exist at all. A rule that selected `few` while declaring two categories would resolve
 * a Czech plural to nothing — which is precisely what the runtime's own fallback did.
 */
it.each(LANGUAGES)('produces no category for %s that it does not declare', (language) => {
  const declared = pluralCategoriesOf(language);
  const produced = new Set([0, 1, 2, 3, 4, 5, 11, 100, 1.5].map((n) => pluralCategoryOf(language, n)));
  for (const category of produced) expect(declared).toContain(category);
  // ...and every declared category is actually reachable, so the list cannot quietly grow.
  for (const category of declared) expect([...produced]).toContain(category);
});

/** A regional tag is the same language (`cs-CZ` is Czech), and a language this app has no rule
 * for falls back to English — which is what the runtime would have given it anyway. */
it('reads a locale code down to its language, and falls back where it has no rule', () => {
  expect(cardinalRuleFor('cs-CZ').select(3)).toBe('few');
  expect(cardinalRuleFor('CS').select(3)).toBe('few');
  expect(cardinalRuleFor('cs_CZ').select(3)).toBe('few');
  expect(cardinalRuleFor('de-DE').select(3)).toBe('other');
  expect(cardinalRuleFor('').select(1)).toBe('one');
});

// ---------------------------------------------------------------------------------------
// The install, in both of the two states a runtime can be in
// ---------------------------------------------------------------------------------------

/** Node has ICU, so nothing is installed and i18next keeps using the real thing. This is the
 * half that stops the polyfill quietly replacing a better rule everywhere it runs. */
it('leaves a runtime that has Intl.PluralRules alone', () => {
  expect(typeof Intl.PluralRules).toBe('function');
  const before = Intl.PluralRules;
  expect(installPluralRulesPolyfill()).toBe(false);
  expect(Intl.PluralRules).toBe(before);
});

/**
 * **The device, reproduced: i18next with `Intl.PluralRules` taken away.**
 *
 * A fresh instance rather than the app's own, because `src/i18n` initialises its singleton at
 * import — under the real ICU this runner has — and i18next caches a rule per language the
 * first time it resolves one. Same resource files, same options that matter, so what is being
 * asserted is the app's own Czech read through the app's own keys.
 *
 * Without the polyfill this test reads *"2 ponorů"* at every count above one, which is the
 * sentence a diver actually saw.
 */
describe('on a runtime with no Intl.PluralRules', () => {
  const real = Intl.PluralRules;
  let instance: i18n;

  beforeAll(async () => {
    (Intl as { PluralRules?: unknown }).PluralRules = undefined;
    installPluralRulesPolyfill();
    instance = createInstance();
    await instance.init({
      resources: { en, cs },
      lng: 'cs',
      fallbackLng: 'en',
      supportedLngs: LANGUAGES,
      initAsync: false,
      interpolation: { escapeValue: false },
    });
    // The `figure` formatter is the app's, registered the same way and for the same reason —
    // without it a Czech fraction would render `1.5 ponoru`, a right word beside a wrong mark.
    instance.services.formatter?.add('figure', (value: unknown) =>
      typeof value === 'number' ? String(value).replace('.', ',') : String(value),
    );
  });

  afterAll(() => {
    (Intl as { PluralRules?: unknown }).PluralRules = real;
  });

  it('declines a dive count through all four Czech forms', () => {
    expect(instance.t('count.dives', { count: 1 })).toBe('1 ponor');
    expect(instance.t('count.dives', { count: 2 })).toBe('2 ponory');
    expect(instance.t('count.dives', { count: 4 })).toBe('4 ponory');
    expect(instance.t('count.dives', { count: 5 })).toBe('5 ponorů');
    expect(instance.t('count.dives', { count: 1.5 })).toBe('1,5 ponoru');
    // The inequality, so four keys holding one word could not satisfy it.
    expect(instance.t('count.dives', { count: 2 })).not.toBe(instance.t('count.dives', { count: 5 }));
  });

  /** The count of three at 2 — the exact figure the map sheet showed wrong, on all three of
   * the app's counted nouns rather than the one that was noticed. */
  it('reaches the `few` form of every noun the app counts', () => {
    expect(instance.t('count.dives', { count: 2 })).toBe('2 ponory');
    expect(instance.t('count.sites', { count: 2 })).toBe('2 lokality');
    expect(instance.t('count.centres', { count: 2 })).toBe('2 centra');
    expect(instance.t('count.changesWaiting', { count: 3 })).toBe('3 změny čekají na synchronizaci');
  });

  it('leaves English on its own two forms', async () => {
    await instance.changeLanguage('en');
    expect(instance.t('count.dives', { count: 1 })).toBe('1 dive');
    expect(instance.t('count.dives', { count: 2 })).toBe('2 dives');
    expect(instance.t('count.dives', { count: 5 })).toBe('5 dives');
    await instance.changeLanguage('cs');
  });
});

/**
 * **That `src/i18n` actually installs it**, which is the one line above that nothing else here
 * could make fail: every test in this file calls `installPluralRulesPolyfill()` itself, so
 * deleting the call from `index.ts` would leave them all green while the app went back to
 * reading Czech under English's rule.
 *
 * The rule is taken away **before** the module is imported, in a fresh registry, because
 * `index.ts` initialises the instance at import and i18next caches a plural rule the first
 * time it resolves one — which is exactly the ordering constraint that made the call's position
 * in that file load-bearing.
 */
it('installs the rules from src/i18n itself, before it initialises the instance', () => {
  const real = Intl.PluralRules;
  (Intl as { PluralRules?: unknown }).PluralRules = undefined;
  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const i18n = require('./index') as typeof import('./index');
      i18n.setActiveLanguage('cs');
      expect(i18n.t('count.dives', { count: 2 })).toBe('2 ponory');
      expect(i18n.t('count.dives', { count: 5 })).toBe('5 ponorů');
      i18n.setActiveLanguage('en');
    });
  } finally {
    (Intl as { PluralRules?: unknown }).PluralRules = real;
  }
});

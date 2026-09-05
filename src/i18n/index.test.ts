import { formatDaysSince, formatDiveCount, formatPendingChanges } from '../format/display';
import { cs } from './cs';
import { en } from './en';
import {
  activeLanguage,
  deviceLanguage,
  i18next,
  isLanguagePreference,
  LANGUAGE_PREFERENCES,
  LANGUAGES,
  languageLabel,
  resolveLanguage,
  setActiveLanguage,
  t,
} from './index';

/**
 * The translation machinery itself: that the two resource files hold the same keys, that Czech's
 * four plural forms are actually reached, and that a language change is visible to the
 * formatters (§0.5, §3, §4).
 *
 * **Every test here restores English**, because `en.ts` is the app and the rest of this suite
 * asserts it. The instance is a module global by design (see `src/i18n`'s docblock), so a test
 * that left the app in Czech would leak into whatever ran next in the same worker.
 */
afterEach(() => {
  setActiveLanguage('en');
});

// ---------------------------------------------------------------------------------------
// The two resource files hold the same keys
// ---------------------------------------------------------------------------------------

const PLURAL_SUFFIX = /_(?:one|two|few|many|other)$/u;

/**
 * Every dotted path to a string in a resource tree, with plural suffixes stripped off the last
 * segment — `count.dives_few` and `count.dives_other` are both `count.dives`, which is the
 * whole point: English writes two forms of that key and Czech four, and a comparison that saw
 * the suffixes would report every plural in the app as a mismatch and nothing else.
 *
 * Deduplicated for the same reason.
 */
function keyPaths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) =>
    keyPaths(value, prefix === '' ? key.replace(PLURAL_SUFFIX, '') : `${prefix}.${key.replace(PLURAL_SUFFIX, '')}`),
  );
}

function keySet(node: unknown): string[] {
  return [...new Set(keyPaths(node))].sort();
}

const EN_KEYS = keySet(en.translation);
const CS_KEYS = keySet(cs.translation);

/**
 * **This assertion is trivially satisfiable by two empty objects, so it is floored first.**
 *
 * A parity test between two resource files passes perfectly when both are `{}` — and it would
 * also pass if `keyPaths` above quietly stopped recursing, which is the likelier accident since
 * it is the only clever thing in this file. So the floor names real keys from three different
 * depths and holds the total against a number the app is well past. Without these lines the
 * comparison below proves that two things are equal and nothing about what they are.
 */
it('walks both resource files deeply enough for the comparison below to mean anything', () => {
  expect(EN_KEYS).toContain('dives.title');
  expect(EN_KEYS).toContain('count.dives');
  expect(EN_KEYS).toContain('vocabulary.entry.shore');
  expect(EN_KEYS).toContain('date.month.aug');
  expect(EN_KEYS.length).toBeGreaterThan(100);
  expect(CS_KEYS.length).toBe(EN_KEYS.length);
});

it('gives every English key a Czech one', () => {
  expect(CS_KEYS.filter((key) => !EN_KEYS.includes(key))).toEqual([]);
  expect(EN_KEYS.filter((key) => !CS_KEYS.includes(key))).toEqual([]);
});

/**
 * **And the comparison above can fail**, which is the half a parity test never demonstrates
 * about itself. A key removed from one side has to show up as a difference; if `keyPaths`
 * flattened wrongly, or the plural stripping ate a real key, the test above would be green over
 * two identical mistakes.
 */
it('reports a key that exists on only one side', () => {
  const shortened = { ...cs.translation, dives: { ...cs.translation.dives, title: undefined } };
  expect(EN_KEYS.filter((key) => !keySet(shortened).includes(key))).toEqual(['dives.title']);
});

// ---------------------------------------------------------------------------------------
// Czech has four plural forms, and this is the reason the milestone exists
// ---------------------------------------------------------------------------------------

/**
 * The dependency the four forms actually rest on. i18next picks a plural category through
 * `Intl.PluralRules`, and on a runtime built without ICU it silently answers `other` for every
 * count — which reads as *5 ponory* for one dive, in Czech, with nothing failing anywhere.
 * Pinned so the failure is a red test rather than a screenshot.
 */
it('has a plural rule for Czech at all', () => {
  const rule = new Intl.PluralRules('cs');
  expect([rule.select(1), rule.select(3), rule.select(1.5), rule.select(5)]).toEqual([
    'one',
    'few',
    'many',
    'other',
  ]);
});

/**
 * **The test the whole task is for.** English needs one comparison and Czech needs four
 * branches: 1 ponor, 2–4 ponory, a fraction is 1,5 ponoru, and 0 or 5-and-up is ponorů.
 *
 * Asserted at four counts rather than at one, because a test that renders a single Czech string
 * proves the key resolved and says nothing at all about the rule — `formatDiveCount` under
 * English's own two-form rule would produce *5 ponory* here and pass any test that only looked
 * at 1 and 2.
 */
it('declines a dive count through all four Czech forms', () => {
  setActiveLanguage('cs');
  expect(formatDiveCount(1)).toBe('1 ponor');
  expect(formatDiveCount(2)).toBe('2 ponory');
  expect(formatDiveCount(4)).toBe('4 ponory');
  expect(formatDiveCount(1.5)).toBe('1,5 ponoru');
  expect(formatDiveCount(5)).toBe('5 ponorů');
  expect(formatDiveCount(0)).toBe('0 ponorů');
});

/**
 * The same rule stated as an inequality, so it cannot be satisfied by four keys that happen to
 * hold the same word. Under English's two-form rule `few` and `other` are one branch, which is
 * exactly the failure this milestone exists to prevent.
 */
it('does not give 2–4 and 5-and-up the same Czech word', () => {
  setActiveLanguage('cs');
  expect(formatDiveCount(2)).not.toBe(formatDiveCount(5));
  expect(formatDiveCount(1)).not.toBe(formatDiveCount(2));
  expect(formatDiveCount(1.5)).not.toBe(formatDiveCount(1));
});

/** English is unchanged by any of it — two forms, split on 1, exactly as the app shipped. */
it('leaves English on its own two forms', () => {
  expect(formatDiveCount(1)).toBe('1 dive');
  expect(formatDiveCount(2)).toBe('2 dives');
  expect(formatDiveCount(5)).toBe('5 dives');
  expect(formatDiveCount(0)).toBe('0 dives');
});

/** §7.5's pending indicator declines its verb as well as its noun — *změna čeká* against
 * *změny čekají* — which a two-form language never has to think about. */
it('declines the pending-changes line through all four forms', () => {
  setActiveLanguage('cs');
  expect(formatPendingChanges(1)).toBe('1 změna čeká na synchronizaci');
  expect(formatPendingChanges(3)).toBe('3 změny čekají na synchronizaci');
  expect(formatPendingChanges(5)).toBe('5 změn čeká na synchronizaci');
  expect(formatPendingChanges(3)).not.toBe(formatPendingChanges(5));
});

/** §3's currency, whose Czech is instrumental after *před* and therefore a different set of
 * endings again. */
it('declines “days ago” through all four forms', () => {
  setActiveLanguage('cs');
  expect(formatDaysSince(1)).toBe('Včera');
  expect(formatDaysSince(2)).toBe('před 2 dny');
  expect(formatDaysSince(5)).toBe('před 5 dny');
  expect(formatDaysSince(0)).toBe('Dnes');
});

/**
 * **The rule the `figure` formatter can be forgotten at**, so it is checked rather than
 * remembered. A template writing a bare `{{count}}` interpolates through `String(value)`, which
 * renders a Czech fraction as *1.5 ponoru* — the right word beside an English decimal point,
 * on the one plural form a Czech `many` exists for. There is nothing at any one template to
 * make that visible, so the whole set is swept.
 */
it.each([
  ['en', en],
  ['cs', cs],
])('spells every interpolated count as a figure in %s', (_language, resource) => {
  const strings = allStrings(resource.translation);
  expect(strings.filter((line) => line.includes('{{count, figure}}')).length).toBeGreaterThan(5);
  expect(strings.filter((line) => /\{\{count\}\}/u.test(line))).toEqual([]);
});

/** Every string in a resource tree, for the sweeps above and below. */
function allStrings(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  return Object.values(node).flatMap(allStrings);
}

// ---------------------------------------------------------------------------------------
// §1: never block
// ---------------------------------------------------------------------------------------

/**
 * A string the active language does not hold renders the English one, never a blank and never
 * the key. The parity test above means the app cannot currently reach this — which is exactly
 * why the mechanism is proved with a key added at runtime rather than left to be discovered by
 * the first diver who hits it.
 */
it('falls back to English rather than to a blank when Czech has no word', () => {
  i18next.addResource('en', 'translation', 'probe.onlyInEnglish', 'Only in English');
  setActiveLanguage('cs');
  expect(i18next.t('probe.onlyInEnglish')).toBe('Only in English');
});

/**
 * **No vocabulary value renders as its own key**, in either language — the one failure mode
 * translating `format/display.ts`'s `capitalize` family introduced. i18next answers a missing
 * key with the key itself, so a mistyped or forgotten vocabulary entry would put the literal
 * text `vocabulary.suit.semidry` on a dive detail, and every existing test would still pass
 * because none of them asserts that word.
 */
it.each(LANGUAGES)('resolves every vocabulary word in %s', (language) => {
  setActiveLanguage(language);
  const keys = EN_KEYS.filter((key) => key.startsWith('vocabulary.'));
  expect(keys.length).toBeGreaterThan(30);
  for (const key of keys) {
    const value = i18next.t(key);
    expect(value).not.toBe(key);
    expect(value).not.toBe('');
  }
});

// ---------------------------------------------------------------------------------------
// The preference, the device, and what each option is called
// ---------------------------------------------------------------------------------------

it('offers the device alongside both languages, in that order', () => {
  expect(LANGUAGE_PREFERENCES).toEqual(['system', 'en', 'cs']);
});

it('accepts only a preference this build has', () => {
  expect(isLanguagePreference('cs')).toBe(true);
  expect(isLanguagePreference('system')).toBe(true);
  // A language a future build might offer, and the two shapes a `text` column can hand back.
  expect(isLanguagePreference('de')).toBe(false);
  expect(isLanguagePreference(undefined)).toBe(false);
  expect(isLanguagePreference('')).toBe(false);
});

/** `__mocks__/expo-localization.js` pins the device to English for the whole suite; what is
 * asserted here is that the resolution reads it at all. */
it('resolves the device preference through the phone and the other two through themselves', () => {
  expect(deviceLanguage()).toBe('en');
  expect(resolveLanguage('system')).toBe('en');
  expect(resolveLanguage('cs')).toBe('cs');
  expect(resolveLanguage('en')).toBe('en');
});

/**
 * A language is named in itself, and that is the row's one rule: a diver who has landed in a
 * language they cannot read has to be able to find the way out. So *Čeština* stays *Čeština*
 * on an English screen, and *English* stays *English* on a Czech one — only *Device* moves.
 */
it('names each language in itself and translates only the device option', () => {
  expect(languageLabel('en')).toBe('English');
  expect(languageLabel('cs')).toBe('Čeština');
  expect(languageLabel('system')).toBe('Device');
  setActiveLanguage('cs');
  expect(languageLabel('en')).toBe('English');
  expect(languageLabel('cs')).toBe('Čeština');
  expect(languageLabel('system')).toBe('Zařízení');
});

it('changes the active language, and reports it', () => {
  expect(activeLanguage()).toBe('en');
  setActiveLanguage('cs');
  expect(activeLanguage()).toBe('cs');
  expect(t('dives.title')).toBe('Ponory');
});

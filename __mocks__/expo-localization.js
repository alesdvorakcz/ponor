/**
 * The device's locale, pinned to English for the whole suite.
 *
 * `src/i18n/index.ts` calls `getLocales()` while it initialises, so without this the language
 * every test starts in would be whatever the machine running it is set to — and this project's
 * owner is Czech. Half the suite asserts English strings; that is correct, because `en.ts` is
 * the app rather than a translation of it, and those assertions must not depend on a laptop.
 *
 * A root `__mocks__/` file for a node_modules package is applied automatically, without a
 * `jest.mock()` call in each test — the same arrangement `expo-sqlite` and `react-native-maps`
 * already use here. A test that wants Czech asks for it explicitly (`setActiveLanguage('cs')`),
 * which is the honest way round: the language under test is stated in the test.
 */
module.exports = {
  getLocales: () => [
    { languageCode: 'en', languageTag: 'en-US', regionCode: 'US', textDirection: 'ltr' },
  ],
};

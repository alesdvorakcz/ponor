import { cleanup, render } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';

import { useLanguagePreference } from '../db/useLanguage';
import { LanguageSync } from './LanguageSync';
import { activeLanguage, setActiveLanguage } from './index';

// The stored preference, mocked per module exactly as every screen test in this repo mocks its
// live reads: it is a database read, and this component must be renderable against any of the
// three preferences without one.
jest.mock('../db/useLanguage', () => ({ useLanguagePreference: jest.fn() }));
// **The phone's own locale, replaced here rather than spied on.** The root
// `__mocks__/expo-localization.js` pins the whole suite to English, which is what every other
// file wants; this file is the one that has to say what happens on a Czech phone, and a
// `jest.spyOn` on the namespace import cannot do it — a CJS manual mock has no `__esModule`,
// so `import * as` hands back a COPY and the spy lands on an object `src/i18n` never reads.
// Measured: the spy version reported English and the mutation it was written to kill survived.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', languageTag: 'en-US' }]),
}));

const mockUseLanguagePreference = useLanguagePreference as jest.Mock;
const mockGetLocales = getLocales as jest.Mock;

afterEach(async () => {
  await cleanup();
  // The device goes back to English before the language does, so the restore below resolves
  // against the file's own default rather than against whatever a test reported.
  mockGetLocales.mockImplementation(() => [{ languageCode: 'en', languageTag: 'en-US' }]);
  setActiveLanguage('en');
  mockUseLanguagePreference.mockReset();
});

/**
 * **The one wire between §3's Settings row and the app being in that language.** Everything
 * else in this milestone is either a resource file or a lookup; this is the piece that would
 * leave a diver pressing *Čeština* and watching nothing happen, with every other test green.
 */
it('puts the app into the stored language', async () => {
  mockUseLanguagePreference.mockImplementation(() => 'cs');
  await render(<LanguageSync />);
  expect(activeLanguage()).toBe('cs');
});

/**
 * **`'system'` is resolved through the phone rather than handed to i18next**, and the Czech
 * device is what makes this test able to fail.
 *
 * On an English device it cannot: `supportedLngs` quietly turns an unknown code into the
 * fallback, so `changeLanguage('system')` lands on English too and a component that skipped
 * `resolveLanguage` would pass. Measured, not assumed — that mutation survived until this test
 * reported the device as Czech, which is also the direction a diver would actually notice:
 * their phone is Czech, they have chosen nothing, and the app must not be English.
 */
it('follows the device when the diver has expressed no preference', async () => {
  mockGetLocales.mockImplementation(() => [{ languageCode: 'cs', languageTag: 'cs-CZ' }]);
  mockUseLanguagePreference.mockImplementation(() => 'system');
  await render(<LanguageSync />);
  expect(activeLanguage()).toBe('cs');
});

/** And the same resolution the other way, so this is not one hard-wired answer. */
it('follows an English device the same way', async () => {
  setActiveLanguage('cs');
  mockUseLanguagePreference.mockImplementation(() => 'system');
  await render(<LanguageSync />);
  expect(activeLanguage()).toBe('en');
});

it('draws nothing — it is a subscription, not a screen', async () => {
  mockUseLanguagePreference.mockImplementation(() => 'en');
  const t = await render(<LanguageSync />);
  expect(t.toJSON()).toBeNull();
});

/**
 * A preference that changes after the first render has to reach the app too: this component is
 * mounted for the app's whole life, and the diver's own press is the ordinary case rather than
 * the exceptional one.
 */
it('follows the preference when it changes under it', async () => {
  mockUseLanguagePreference.mockImplementation(() => 'en');
  const t = await render(<LanguageSync />);
  expect(activeLanguage()).toBe('en');

  mockUseLanguagePreference.mockImplementation(() => 'cs');
  await t.rerender(<LanguageSync />);
  expect(activeLanguage()).toBe('cs');
});

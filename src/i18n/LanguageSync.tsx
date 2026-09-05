import { useEffect } from 'react';

import { useLanguagePreference } from '../db/useLanguage';
import { resolveLanguage, setActiveLanguage } from './index';

/**
 * **The one place the stored preference becomes the app's language**, mounted in the root
 * layout beside `SyncTriggers` and drawing nothing — the same shape, for the same reason: it
 * is a subscription that has to exist for the app's whole life and belongs above every screen
 * rather than inside one.
 *
 * `src/i18n/index.ts` starts the app in the DEVICE's language, so a diver who has never opened
 * Settings is already right before this runs and this component does nothing at all for them.
 * What it exists for is the diver who chose otherwise: their row lands a few frames later and
 * this puts the app where they asked. Those few frames are a real, accepted cost — a Czech
 * phone whose owner picked English shows Czech until the read returns — and the alternative was
 * blocking the first render on a settings read, which §1 rules out for the logbook and there is
 * no reason to spend here.
 *
 * An effect rather than a call during render, because `changeLanguage` notifies every
 * subscribed component and starting a render pass from inside one is the loop this codebase has
 * already paid for once (`stubDives`, DiveFormScreen.test.tsx).
 */
export function LanguageSync() {
  const language = resolveLanguage(useLanguagePreference());
  useEffect(() => {
    setActiveLanguage(language);
  }, [language]);
  return null;
}

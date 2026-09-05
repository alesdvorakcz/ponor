import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { type LanguagePreference } from '../i18n';
import { db } from './client';
import { languageQuery, readLanguage } from './settings';

/**
 * The diver's chosen language (DESIGN.md §3), live — `useUnitSystem`'s exact shape one file
 * over, and for its exact reasons: its own hook rather than a field on another read, because a
 * failed settings read must never be able to blank a logbook, and separate hooks are the
 * strongest form of that separation rather than a stated one.
 *
 * **It returns the PREFERENCE, not the language.** `'system'` is a real answer and the default
 * one — §3 makes the device's locale what a diver who has never opened Settings gets — and the
 * two callers want different halves of it: the Settings row draws the diver's choice (so it
 * must be able to show *Device* as chosen), and `LanguageSync` resolves it against the phone.
 * A hook that returned the resolved language would make the chips unable to say which of the
 * three is selected.
 *
 * **No `resolved` field**, on `useUnitSystem`'s argued position rather than by omission:
 * `readLanguage` degrades an absent row to `'system'`, which is a convention standing in for a
 * preference nobody has expressed, so there is nothing a caller would do differently while it
 * waits and no false sentence for it to say. The one thing a late answer costs is a repaint —
 * a diver who has chosen English on a Czech phone sees Czech for the frames before the row
 * lands — which is a flicker rather than the destroyed input `useDivesBefore`'s own `resolved`
 * field exists to prevent.
 */
export function useLanguagePreference(): LanguagePreference {
  const rows = useLiveQuery(languageQuery(db));
  return readLanguage(rows.data);
}

import { tokens, type ColorScheme, type ThemeTokens } from './tokens';

export type SchemePreference = ColorScheme | 'system';

/**
 * Whatever the OS reports. React Native 0.86's `useColorScheme()` returns
 * `'unspecified'` when the platform has no preference — it does not return
 * null, though `Appearance.getColorScheme()` still can.
 */
export type SystemScheme = ColorScheme | 'unspecified' | null | undefined;

/**
 * Which scheme the app should render in. Ponor is dark-first, so anything that
 * is not an explicit light or dark preference resolves to dark.
 */
export function resolveScheme(
  systemScheme: SystemScheme,
  override?: SchemePreference,
): ColorScheme {
  if (override && override !== 'system') return override;
  if (systemScheme === 'light' || systemScheme === 'dark') return systemScheme;
  return 'dark';
}

export function themeFor(scheme: ColorScheme): ThemeTokens {
  return tokens[scheme];
}

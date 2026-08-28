import { tokens, type ColorScheme, type ThemeTokens } from './tokens';

export type SchemePreference = ColorScheme | 'system';

/**
 * Which scheme the app should render in. Ponor is dark-first, so when the OS
 * reports no preference we choose dark rather than light.
 */
export function resolveScheme(
  systemScheme: ColorScheme | null | undefined,
  override?: SchemePreference,
): ColorScheme {
  if (override && override !== 'system') return override;
  return systemScheme ?? 'dark';
}

export function themeFor(scheme: ColorScheme): ThemeTokens {
  return tokens[scheme];
}

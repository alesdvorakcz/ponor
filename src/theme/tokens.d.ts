export type ColorScheme = 'light' | 'dark';

export interface ThemeTokens {
  bg: string;
  surface: string;
  border: string;
  fg: string;
  fgMuted: string;
  action: string;
  actionFg: string;
}

/**
 * Fixed-length tuples, not `string[]` / `number[]`, so `depth.ts` can prove its
 * lookups are in range instead of casting. N limits cut the depth range into
 * N+1 bands, so the scale must carry exactly one more entry than the limits —
 * `depth.ts` asserts that relationship at compile time and `depth.test.ts`
 * asserts it against the real `tokens.js` at runtime, since this file is a
 * hand-written declaration and cannot check the data on its own.
 *
 * Getting it wrong is silent: React Native renders `color: undefined` as the
 * default text colour without throwing, so a mismatched palette would break
 * DESIGN.md §0.1's "colour is depth, and colour is nothing else" with no crash
 * and no error anywhere.
 */
export type DepthBandLimits = readonly [number, number, number, number, number];
export type DepthScale = readonly [string, string, string, string, string, string];

export declare const tokens: Record<ColorScheme, ThemeTokens>;
export declare const depthScale: Record<ColorScheme, DepthScale>;
export declare const depthBandLimits: DepthBandLimits;
export declare const fonts: Record<string, string>;

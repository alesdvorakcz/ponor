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

export declare const tokens: Record<ColorScheme, ThemeTokens>;
export declare const depthScale: Record<ColorScheme, string[]>;
export declare const depthBandLimits: number[];

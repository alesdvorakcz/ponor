// The single source of truth for Ponor's colour. See DESIGN.md §0.1 and §0.2.
// Consumed by the app through tokens.d.ts, by app.config.ts, and by the plain-Node
// build scripts (build-theme-css.mjs, build-icons.mjs) which cannot require TypeScript.

/** Upper bound in metres for depth bands 1-5. Band 6 is everything deeper. */
const depthBandLimits = [6, 12, 20, 30, 40];

/**
 * Depth colours, band 1 (shallowest) to band 6 (deepest).
 * The sequence follows the order in which water removes colour, so the scale
 * carries meaning. Colour encodes depth and nothing else - never use these
 * for chrome, controls or state.
 */
const depthScale = {
  dark: ['#FF6B4A', '#FF9F43', '#F5CE3E', '#3FCB94', '#2E9BE0', '#6673E4'],
  light: ['#E04A28', '#C2600A', '#8F7000', '#0E9F6E', '#0B76B8', '#3A49C0'],
};

const tokens = {
  dark: {
    bg: '#080B0F',
    surface: '#111820',
    border: '#212D38',
    fg: '#F0F5F8',
    fgMuted: '#7C8D9A',
    action: '#F0F5F8',
    actionFg: '#080B0F',
  },
  light: {
    bg: '#EDEEEA',
    surface: '#FFFFFF',
    border: '#CDD3CC',
    fg: '#0D1216',
    fgMuted: '#5A6670',
    action: '#0D1216',
    actionFg: '#EDEEEA',
  },
};

/**
 * Native font families. React Native does not synthesise weights, so each
 * weight is its own family. Names are prefixed to avoid colliding with
 * Tailwind's font-weight utilities: `--font-bold` would clash with `font-bold`.
 */
const fonts = {
  sans: 'Archivo_400Regular',
  'sans-medium': 'Archivo_500Medium',
  'sans-semibold': 'Archivo_600SemiBold',
  'sans-bold': 'Archivo_700Bold',
  mono: 'IBMPlexMono_400Regular',
  'mono-medium': 'IBMPlexMono_500Medium',
  'mono-semibold': 'IBMPlexMono_600SemiBold',
};

module.exports = { tokens, depthScale, depthBandLimits, fonts };

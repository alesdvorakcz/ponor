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
 *
 * M1c closing fixes: 'mono-semibold' removed. Commit 295d9f6 (the design pass) switched
 * depthValue from mono-semibold to mono-medium, which removed its last consumer in
 * styles.ts — but the .ttf kept shipping in the binary via app.config.ts's font list for
 * nothing. Three coordinated edits removed it (this map, fonts.ts's iosFonts, and
 * app.config.ts's font list) because fonts.test.ts asserts the iOS/Android key sets stay
 * in parity.
 */
const fonts = {
  sans: 'Archivo_400Regular',
  'sans-medium': 'Archivo_500Medium',
  'sans-semibold': 'Archivo_600SemiBold',
  'sans-bold': 'Archivo_700Bold',
  mono: 'IBMPlexMono_400Regular',
  'mono-medium': 'IBMPlexMono_500Medium',
};

/**
 * The `.ttf` behind each family name above, **derived from that map rather than listed a
 * second time**. `app.config.ts` feeds these paths to expo-font's config plugin, which is
 * what puts the faces in the native binary.
 *
 * It used to be a hand-written array of six paths in `app.config.ts`, sitting beside a
 * hand-written map of six names here, with nothing tying them together — §4.1's defining
 * defect ("one rule written in two places, then drifting"), and the exact pair that already
 * needed "three coordinated edits" when `mono-semibold` was dropped in M1c. There is now one
 * list of faces in this file and everything else reads it.
 *
 * The derivation is @expo-google-fonts' own file layout, which is mechanical:
 * `Archivo_500Medium` lives at `@expo-google-fonts/archivo/500Medium/Archivo_500Medium.ttf`,
 * i.e. `<package>/<variant>/<name>.ttf`, where the package name is the family in kebab-case
 * (`IBMPlexMono` -> `ibm-plex-mono`, acronym and all). A family that ever broke that
 * convention would produce a path that does not exist, and the config plugin fails the build
 * on a missing font file — loud, at build time, not a silent fallback to San Francisco.
 *
 * Names, not paths, stay the source of truth because the names are what the app renders
 * with (`fonts.ts`, `styles.ts`) and what the browser must register (`loadFonts.web.ts`);
 * the path is only how one platform's packager finds the bytes.
 */
const fontFiles = Object.fromEntries(
  [...new Set(Object.values(fonts))].map((name) => {
    const [family, variant] = name.split('_');
    const pkg = family
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
      .toLowerCase();
    return [name, `./node_modules/@expo-google-fonts/${pkg}/${variant}/${name}.ttf`];
  }),
);

module.exports = { tokens, depthScale, depthBandLimits, fonts, fontFiles };

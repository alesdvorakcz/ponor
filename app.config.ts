import type { ExpoConfig } from 'expo/config';
import { fontFiles, tokens } from './src/theme/tokens';

const config: ExpoConfig = {
  name: 'Ponor',
  slug: 'ponor',
  scheme: 'ponor',
  version: '0.1.0',
  orientation: 'portrait',
  // Lets the OS drive light/dark. Without this iOS pins the app to light and
  // the M0 done-when cannot pass.
  userInterfaceStyle: 'automatic',
  ios: { supportsTablet: true, bundleIdentifier: 'app.ponor.mobile' },
  icon: './assets/images/icon.png',
  android: {
    package: 'app.ponor.mobile',
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: tokens.dark.bg,
    },
  },
  plugins: [
    'expo-router',
    // The six .ttf paths are DERIVED from tokens.js's `fonts` map (see `fontFiles` there),
    // not listed again here: this array and that map have to agree, and until now nothing
    // made them. Same six files as before, in the same order — checked against the array
    // this replaced. expo-font's config plugin is native-only, so this embeds the faces in
    // the iOS/Android binary and does nothing at all for web, which registers the same list
    // at runtime instead (src/theme/loadFonts.web.ts).
    ['expo-font', { fonts: Object.values(fontFiles) }],
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: tokens.dark.bg,
        dark: { backgroundColor: tokens.dark.bg },
      },
    ],
  ],
  experiments: { typedRoutes: true },
};

export default config;

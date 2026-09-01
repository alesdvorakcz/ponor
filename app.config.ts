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
    // Asked for by `npx expo install expo-secure-store`, and it earns its line on Android.
    // The plugin points `android:fullBackupContent` and `android:dataExtractionRules` at
    // expo-secure-store's own XML rules, which EXCLUDE its store from Android Auto Backup.
    // Without that, a backup taken on one device is restored onto another, carrying encrypted
    // session blobs whose Keystore keys did not come with them — values that exist, cannot be
    // decrypted, and are not absent either. A restored phone would hold a session Supabase can
    // neither use nor cleanly discard. Nothing here is iOS-facing: the Face ID usage string
    // the plugin can add is only emitted when `faceIDPermission` is passed, and
    // `cloud/sessionStore.ts` deliberately leaves `requireAuthentication` off.
    //
    // It is a NATIVE config change, so it lands only at the next prebuild + dev-client build.
    'expo-secure-store',
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

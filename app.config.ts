import type { ExpoConfig } from 'expo/config';
import { tokens } from './src/theme/tokens';

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
    [
      'expo-font',
      {
        fonts: [
          './node_modules/@expo-google-fonts/archivo/400Regular/Archivo_400Regular.ttf',
          './node_modules/@expo-google-fonts/archivo/500Medium/Archivo_500Medium.ttf',
          './node_modules/@expo-google-fonts/archivo/600SemiBold/Archivo_600SemiBold.ttf',
          './node_modules/@expo-google-fonts/archivo/700Bold/Archivo_700Bold.ttf',
          './node_modules/@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf',
          './node_modules/@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf',
          './node_modules/@expo-google-fonts/ibm-plex-mono/600SemiBold/IBMPlexMono_600SemiBold.ttf',
        ],
      },
    ],
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

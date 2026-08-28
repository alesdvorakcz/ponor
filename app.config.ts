import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Ponor',
  slug: 'ponor',
  scheme: 'ponor',
  version: '0.1.0',
  orientation: 'portrait',
  // Lets the OS drive light/dark. Without this iOS pins the app to light and
  // the M0 done-when cannot pass.
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: { supportsTablet: true, bundleIdentifier: 'app.ponor.mobile' },
  android: {
    package: 'app.ponor.mobile',
    // @ts-expect-error -- edgeToEdgeEnabled is a real Expo SDK 57 android
    // config field, but @expo/config-types@57.0.2 hasn't typed it yet
    // (upstream lag). Remove this suppression once the types catch up.
    edgeToEdgeEnabled: true,
  },
  plugins: ['expo-router'],
  experiments: { typedRoutes: true },
};

export default config;

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
  ios: { supportsTablet: true, bundleIdentifier: 'app.ponor.mobile' },
  android: { package: 'app.ponor.mobile' },
  plugins: ['expo-router'],
  experiments: { typedRoutes: true },
};

export default config;

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
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.ponor.mobile',
    infoPlist: {
      // **Answers App Store Connect's export-compliance question once, here, instead of on
      // every submission.** `false` means "uses no NON-exempt encryption", which is what is
      // true of this app: the only cryptography it involves is HTTPS to Supabase and the
      // platform keychain behind `expo-secure-store`, and both are exempt uses. Declaring it
      // in the binary is what stops TestFlight holding each build at "Missing Compliance"
      // until someone answers the same question by hand again.
      //
      // It is a claim about the app rather than a convenience, so it stops being true the day
      // Ponor ships its own cryptography — encrypting an export, say, or anything on the §9
      // shelf that protects data itself rather than the pipe it travels down.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
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
    // §4's `expo-localization`, asked for by `npx expo install`. It is a native config change
    // rather than a runtime one: the plugin declares the locales the binary claims to support,
    // which is what stops iOS handing the app a locale it has no strings for. `src/i18n/`
    // reduces whatever it gets to `en` or `cs` regardless, so this lands at the next prebuild
    // and nothing waits on it.
    'expo-localization',
    // §2.3's "use my location — pressed right on the boat", which is the ONLY way a dive gets a
    // GPS pin now that M1i took the two coordinate keypads off the form (§2.2) — and since issue
    // #19 two more presses ask: *Use current position* on the new-site/centre page (a stored
    // position for the new place) and the picker's *Near me* (a list of places near you; nothing
    // stored). The string is what iOS shows in the permission sheet, and it is the app's own
    // sentence rather than the library's default: a diver deciding whether to grant this is
    // entitled to know it is for a tap they make, not a background trail — so it names all three.
    // English only: this config declares no per-locale InfoPlist strings. Foreground only — no
    // `isAndroidBackgroundLocationEnabled`, no always-authorisation — because §1's "works at sea"
    // is about the logbook working offline, not about the app watching where the boat goes.
    //
    // A NATIVE config change: the new sentence reaches the permission sheet only with the next
    // prebuild + dev-client build.
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Ponor uses your location only when you ask: to pin a dive or a new dive site or centre where you are, or to list places near you.',
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
  // The EAS project this app builds under (expo.dev/accounts/alesdvorakcz/projects/ponor).
  // Written here by hand because `eas init` cannot write into a dynamic config — it prints the
  // id and stops. `owner` pins builds to the personal account: an Expo login can belong to
  // more than one account, and a build that silently lands in the wrong one is a build signed
  // with the wrong Apple team.
  owner: 'alesdvorakcz',
  extra: { eas: { projectId: '3efbfc6f-aa73-44bb-9e1d-7c3880bba3cc' } },
};

export default config;

import { Platform } from 'react-native';

import { fonts as androidFonts } from './tokens';

/**
 * Platform layer over tokens.js's `fonts` map.
 *
 * expo-font's config plugin never registers the @expo-google-fonts file names
 * (`Archivo_400Regular`, ...) as usable font names on iOS. Its Android half
 * (withFontsAndroid.js) copies each .ttf under its original file name, which is
 * exactly what RN Android resolves against — so tokens.js's `fonts` map (the
 * file names) is correct as-is for Android, and stays the config-plugin source
 * of truth. Its iOS half (withFontsIos.js) only adds the .ttf to the Xcode
 * Resources phase and lists the file name in `UIAppFonts`; the alias that maps
 * that file name to a usable font name (`FontFamilyAliasManager.setAlias`) is
 * only ever set from the `useFonts` runtime-loading hook, which this app does
 * not call. Without it, RN's RCTFont looks up the file name, finds nothing, and
 * silently falls back to San Francisco. iOS instead needs the PostScript name
 * (the font's `name` table, id 6) that each face actually registers itself
 * under, decoded straight from the embedded .ttf files.
 *
 * PostScript names, not family names: RN does not synthesise a weight within a
 * family, and Archivo Medium/SemiBold each register under their own family
 * (`Archivo Medium`, `Archivo SemiBold`) rather than `Archivo` plus a weight —
 * so a family+fontWeight lookup would never reach them. A PostScript name
 * addresses one face unambiguously and sidesteps that entirely.
 */
// M1c closing fixes: 'mono-semibold' removed — see tokens.js's own `fonts` map comment for
// why (its last consumer, depthValue, moved to mono-medium in 295d9f6). Removed here too,
// not just there, because fonts.test.ts asserts these two maps carry the identical key set.
export const iosFonts: Record<string, string> = {
  sans: 'Archivo-Regular',
  'sans-medium': 'Archivo-Medium',
  'sans-semibold': 'Archivo-SemiBold',
  'sans-bold': 'Archivo-Bold',
  mono: 'IBMPlexMono-Regular',
  'mono-medium': 'IBMPlexMono-Medium',
};

export const fonts = Platform.OS === 'ios' ? iosFonts : androidFonts;

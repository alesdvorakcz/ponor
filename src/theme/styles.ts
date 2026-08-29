import { StyleSheet } from 'react-native';

import { themeFor } from './resolve';
import { fonts, type ColorScheme } from './tokens';

/**
 * Builds this scheme's StyleSheet from the design tokens.
 *
 * A screen calls `makeStyles(scheme)` once per render and reads named styles off the
 * result — it never writes a colour or font-family literal itself. Every value in here
 * traces back to `theme` (from tokens.js by way of resolve.ts) or `fonts` (tokens.js),
 * so this module is the single place those two things are allowed to meet a style
 * property. That indirection is what makes the design system's delivery mechanism
 * swappable — StyleSheet today, something else tomorrow — without ever touching a
 * screen or its colours.
 *
 * A colour that depends on more than the theme (the depth scale, which also depends on
 * the depth value) does not live here — see `depthColor` in ./depth. It still only
 * reads from tokens, so the same rule holds; it just cannot be precomputed per-scheme.
 */
export function makeStyles(scheme: ColorScheme) {
  const theme = themeFor(scheme);

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    content: {
      padding: 20,
      gap: 24,
    },
    header: {
      gap: 4,
      paddingTop: 48,
    },
    eyebrow: {
      fontFamily: fonts.mono,
      fontSize: 11,
      letterSpacing: 3,
      color: theme.fgMuted,
    },
    wordmark: {
      fontFamily: fonts['sans-bold'],
      fontSize: 36,
      letterSpacing: 6,
      color: theme.fg,
    },
    subtitle: {
      fontFamily: fonts.sans,
      fontSize: 16,
      color: theme.fgMuted,
    },
    section: {
      gap: 8,
    },
    sectionLabel: {
      fontFamily: fonts.mono,
      fontSize: 11,
      letterSpacing: 2,
      color: theme.fgMuted,
    },
    depthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    depthBandLabel: {
      fontFamily: fonts['sans-semibold'],
      fontSize: 16,
      color: theme.fg,
    },
    // Colour is intentionally absent: depth colour depends on the depth, not just the
    // scheme, so the caller composes this with `{ color: depthColor(metres, scheme) }`.
    depthValue: {
      fontFamily: fonts['mono-semibold'],
      fontSize: 18,
      fontVariant: ['tabular-nums'],
    },
    typeSans: {
      fontFamily: fonts.sans,
      fontSize: 18,
      color: theme.fg,
    },
    typeSansMedium: {
      fontFamily: fonts['sans-medium'],
      fontSize: 18,
      color: theme.fg,
    },
    typeSansSemibold: {
      fontFamily: fonts['sans-semibold'],
      fontSize: 18,
      color: theme.fg,
    },
    typeSansBold: {
      fontFamily: fonts['sans-bold'],
      fontSize: 18,
      color: theme.fg,
    },
    typeMono: {
      fontFamily: fonts.mono,
      fontSize: 16,
      color: theme.fg,
    },
    typeMonoMedium: {
      fontFamily: fonts['mono-medium'],
      fontSize: 16,
      color: theme.fg,
    },
    typeMonoSemibold: {
      fontFamily: fonts['mono-semibold'],
      fontSize: 16,
      color: theme.fg,
    },
    action: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: theme.action,
      paddingHorizontal: 20,
    },
    actionLabel: {
      fontFamily: fonts['sans-bold'],
      fontSize: 16,
      color: theme.actionFg,
    },
  });
}

export type Styles = ReturnType<typeof makeStyles>;

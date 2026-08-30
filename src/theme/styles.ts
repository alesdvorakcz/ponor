import { StyleSheet } from 'react-native';

import { fonts } from './fonts';
import { themeFor } from './resolve';
import { type ColorScheme } from './tokens';

/**
 * Builds this scheme's StyleSheet from the design tokens.
 *
 * A screen calls `makeStyles(scheme)` once per render and reads named styles off the
 * result — it never writes a colour or font-family literal itself. Every value in here
 * traces back to `theme` (from tokens.js by way of resolve.ts) or `fonts` (tokens.js's
 * font map, by way of fonts.ts's per-platform naming), so this module is the single
 * place those two things are allowed to meet a style property. That indirection is
 * what makes the design system's delivery mechanism swappable — StyleSheet today,
 * something else tomorrow — without ever touching a screen or its colours.
 *
 * A colour that depends on more than the theme (the depth scale, which also depends on
 * the depth value) does not live here — see `depthColor` in ./depth. It still only
 * reads from tokens, so the same rule holds; it just cannot be precomputed per-scheme.
 *
 * Only two schemes exist, so both sheets are built once at module scope (below) and
 * `makeStyles` just selects between them. Building fresh on every call would hand out a
 * new object identity each render — harmless with two screens, but it would defeat
 * `React.memo` on every styled row once a long list depends on this, since a new
 * `styles` prop reference looks like a change even when nothing did. Callers still get
 * to treat `makeStyles(scheme)` as a per-render call; only this module needs to know it
 * is actually a cache lookup.
 */
function build(scheme: ColorScheme) {
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
    // DiveRow (§3: "row = number, site, depth · time chips, rating"). §0.5's tap-target
    // floor applies to the row as a whole, not just its icon-sized controls, hence
    // minHeight here rather than on some inner element.
    diveRow: {
      minHeight: 48,
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    diveRowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    diveRowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    diveNumber: {
      fontFamily: fonts.mono,
      fontSize: 14,
      color: theme.fgMuted,
      fontVariant: ['tabular-nums'],
    },
    diveSite: {
      flex: 1,
      fontFamily: fonts.sans,
      fontSize: 16,
      color: theme.fg,
    },
    // Shared by the time-range chip and the duration chip.
    diveChip: {
      fontFamily: fonts.mono,
      fontSize: 13,
      color: theme.fgMuted,
      fontVariant: ['tabular-nums'],
    },
    diveRating: {
      fontFamily: fonts.sans,
      fontSize: 13,
      color: theme.fg,
      letterSpacing: 1,
    },
  });
}

const sheets = { light: build('light'), dark: build('dark') };

export function makeStyles(scheme: ColorScheme) {
  return sheets[scheme];
}

export type Styles = ReturnType<typeof makeStyles>;

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
      paddingTop: 48,
    },
    // The Dives screen's search box (DESIGN.md §3). §0.5's 48 dp tap-target
    // floor applies to it too — a diver focusing search with wet hands
    // benefits from the same generous target as any button.
    searchInput: {
      minHeight: 48,
      marginHorizontal: 20,
      marginBottom: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      fontFamily: fonts.sans,
      fontSize: 16,
      color: theme.fg,
    },
    // SectionList's contentContainerStyle. The bottom padding keeps the last
    // row from ever sitting behind the floating `fab` button.
    listContent: {
      paddingBottom: 96,
    },
    // Shared by every full-screen message state: the read error, and a
    // search that matched nothing.
    centerFill: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 12,
    },
    messageText: {
      fontFamily: fonts.sans,
      fontSize: 16,
      color: theme.fgMuted,
      textAlign: 'center',
    },
    // TripHeader — the Dives list's sticky section header (§3). Opaque and
    // scheme-background-coloured so scrolled content doesn't show through
    // while it sticks.
    tripHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      backgroundColor: theme.bg,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    tripTitle: {
      flex: 1,
      fontFamily: fonts['sans-semibold'],
      fontSize: 15,
      color: theme.fg,
    },
    tripDateRange: {
      fontFamily: fonts.mono,
      fontSize: 12,
      color: theme.fgMuted,
      fontVariant: ['tabular-nums'],
    },
    // EmptyState. `justifyContent: 'flex-end'` is what puts the message and
    // the primary action in the bottom third of the screen (§0.5).
    emptyStateWrap: {
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: 20,
      paddingBottom: 48,
      gap: 16,
    },
    emptyStateText: {
      fontFamily: fonts.sans,
      fontSize: 16,
      color: theme.fgMuted,
    },
    // Colour is intentionally absent: depth colour depends on the depth, not just the
    // scheme, so the caller composes this with `{ color: depthColor(metres, scheme) }`.
    depthValue: {
      fontFamily: fonts['mono-semibold'],
      fontSize: 18,
      fontVariant: ['tabular-nums'],
    },
    // The app's one button treatment (§0.1): inverted ink, monochrome. Used
    // both full-width (EmptyState's primary action) and, via `fab` below,
    // as the Dives screen's floating "+".
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
    // The Dives screen's floating "+" (§3: "big + button as the app's main
    // gesture"), positioned in the bottom third (§0.5). Same action/action-fg
    // tokens as `action` above — laid out as a circle rather than a bar.
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 32,
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.action,
    },
    fabLabel: {
      fontFamily: fonts['sans-bold'],
      fontSize: 30,
      lineHeight: 34,
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

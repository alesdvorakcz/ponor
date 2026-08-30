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
    // DivesScreen's wide (tablet) layout (DESIGN.md §3, useWideLayout.ts). Replaces
    // `screen` as the outer wrapper only on that branch — `flexDirection: 'row'` is the one
    // thing `screen` doesn't already give it, and `screen`'s own `paddingTop` moves down
    // onto `wideListColumn` below instead of living here, so it applies once per column
    // rather than twice over the detail pane (see wideListColumn's own note).
    wideScreen: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: theme.bg,
    },
    // Fixed-width list column (task brief: "the list sits at a fixed column width"). Wide
    // enough for a row's number/site/depth to read comfortably without crowding the detail
    // pane out — the same width iPad split views commonly give a master column. Carries its
    // own `paddingTop: 48`, the exact value `screen` applies, because `wideScreen` above
    // deliberately doesn't: this column's content (search box, list, fab) is otherwise
    // identical to the narrow layout's, so it needs the same top clearance `screen` would
    // have given it, just supplied locally instead of by a shared ancestor.
    wideListColumn: {
      width: 360,
      paddingTop: 48,
      borderRightWidth: 1,
      borderRightColor: theme.border,
    },
    // The detail pane beside it. No padding of its own: the embedded DiveDetailScreen
    // supplies its own `screen` style (flex, background, the same paddingTop: 48) as ITS
    // root view regardless of whether it's routed to full-screen or embedded here, so this
    // column just has to get out of the way and let that happen — adding padding here too
    // would stack a second 48pt under the first and misalign the detail content against the
    // list beside it. The "nothing selected yet" placeholder (DivesScreen.tsx) composes
    // `screen` + `centerFill` itself for the same reason, rather than this column supplying
    // it.
    wideDetailColumn: {
      flex: 1,
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
    // depthValue is the anchor of a dive row (§0.6): the value that actually differs
    // dive to dive, set apart from every other row element by size, weight and colour so
    // a column of dives reads as a column of aligned, colour-coded numbers. Colour is
    // intentionally absent here: depth colour depends on the depth, not just the
    // scheme, so the caller composes this with `{ color: depthColorOrNull(metres, scheme) }`.
    // `textAlign: 'right'` plus tabular figures is what lines a column of these up.
    depthValue: {
      fontFamily: fonts['mono-medium'],
      fontSize: 20,
      lineHeight: 22,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.4,
      textAlign: 'right',
    },
    // depthValue's counterpart on dive detail (§0.6: "20 px in a row, 34 px on dive
    // detail") — DepthValue's `variant="hero"` selects this instead.
    depthValueHero: {
      fontFamily: fonts['mono-medium'],
      fontSize: 34,
      lineHeight: 36,
      fontVariant: ['tabular-nums'],
      letterSpacing: -1,
    },
    // The " m" split off `formatDepth`'s string (DepthValue.tsx) so the unit can sit
    // quieter than the number it qualifies, without a second call into the formatter.
    // No colour of its own: nested inside depthValue/depthValueHero's Text, it inherits
    // the band colour those carry and only opacity sets it apart.
    depthUnit: {
      fontFamily: fonts.mono,
      fontSize: 11,
      opacity: 0.62,
    },
    depthUnitHero: {
      fontFamily: fonts.mono,
      fontSize: 13,
      opacity: 0.62,
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
    // `alignItems: 'flex-end'` is what lines depthValue up against the site name's own
    // baseline (§0.6) rather than the row's midline — diveRowMain's last line is the
    // site, so aligning both children's trailing edge puts the depth beside it rather
    // than beside the smaller dive-number label above it.
    diveRowTop: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 12,
    },
    // Holds the dive number and site name stacked (§0.6: "above the site name"),
    // `flex: 1` so it takes the row's full width apart from what depthValue needs.
    diveRowMain: {
      flex: 1,
      gap: 2,
    },
    diveRowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    // A label above the site name, not a headline (§0.6) — muted and small, so it
    // never competes with depthValue below for the row's one moment of emphasis.
    diveNumber: {
      fontFamily: fonts.mono,
      fontSize: 11,
      color: theme.fgMuted,
      letterSpacing: 0.4,
    },
    diveSite: {
      flex: 1,
      fontFamily: fonts['sans-medium'],
      fontSize: 16,
      color: theme.fg,
      lineHeight: 20,
    },
    // Shared by the time-range chip and the duration chip.
    diveChip: {
      fontFamily: fonts.mono,
      fontSize: 11.5,
      color: theme.fgMuted,
    },
    diveRating: {
      fontFamily: fonts.sans,
      fontSize: 13,
      color: theme.fg,
      letterSpacing: 1,
    },
    // ReorderControls (§2.5: hand-order same-day dives with no entry time).
    // `alignItems: 'center'` is what lets the shorter DiveRow centre
    // vertically next to the taller two-button column beside it.
    reorderRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    reorderRowContent: {
      flex: 1,
    },
    reorderButtonColumn: {
      flexDirection: 'column',
      gap: 4,
      paddingRight: 12,
      paddingLeft: 4,
    },
    // 48 dp floor (§0.5) on EACH button, not the pair together — a diver
    // with wet hands gets the same target moving a dive as tapping anything
    // else, even though the two stacked make this column taller than the
    // DiveRow it sits beside.
    reorderButton: {
      minWidth: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    // Dimmed via opacity rather than a second colour token: the button at
    // the top/bottom edge of its day is genuinely disabled, not merely
    // de-emphasised, and opacity says so without inventing a new colour
    // meaning for `depthValue`'s "colour is depth, and depth alone" rule to
    // have to make an exception for.
    reorderButtonDisabled: {
      opacity: 0.35,
    },
    reorderButtonLabel: {
      fontFamily: fonts.sans,
      fontSize: 14,
      color: theme.fg,
    },
    // The banner DivesScreen shows when a reorder request could not fully
    // take effect (db/dives.ts's `applied: false` — see ReorderControls.tsx's
    // `applyReorder`). Pressable so a diver can dismiss it before the next
    // attempt; §0.5's floor still applies since it is itself a tap target.
    reorderNotice: {
      minHeight: 48,
      justifyContent: 'center',
      marginHorizontal: 20,
      marginBottom: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    reorderNoticeText: {
      fontFamily: fonts.sans,
      fontSize: 14,
      color: theme.fgMuted,
    },
    // The banner DivesScreen shows when useDives()'s settings read fails (Review task 7,
    // Important #3) — a display-preference failure that must not blank the logbook, but
    // must not fail silently either. Visually identical to reorderNotice above (same
    // banner shape, same tokens) but not a Pressable: it tracks a live query's error state
    // rather than a one-off action outcome, so it has no natural "this attempt is done"
    // moment to dismiss — it clears itself once the settings read next succeeds.
    settingsNotice: {
      minHeight: 48,
      justifyContent: 'center',
      marginHorizontal: 20,
      marginBottom: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    settingsNoticeText: {
      fontFamily: fonts.sans,
      fontSize: 14,
      color: theme.fgMuted,
    },
    // DiveDetailScreen (§3's clusters: date & time, site & centre, depth & duration,
    // conditions, gas & cylinders, equipment & people, notes). A plain ScrollView, not a
    // SectionList: unlike the Dives list this is one fixed dive's worth of content, not
    // a long reflowing collection.
    detailContent: {
      padding: 20,
      paddingBottom: 48,
      gap: 24,
    },
    detailCluster: {
      gap: 10,
    },
    detailClusterTitle: {
      fontFamily: fonts['sans-semibold'],
      fontSize: 13,
      color: theme.fgMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
    },
    detailLabel: {
      fontFamily: fonts.sans,
      fontSize: 15,
      color: theme.fgMuted,
    },
    // Data figures — depths, pressures, durations, timestamps (§0.2) — read through this
    // one; free text and categorical labels (a site name, a buddy, "wet") read through
    // detailValueText below instead. DiveDetailScreen.tsx picks explicitly per field
    // rather than inferring it, so a new field can't silently pick up the wrong one.
    detailValue: {
      flexShrink: 1,
      textAlign: 'right',
      fontFamily: fonts.mono,
      fontSize: 15,
      color: theme.fg,
      fontVariant: ['tabular-nums'],
    },
    detailValueText: {
      flexShrink: 1,
      textAlign: 'right',
      fontFamily: fonts.sans,
      fontSize: 15,
      color: theme.fg,
    },
    // One cylinder's block within Gas & cylinders — hairline-separated from the one
    // above it, the same border token TripHeader's divider uses.
    detailTank: {
      gap: 10,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    detailTankTitle: {
      fontFamily: fonts['sans-medium'],
      fontSize: 14,
      color: theme.fg,
    },
    detailNotes: {
      fontFamily: fonts.sans,
      fontSize: 15,
      color: theme.fg,
      lineHeight: 22,
    },
    // The ScrollView itself, once its content sits below detailBack below rather than
    // filling `screen` alone — screen still supplies the flex/background/status-bar
    // clearance for both, this just lets the ScrollView take the remaining height.
    detailScroll: {
      flex: 1,
    },
    // DiveDetailScreen's own back control (review task 7, Important #1): _layout.tsx sets
    // headerShown: false app-wide with no per-route override, and flipping that globally
    // would also put a header on the Dives list, which the design doesn't call for — so the
    // screen supplies its own, pinned above the ScrollView rather than scrolling with its
    // content. 48 dp minHeight matches the `action`/`fab` tap-target floor above, but this
    // is deliberately NOT filled ink like those: it's wayfinding, not the screen's primary
    // action, so it stays a plain label rather than competing with one.
    detailBack: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    detailBackLabel: {
      fontFamily: fonts['sans-medium'],
      fontSize: 16,
      color: theme.fg,
    },
  });
}

const sheets = { light: build('light'), dark: build('dark') };

export function makeStyles(scheme: ColorScheme) {
  return sheets[scheme];
}

export type Styles = ReturnType<typeof makeStyles>;

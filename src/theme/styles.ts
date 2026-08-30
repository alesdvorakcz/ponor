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
    // The Dives screen's search box (DESIGN.md §3, M1c task 2). It used to carry a
    // 1px `border` on top of its `surface` fill, making it the heaviest object at
    // the top of the screen while being the one a diver touches least — task 2 first
    // dropped the border outright, fill only. Review found that overshot: `surface`
    // on `bg` alone measures ~1.1–1.2:1 contrast in both themes, well under WCAG's
    // 3:1 guideline for identifying a non-text UI component, and §0.5 states plainly
    // that contrast here is "a functional requirement, not a taste question" — this
    // field is used in exactly the noon-deck glare that requirement names. The
    // border is back below, but as a hairline rather than the original box-defining
    // 1px: still `theme.border`, which itself only reaches ~1.3–1.4:1 against `bg`
    // (the token palette is deliberately low-contrast — DESIGN.md §0 calls the brand
    // a calm precision instrument — so this is what the system offers without
    // inventing a new colour for this one field); the placeholder text below makes
    // up the rest, clearing AA at ~5:1. Fill plus hairline is quieter than the
    // original bordered box without being the boundary-less field task 2's first
    // pass left behind. §0.5's 48 dp tap-target floor still applies to it exactly as
    // much as to any button: `fontSize: 12.5` plus 9+9 vertical padding alone lands
    // well under 48, so `minHeight: 48` stays explicit rather than hoping text +
    // padding gets there on its own.
    //
    // `fontFamily: fonts.sans`, not mono, despite this box quieting down: §0.2 draws
    // the type split on content, not on volume — "Archivo for UI and display, IBM
    // Plex Mono for all data — depths, pressures, durations, timestamps". A search
    // query is typed UI text, the same category as a site name (`diveSite`, sans) or
    // a button label, not a measurement; every other quiet/muted style in this file
    // (`messageText`, `emptyStateText`, `reorderNoticeText`) stays sans too; only
    // fields showing an actual number (chips, depth, the trip date range below) earn
    // mono. Smaller size does the rest of the "quieter" work.
    searchInput: {
      minHeight: 48,
      marginHorizontal: 12,
      marginBottom: 8,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingVertical: 9,
      paddingHorizontal: 12,
      fontFamily: fonts.sans,
      fontSize: 12.5,
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
    // TripHeader — the Dives list's sticky section header (§3, restyled M1c task 2).
    // Opaque and scheme-background-coloured so scrolled content doesn't show through
    // while it sticks. No divider line or `gap` of its own any more: §0.6 doesn't call
    // for one, and the asymmetric padding below (a bigger gap above than below) plus
    // tripTitle's own small/uppercase/tracked/muted treatment is what now separates one
    // trip from the last trip's rows — the same de-emphasis-over-a-heavy-rule idea
    // searchInput's own comment describes just above, though that field kept a
    // hairline `border` after review; this row drops its border/gap entirely, since
    // §0.6 never asked for one back.
    // `alignItems: 'baseline'` (was `flex-start`): tripTitle and tripDateRange are now
    // close enough in size (11.5 / 11) that aligning their text baselines reads as one
    // line, where flex-start's top-alignment used to leave dateRange looking to float
    // slightly high against the taller title.
    tripHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      paddingTop: 20,
      paddingBottom: 7,
      paddingHorizontal: 16,
      backgroundColor: theme.bg,
    },
    // DESIGN.md §0.6's "Trip header" row: Archivo SemiBold 11.5, uppercase, +0.13 em
    // (0.13 × 11.5 ≈ 1.5), muted — the same three-attribute "uppercase, tracked, muted"
    // formula the table's "Cluster label" row uses, read onto this row's own named
    // element. Before this task the header was 15px sans-semibold in full `fg` ink —
    // close enough to diveSite (16px sans-medium, also `fg`) that a trip's own heading
    // and the site name inside it read as the same visual class; every one of size,
    // case, tracking AND colour now differs, not just weight.
    // `flex: 1` is load-bearing, not decoration: RN's default `flexShrink` is 0 (unlike
    // web's 1), so without a flex/width constraint here this Text would size itself to
    // its own unwrapped content and overflow past tripDateRange instead of wrapping —
    // this component's own docblock promises a long name wraps to a second line rather
    // than truncating (Czech runs 20-30% longer; `Šenkýřův lom` is a real fixture), and
    // that promise depends on tripTitle actually having a bounded box to wrap within.
    tripTitle: {
      flex: 1,
      fontFamily: fonts['sans-semibold'],
      fontSize: 11.5,
      color: theme.fgMuted,
      textTransform: 'uppercase',
      letterSpacing: 1.5,
    },
    // The trailing half of the same §0.6 row: "date range in mono, trailing" — mono
    // because a date range is the "timestamps" §0.2 reserves the face for, 11px (down
    // from 12) to sit closer to tripTitle's new, much smaller 11.5.
    tripDateRange: {
      fontFamily: fonts.mono,
      fontSize: 11,
      color: theme.fgMuted,
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
    // The unit from `formatDepthParts` (display.ts, DepthValue.tsx) styled quieter than
    // the number it qualifies — DepthValue reads `value`/`unit` as separate fields, never
    // by parsing a formatted string. No colour of its own: nested inside
    // depthValue/depthValueHero's Text, it inherits the band colour those carry and only
    // opacity sets it apart.
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
    // Shared by the time-range chip, the duration chip, and — DiveRow.tsx's `plannedDate` —
    // a planned dive's leading date chip.
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
    // ReorderControls (§2.5: hand-order same-day dives with no entry time). M1c task 6
    // (DESIGN.md §0.6) moved the arrows OUT of a separate column beside the row — the
    // old `reorderRow`/`reorderRowContent`/`reorderButtonColumn` trio this replaces,
    // whose taller two-button stack forced the whole row to grow to fit it — and INTO
    // the exact slot DepthValue occupies (DiveRow.tsx's `depthSlot` prop). `reorderArrows`
    // is that slot's content: just the two buttons side by side, sized to fit beside a
    // site name rather than to dictate the row's own height.
    reorderArrows: {
      flexDirection: 'row',
      gap: 8,
    },
    // 34 x 26 (task brief's Constraints), not the 48 x 48 box this used to be: at 48 x 48
    // PER button, two of them beside a row made that row roughly 1.5x taller than its
    // untimed-free neighbours — the exact problem this task exists to fix. The 48 dp
    // tap-target floor (§0.5) still applies, but via `hitSlop` (ReorderControls.tsx's
    // `ARROW_HIT_SLOP`) rather than the visible box, so the touch target can stay
    // generous without the row growing to fit it.
    reorderButton: {
      width: 34,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
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
    // DivesScreen.tsx applies this to every row that is NOT part of the one active
    // reorder day, once some day is active — §0.6: "Entering the mode dims the rest ...
    // so row heights do not change." Opacity again, not a second colour token: dimming
    // everything else is what makes the one interactive day read as the thing currently
    // being edited, the same "state via presence, not another colour" idea
    // `reorderButtonDisabled` above already uses.
    reorderDimmed: {
      opacity: 0.32,
    },
    // DayStrip (§0.6: "Hand-ordering lives on a day strip, not a row") — see that
    // component's own docblock for why a trip header can't carry this instead. A row of
    // its own, above the day's dives it belongs to. No background at rest:
    // `dayStripActive` below adds `theme.surface` only once the mode is on, so the strip
    // stays quiet until it actually matters — mirroring how `reorderButtonDisabled`
    // shows its own state through presence rather than a second colour.
    dayStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    dayStripActive: {
      backgroundColor: theme.surface,
    },
    // The rule from §2.5, stated so a diver who later adds a time and watches the
    // control vanish knows why (DayStrip.tsx's own docblock has the full account).
    // Mono, not sans: §0.2 reserves Plex Mono for data figures, and a
    // count-and-condition sentence like "2 dives, no times" is exactly that — the same
    // call `tripDateRange`/`diveChip` above already make for a date range or a duration.
    dayStripText: {
      flex: 1,
      fontFamily: fonts.mono,
      fontSize: 11.5,
      color: theme.fgMuted,
    },
    // This component's own 48 dp floor (§0.5) sits on the action alone, not on
    // `dayStrip` above: the strip's overall height stays compact (`paddingVertical: 6`,
    // mirroring `tripHeader`'s own asymmetric, whitespace-led spacing) without shrinking
    // the one thing on it a diver actually taps.
    dayStripAction: {
      minHeight: 48,
      minWidth: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    dayStripActionLabel: {
      fontFamily: fonts['sans-medium'],
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
    // DiveDetailScreen's hero (§0.6, M1c task 5): the site name, a `#N · date · centre`
    // mono sub-line, and the 34 px depth anchor (DepthValue's `variant="hero"`, from task
    // 1) — "the same anchor idea the row now uses, at detail scale." Sits above
    // `detailContent` below, outside its `padding: 20`: this carries its own
    // `paddingHorizontal: 16` (matching diveRow/tripHeader's own full-bleed 16, not
    // detailContent's 20) plus a bottom divider, so it reads as one banner spanning the
    // screen's true edge rather than another indented cluster. `flexDirection: 'row'` +
    // `alignItems: 'flex-end'` mirrors `diveRowTop`/`diveRowMain` exactly: the depth value
    // bottom-aligns against the sub-line, the same way a row's depth bottom-aligns against
    // its site name.
    detailHero: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    // Holds the site name and sub-line stacked, `flex: 1` so it takes the hero's full
    // width apart from what the depth value needs — the same role `diveRowMain` plays in
    // a row.
    detailHeroMain: {
      flex: 1,
    },
    detailHeroSite: {
      fontFamily: fonts['sans-semibold'],
      fontSize: 22,
      color: theme.fg,
      lineHeight: 26,
    },
    detailHeroSub: {
      fontFamily: fonts.mono,
      fontSize: 11.5,
      color: theme.fgMuted,
      marginTop: 3,
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
    // DESIGN.md §0.6 table's "Cluster label" row: Plex Mono 10.5, uppercase, +0.14 em
    // (0.14 × 10.5 ≈ 1.5), muted. M1c task 5 replaces an earlier Archivo SemiBold 13 px
    // treatment that predated §0.6 — mono is what marks this text as a structural label
    // rather than content, the same distinction §0.2 draws for every data figure on this
    // screen.
    detailClusterTitle: {
      fontFamily: fonts.mono,
      fontSize: 10.5,
      color: theme.fgMuted,
      textTransform: 'uppercase',
      letterSpacing: 1.5,
      marginBottom: 8,
    },
    // `position: 'relative'` is only load-bearing for a computed row's marker
    // (detailComputedMark below), which anchors `left: 0`/`top: 5` against this box —
    // every other row ignores it, since a relative position with no offset of its own has
    // no visual effect.
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
      position: 'relative',
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
    // Computed-value marking (§0.6: "the rule is derived or entered, with no exception for
    // arithmetic simple enough to do in your head ... anything in src/domain/derived.ts is
    // marked" — used pressure included, same as every other value that module computes).
    // `detailLabelComputed` reserves room for the marker View below via `paddingLeft`
    // rather than a wrapping element: DiveDetailScreen.tsx's `Row` composes it onto
    // `detailLabel` (`[detailLabel, detailLabelComputed]`) only when the field is computed,
    // so an entered field's label keeps zero padding — the exact difference its own test
    // ("marks a computed value so it reads differently from one the diver entered") checks
    // for.
    detailLabelComputed: {
      paddingLeft: 13,
    },
    // The marker itself: a plain decorative View, not a control (§0.5's 48 dp tap-target
    // floor doesn't apply to it), positioned absolute against `detailRow`'s own box —
    // `left: 0` lands it flush with the label's own left edge because `detailRow` has no
    // padding of its own, and `detailLabelComputed`'s paddingLeft above is sized to keep
    // the label's first glyph clear of it rather than overlapping. `theme.fgMuted` is its
    // only colour — it gains none of its own.
    detailComputedMark: {
      position: 'absolute',
      left: 0,
      top: 5,
      width: 6,
      height: 6,
      borderRadius: 1,
      borderWidth: 1,
      borderColor: theme.fgMuted,
      opacity: 0.75,
    },
    // DESIGN.md §0.6 table's "Computed value" row: Plex Mono 13.5 (down from detailValue's
    // 15), muted ink. Composed onto `detailValue` (`[detailValue, detailValueComputed]`),
    // never standalone: every computed field on this screen is a mono data figure, so this
    // only ever needs to override size and colour, not the mono family, tabular figures, or
    // right alignment `detailValue` already supplies.
    detailValueComputed: {
      fontSize: 13.5,
      color: theme.fgMuted,
    },
    // One cylinder's block within Gas & cylinders — hairline-separated from the one
    // above it via `theme.border`, DESIGN.md §0.2's hairlines/dividers token (the
    // same token searchInput uses for its own hairline). Not TripHeader's divider —
    // M1c task 2 removed that one in favour of typography and whitespace; see the
    // comment on `tripHeader` above.
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

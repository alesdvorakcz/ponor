import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

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

  // M1c closing fixes, Important #5: `reorderNotice`/`settingsNotice` below (and their
  // `*Text` siblings) used to be two byte-identical object literals — DivesScreen.tsx shows
  // the same banner shape for two different triggers (a reorder that didn't take effect, a
  // failed settings read), and each got its own copy of the shape rather than one shared
  // definition. Their shared intent lived only in a comment ("Visually identical to
  // reorderNotice above"), which is exactly the kind of claim a later edit to one copy
  // could silently make false. One definition, referenced twice below, so the two banners
  // can no longer drift apart by accident — and if they ever need to diverge on purpose,
  // that has to happen at a call site that spells out the difference, not by two
  // maintainers independently retyping the same ten properties.
  const noticeBanner: ViewStyle = {
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
  };
  const noticeBannerText: TextStyle = {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: theme.fgMuted,
  };

  // M1c task 11, DESIGN.md §0.6: the Dives screen's floating bottom row — the search
  // capsule and the "+" — is "separated by a soft shadow, not a line," and the "+" shares
  // that exact treatment ("its own floating button beside the capsule ... sharing the same
  // shadow"). One definition, spread into both `searchCapsuleGlass`/`searchCapsulePlain`
  // and `fab` below, for the same reason `noticeBanner` above is one definition shared by
  // two call sites: so the two floating pieces cannot quietly drift to different shadows.
  // Colour-independent of scheme on purpose — iOS's own floating chrome (tab bars, the
  // Messages search capsule this was measured from) shadows in plain black at low opacity
  // in both appearances, rather than switching to a lighter shadow colour in dark mode.
  const floatingShadow: ViewStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  };
  // The capsule's shape only — no fill. DESIGN.md §0.6, measured off iOS 26 Messages: "no
  // bar, no border, no top rule — a fully rounded capsule" ("fully rounded" = radius =
  // height / 2, not a merely-rounded rectangle — SearchCapsule.test.tsx pins that relation
  // directly). `height` rather than `minHeight`: the radius/2 relationship above needs a
  // FIXED height to hold exactly, and §0.5's 48 dp tap-target floor is met with nothing to
  // spare either way. `flex: 1` so the capsule fills whatever room `floatingRow` below
  // leaves it beside the fixed-size `fab`. No `overflow: 'hidden'`: that would clip
  // `floatingShadow` above, which draws OUTSIDE this shape's own bounds.
  const capsuleShape: ViewStyle = {
    flex: 1,
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
    ...floatingShadow,
  };

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
      paddingTop: 48,
    },
    // M1c task 11, DESIGN.md §0.6 rev 5: the Dives screen's search field used to live here
    // — a bordered/filled box at the TOP of the screen (`searchInput`, `searchBarCollapse`,
    // `searchBarHidden`; `git log` has them) — until it moved to a floating capsule at the
    // BOTTOM, beside the "+". Its replacement is `searchCapsuleGlass`/`searchCapsulePlain`/
    // `searchCapsuleInput` below, plus `floatingRow`/`floatingRowHidden` further down for
    // the positioning/collapse the old wrapper styles used to own. Removed rather than kept
    // alongside the new ones: nothing references them any more, and the top-of-screen shape
    // they describe (hairline border, no shadow) is the opposite of what rev 5 actually
    // asks for now.
    // SearchCapsule.tsx's own root when the device has Liquid Glass
    // (`isLiquidGlassAvailable()` — expo-glass-effect) — `capsuleShape` above, undecorated:
    // GlassView supplies its own translucent material natively, so adding a
    // `backgroundColor` here would paint over it.
    searchCapsuleGlass: {
      ...capsuleShape,
    },
    // SearchCapsule.tsx's root everywhere else — every pre-26 iPhone and all of Android,
    // "the common case, [which] must look deliberate rather than degraded" (DESIGN.md
    // §0.6). Same `capsuleShape` as the glass version above, plus the one thing GlassView
    // was supplying natively: an opaque fill, so this reads as a deliberate flat capsule
    // rather than a glass capsule that failed to render.
    searchCapsulePlain: {
      ...capsuleShape,
      backgroundColor: theme.surface,
    },
    // The capsule's TextInput. No border, background, or minHeight of its own — unlike the
    // old top-of-screen `searchInput` this replaces, all three now belong to whichever of
    // `searchCapsuleGlass`/`searchCapsulePlain` above contains it. `fontFamily: fonts.sans`
    // and `color`/size carried over unchanged from that field's own (already
    // review-settled) text treatment: DESIGN.md §0.2 draws the type split on content, not
    // on the box around it, and this is still typed UI text, not data.
    searchCapsuleInput: {
      flex: 1,
      padding: 0,
      fontFamily: fonts.sans,
      fontSize: 12.5,
      color: theme.fg,
    },
    // SectionList's contentContainerStyle. The bottom padding keeps the last row from
    // ever sitting behind the floating bottom row — the search capsule and the `fab`
    // beside it (DESIGN.md §0.6) — sized generously rather than exactly, since how much
    // room that row actually needs varies per device (`useSafeAreaInsets`, DivesScreen.tsx)
    // in a way this static sheet cannot read.
    listContent: {
      paddingBottom: 120,
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
    // trip from the last trip's rows — de-emphasis over a heavy rule, the same idea
    // `capsuleShape` above leans on for the search field's own boundary (a shadow, not a
    // line); this row drops its border/gap entirely instead, since §0.6 never asked for
    // one back here.
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
    // "Up next" only (M1d), applied ON TOP of `tripTitle` above rather than replacing it:
    // the size, case and tracking are the same header treatment, and only the ink changes.
    // A trip is an archive heading — everything under it already happened — where "Up next"
    // is a live queue of dives still to come (§2.4), and rendering the two identically said
    // they were the same kind of object. Muted ink is what reads as filed away, so the queue
    // takes full `fg`. Ink versus muted ink is the only lever available: §0.1 rules out a
    // hue, and a new shape here would be new visual vocabulary for one header.
    tripTitleUpNext: {
      color: theme.fg,
    },
    // The trailing half of the same §0.6 row: "date range in mono, trailing" — mono
    // because a date range is the "timestamps" §0.2 reserves the face for, 11px (down
    // from 12) to sit closer to tripTitle's new, much smaller 11.5. Shared by both
    // variants: "Up next" puts its dive count in this same slot, in this same face, so the
    // header stops looking like a trip whose date range failed to load.
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
    // M1c task 11, DESIGN.md §0.6: the floating row at the bottom of the Dives screen —
    // the search capsule and the "+" beside it. `position: 'absolute'` with `left`/`right`
    // (not a fixed `width`) is what gives "roughly 24 dp clear either side" — the row spans
    // the full width minus 24 on each edge, and `searchCapsuleShape`'s own `flex: 1` fills
    // whatever of that width `fab` below doesn't take. `bottom` is NOT set here: it mixes a
    // static margin with `useSafeAreaInsets()`'s own per-device `bottom` (DivesScreen.tsx),
    // which this scheme-only stylesheet has no way to read, so DivesScreen.tsx composes it
    // in as a `{ bottom }` override alongside this style rather than this trying to guess
    // it. `alignItems: 'center'` copes with the capsule (48) and the fab (60) not sharing a
    // height — DESIGN.md §0.6 asks for the same shadow on both, never the same size.
    floatingRow: {
      position: 'absolute',
      left: 24,
      right: 24,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    // Composed onto floatingRow above exactly while useHideOnScroll's `hidden` is true
    // (DivesScreen.tsx) — opacity only, unlike the old top `searchBarHidden` this replaces
    // (still just above), which also zeroed `height` to reclaim the space a document-flow
    // element was taking. `floatingRow` is already `position: 'absolute'` — out of flow,
    // nothing to reclaim — and animating its height to 0 would visibly squash the capsule
    // and the fab inside it as they faded, rather than the two simply receding in place.
    floatingRowHidden: {
      opacity: 0,
    },
    // The Dives screen's floating "+" (§3: "big + button as the app's main gesture"), in
    // the bottom third (§0.5) via `floatingRow` above, which now positions it — no
    // `position`/`right`/`bottom` of its own any more, since a sibling absolutely
    // positioned against the SAME ancestor `floatingRow` already is would just fight it
    // for placement. Same action/action-fg tokens as `action` above — laid out as a circle
    // rather than a bar — plus `floatingShadow`, shared with `searchCapsuleGlass`/
    // `searchCapsulePlain` above so the two floating pieces cannot drift to different
    // shadows (this function's own top comment on `floatingShadow`).
    fab: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.action,
      ...floatingShadow,
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
    // `borderTopWidth`/`borderTopColor` (§0.6: "Chrome the type scale does not cover" —
    // "set on each row's top edge, not its bottom") are what stop a list of these from
    // reading as "one undifferentiated column." The edge is not interchangeable, and M1c
    // task 7 originally shipped this on the BOTTOM edge — the owner caught it in the
    // running app (M1c closing fixes) as a missing hairline under every trip header, with
    // a stray one appearing a row later than it should: a bottom edge draws row N's line
    // AFTER row N, so the header touched its first row with nothing under it, and the
    // line that should have read as "under the header" instead showed up between that
    // first row and whatever came next. Top fixes that: row N's own top edge draws the
    // line BEFORE it, so the hairline sits directly under whatever precedes the row — a
    // TripHeader, or (DayStrip.tsx) a DayStrip on a hand-orderable day, since that strip
    // carries no border of its own and the first row after it supplies the seam instead.
    // Every row still carries this same style regardless of position (this is one shared
    // StyleSheet entry, not computed per-row), so the group's LAST row draws a line above
    // itself exactly like every other row — there is simply nothing below it to draw one
    // against, and the next group's header/strip has no border either. That is what
    // closes a trip group on whitespace rather than a rule, per §0.6's own account, with
    // nothing extra needed from DivesScreen.tsx, which renders every row (plain or
    // mid-reorder) through this one style either way.
    diveRow: {
      minHeight: 48,
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderTopWidth: 1,
      borderTopColor: theme.border,
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
    // M1c closing fixes, Important #4: no `gap` any more — DESIGN.md §0.6 specifies this
    // line as "middot-separated", and DiveRow.tsx now bakes a literal ` · ` between its
    // chips (matching heroSubline's own join elsewhere), so the separation is the
    // separator's own spacing, not a second, uncoordinated flex gap stacked on top of it.
    diveRowBottom: {
      flexDirection: 'row',
      alignItems: 'center',
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
    // The row of rating dots (M1c task 7, §0.6: "Rating marks are drawn, not typed") — a
    // container now, not a Text style, since a rating is RATING_MAX small `View` circles
    // rather than a glyph string. `gap` alone spaces them; the dots supply their own size.
    diveRating: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    // One rating mark, filled or outlined — always this exact size, which is the whole
    // point: `●`/`○` render at different sizes in almost every typeface (DESIGN.md §0.6),
    // so a rating built from those glyphs looks broken. Every dot, filled or not, carries
    // this style; `ratingDotFilled` below only ever adds a fill on top of it, never
    // changing width/height, so a "3 of 5" rating can never read as anything but five
    // identical circles. `theme.fg`, not a depth colour (§0.1: colour encodes depth and
    // nothing else — this is chrome, not data).
    ratingDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      borderWidth: 1,
      borderColor: theme.fg,
    },
    ratingDotFilled: {
      backgroundColor: theme.fg,
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
    // M1c closing fixes, Important #2: '▲'/'▼' used to be rendered as typed `Text` glyphs,
    // and the review read the cmap tables of both bundled fonts (Archivo, IBM Plex Mono —
    // theme/fonts.ts) directly: neither contains those two code points, so the arrows
    // rendered as tofu (a missing-glyph box) or nothing, device-dependent. §0.6 already
    // banned exactly this shape of bug for rating marks — "`●` and `○` are different sizes
    // in almost every typeface... draw both as circles" (task 7, `ratingDot` above) — and
    // the fix here is the same idea applied to a triangle instead of a circle: zero
    // width/height plus one coloured border edge, the other two transparent, is the
    // standard way to draw a triangle with no image and no path-drawing library. `theme.fg`
    // is the only real colour either style carries — monochrome chrome, never a depth
    // colour (§0.1) — and `'transparent'` is a rendering value, not a design colour, so it
    // is not a token: there is no brand meaning for "invisible" to encode. Composed
    // directly onto the Pressable in ReorderControls.tsx (no separate Text), so
    // `reorderButtonDisabled`'s opacity above still dims the whole button, arrow included,
    // exactly as it dimmed the old glyph.
    reorderArrowUp: {
      width: 0,
      height: 0,
      borderLeftWidth: 5,
      borderRightWidth: 5,
      borderBottomWidth: 7,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderBottomColor: theme.fg,
    },
    reorderArrowDown: {
      width: 0,
      height: 0,
      borderLeftWidth: 5,
      borderRightWidth: 5,
      borderTopWidth: 7,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderTopColor: theme.fg,
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
    // The top border is the same §0.6 rule `diveRow` above already follows — "set on each
    // row's TOP edge, not its bottom", because a top edge is what puts a line under the
    // trip header. This strip is a row of the list like any other and had been the one
    // exception, so a trip whose first entry is a strip drew its header flush against it
    // and showed a rule only below the strip (reported on the running app). With the first
    // dive row's own top border underneath, the strip ends up ruled on both sides, which
    // is what §0.6's figure shows.
    dayStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: theme.border,
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
    // The pill itself (M1c task 7, §0.6: "Chrome the type scale does not cover" — "a
    // bordered pill in tracked uppercase... small, quiet, unmistakably pressable"), nested
    // INSIDE `dayStripAction` above rather than replacing it: the 48 dp touch target stays
    // on the Pressable, centred (`dayStripAction`'s own `alignItems`/`justifyContent`)
    // around this visually smaller box, the same "small visible control, generous hidden
    // target" split `reorderButton`'s own hitSlop already uses elsewhere in this file.
    dayStripActionPill: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    // Archivo, not mono: §0.2 draws the type split on content, not on volume — this is a
    // UI control label ("Reorder"/"Done"), the same category as `actionLabel`, not a data
    // figure. Small, muted and uppercase+tracked is what reads as "quiet control" rather
    // than the plain, full-ink 14 px label this used to be.
    dayStripActionLabel: {
      fontFamily: fonts['sans-medium'],
      fontSize: 11,
      color: theme.fgMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    // The banner DivesScreen shows when a reorder request could not fully
    // take effect (db/dives.ts's `applied: false` — see ReorderControls.tsx's
    // `applyReorder`). Pressable so a diver can dismiss it before the next
    // attempt; §0.5's floor still applies since it is itself a tap target.
    // Shares its shape with `settingsNotice` below via `noticeBanner` (this function's own
    // top) rather than a second copy of the same ten properties.
    reorderNotice: noticeBanner,
    reorderNoticeText: noticeBannerText,
    // The banner DivesScreen shows when useDives()'s settings read fails (Review task 7,
    // Important #3) — a display-preference failure that must not blank the logbook, but
    // must not fail silently either. The identical shape `reorderNotice` above uses (same
    // `noticeBanner`) but not a Pressable: it tracks a live query's error state rather than
    // a one-off action outcome, so it has no natural "this attempt is done" moment to
    // dismiss — it clears itself once the settings read next succeeds.
    settingsNotice: noticeBanner,
    settingsNoticeText: noticeBannerText,
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
    // `paddingTop: 4`, not 16 (M1d): `detailBack` above it carries §0.5's 48 dp tap-target
    // floor around a 13 px label, which centres that label and leaves roughly 17 px of
    // slack below it — the hero's own 16 then stacked on top, so the gap between "‹ Dives"
    // and the title read as about double the spec's figure. The 48 stays (it is a wet-hands
    // tap target, not spacing); this is the half that was actually redundant.
    detailHero: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 4,
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
    // §0.6's hairline rule reaches this screen too: "Hairline separators on `border`...
    // set on each row's top edge, not its bottom." A cluster is this screen's row, so its
    // rule sits on top and reads as the line under the cluster before it. `detailContent`'s
    // `gap: 24` alone used to do all the separating, which is what left seven clusters
    // reading as one undifferentiated column. `paddingTop` is what keeps the cluster's own
    // uppercase label off the line it sits under; the asymmetry with the 24 above is
    // deliberate, so the rule reads as belonging to the cluster it introduces.
    detailCluster: {
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 16,
    },
    // The first cluster only. It sits directly below `detailHero`, which draws its own
    // bottom border, so the rule above would land as a visible double line — and its
    // `paddingTop` would stack on `detailContent`'s own 20. Applied ON TOP of
    // `detailCluster` (a two-element style array at the call site), never as a replacement,
    // so the two can't drift apart on anything but the border and the padding.
    //
    // The hero deliberately does NOT drop its bottom border to solve this instead: it is a
    // banner spanning the full bleed at 16 while the clusters are an indented column at 20,
    // and the line closing the banner is not the same line as the one dividing two
    // clusters.
    detailClusterFirst: {
      borderTopWidth: 0,
      paddingTop: 0,
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
    // Computed-value marking (§0.6: "the rule is derived or entered, with no exception for
    // arithmetic simple enough to do in your head ... anything in src/domain/derived.ts is
    // marked" — used pressure included, same as every other value that module computes).
    //
    // M1c task 7 replaced the original 6 px outlined square (a decorative View absolutely
    // positioned against the LABEL) with a muted `=` immediately before the VALUE: the
    // owner had approved the square in a mockup, then read it in the running app as a
    // broken glyph rather than a mark — DESIGN.md §10, "a symbol that needs a legend has
    // already failed." An equals sign needs no legend; it says what the value IS.
    //
    // `detailValueWrap` is the row's value slot now — a small flex row holding an optional
    // mark (`detailValueMark`, below) ahead of the value's own unchanged `Text`. The mark
    // is its own sibling node, never concatenated into the value's own string: `Row` keeps
    // rendering `{value}` exactly as `formatX()` returned it, so every formatter and every
    // exact-string test elsewhere in this codebase keeps seeing the real value untouched.
    // Because the value is always the LAST thing in this row (`detailRow`'s own
    // `justifyContent: 'space-between'`), its own `textAlign: 'right'` still lands its right
    // edge flush with every other row's, whether or not a mark precedes it — the mark only
    // ever adds space to its OWN left, never touches the value's own box.
    detailValueWrap: {
      flexDirection: 'row',
      alignItems: 'baseline',
      flexShrink: 1,
    },
    // The mark itself. A fixed `width` — not sized to the glyph — is what keeps it a true
    // "slot": the value's own position depends only on the value's own text, never on
    // however wide "=" happens to render in a given font, so a column of values reads the
    // same whether a given row carries a mark or not (§0.6's own "give the mark a
    // fixed-width slot rather than letting it push digits around").
    detailValueMark: {
      width: 12,
      textAlign: 'right',
      marginRight: 3,
      fontFamily: fonts.mono,
      fontSize: 13.5,
      color: theme.fgMuted,
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
    // above it via `theme.border`, DESIGN.md §0.2's hairlines/dividers token. Not
    // TripHeader's divider — M1c task 2 removed that one in favour of typography and
    // whitespace; see the comment on `tripHeader` above.
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
    // `paddingHorizontal: 16` matches `detailHero`'s own 16 (M1d). At 20 the back label sat
    // 4 px further in than the title directly beneath it, which is visible precisely
    // because they are stacked and left-aligned. `minHeight: 48` is §0.5's tap-target floor
    // and is not spacing — it stays exactly as it is.
    detailBack: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    // M1c task 7 (§0.6: "Chrome the type scale does not cover"): this used to be
    // sans-medium 16 in full ink — the exact size/weight/colour family a heading uses on
    // this screen (`detailHeroSite` is sans-semibold 22) — and read as one. "Mono, muted
    // and small... a way out, not a heading" is the fix: mono because wayfinding chrome is
    // not UI/display text the way "Dives" as a destination NAME would be, muted+small so it
    // never competes with the hero it sits above.
    detailBackLabel: {
      fontFamily: fonts.mono,
      fontSize: 13,
      color: theme.fgMuted,
    },
    // The dive-entry form (DESIGN.md §2.2, M1d task 4) — DiveFormScreen.tsx's own
    // ScrollView content. `gap` separates the core strip from the six collapsible groups
    // below it; `paddingBottom` keeps the last group clear of `formFooter`'s own fixed
    // height, the same reasoning `listContent`'s own `paddingBottom` above gives for the
    // floating row it sits above.
    formScroll: {
      flex: 1,
    },
    formScrollContent: {
      padding: 20,
      paddingBottom: 40,
      gap: 20,
    },
    // The core strip (§2.2: "date, site, center, max depth, duration" — always visible,
    // never behind a group).
    formCoreStrip: {
      gap: 4,
    },
    formHeading: {
      fontFamily: fonts['sans-semibold'],
      fontSize: 20,
      color: theme.fg,
    },
    // FormField.tsx's own root — one label-and-input row, repeated for every field on
    // this screen regardless of group.
    formField: {
      gap: 6,
    },
    // Holds the label with room at its trailing edge for the `carried ×` chip below
    // (§0.6) — `justifyContent: 'space-between'` is what reserves that space.
    formFieldHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    // The `carried ×` chip (§0.6, M1d task 5): "muted mono on `border`... gains no
    // colour" — the same monochrome rule `depthValue` exists to be the one exception to
    // (§0.1: colour encodes depth and nothing else). `theme.border` as a FILL, not just
    // the 1 px hairline it draws everywhere else in this file, is what "on border" means
    // here; `overflow: 'hidden'` clips the clear zone's own corner and any Android press
    // ripple to the chip's rounded shape rather than a square peeking out of it.
    formFieldCarried: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 6,
      backgroundColor: theme.border,
      overflow: 'hidden',
    },
    formFieldCarriedLabel: {
      fontFamily: fonts.mono,
      fontSize: 11,
      color: theme.fgMuted,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    // The `×`'s own zone — `borderLeftWidth` draws the divider the brief calls for
    // ("the `×` behind a divider inside the chip so it is visibly a button rather than a
    // label"), in `fgMuted` rather than `border` because a `border`-coloured line on a
    // `border`-filled chip would be invisible, defeating the one thing this line exists
    // to do. The 48 dp tap-target floor (§0.5) lives in `FormField.tsx`'s own
    // `CLEAR_HIT_SLOP`, not a bigger box here — same "small visible control, generous
    // hidden target" split `reorderButton`/`dayStripActionPill` above already use, so
    // this compact chip does not blow out the label row it sits inline with.
    formFieldCarriedClear: {
      borderLeftWidth: 1,
      borderLeftColor: theme.fgMuted,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    formFieldCarriedClearLabel: {
      fontFamily: fonts.mono,
      fontSize: 11,
      color: theme.fgMuted,
    },
    // `flex: 1`, not a fixed width: the same wrapping requirement `tripTitle` above
    // documents (Czech runs 20-30% longer than English) applies to every field label on
    // this screen, not just a trip's own heading.
    formFieldLabel: {
      flex: 1,
      fontFamily: fonts.sans,
      fontSize: 14,
      color: theme.fgMuted,
    },
    // The one text-input treatment every field on this form shares, numeric or not —
    // `keyboardType` is the only thing that varies per field (FormField.tsx's own prop).
    // `minHeight: 48` is this screen's own tap-target floor (§0.5) for the input itself,
    // not just the buttons around it.
    formFieldInput: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: theme.surface,
      color: theme.fg,
      fontFamily: fonts.sans,
      fontSize: 15,
    },
    // Notes gets more room and top-aligned text, rather than centring a growing
    // paragraph vertically inside a single-line-sized box.
    formFieldInputMultiline: {
      minHeight: 96,
      textAlignVertical: 'top',
    },
    // DateTimeField.tsx's trigger (M1d, date/time pickers): the control that stands where a
    // `formFieldInput` stands for every other field, so the core strip reads as one column
    // of identically-sized rows rather than one odd row among six. Deliberately the same
    // box as `formFieldInput` above — same 48 dp floor (§0.5), border, radius, fill and
    // padding — because it IS that field, with a picker behind it instead of a keyboard.
    //
    // `justifyContent: 'center'` rather than the input's own text-centring: this holds a
    // `Text`, not a `TextInput`, and a `Text` does not vertically centre itself in a box
    // taller than its line.
    formFieldPicker: {
      minHeight: 48,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: theme.surface,
    },
    // The value the trigger shows. Same face and size as `formFieldInput`'s own text, not
    // the mono §0.2 gives a timestamp elsewhere: this sits inline in a column of typed
    // fields, and one mono row among six sans ones reads as a different KIND of field
    // rather than as data. (The dive list is the other way round — there a time is data in a
    // row of data, and `diveRowMeta` above is mono accordingly.)
    formFieldPickerText: {
      fontFamily: fonts.sans,
      fontSize: 15,
      color: theme.fg,
    },
    // "Not set" — an optional field the diver never recorded (`timeIn`). Same muted ink
    // `formFieldInput`'s own placeholder uses (FormField.tsx reads `formFieldLabel.color`
    // for exactly this), so an unset picker field and an empty text field look equally
    // empty rather than one of them looking filled in.
    formFieldPickerTextUnset: {
      fontFamily: fonts.sans,
      fontSize: 15,
      color: theme.fgMuted,
    },
    // The native picker itself, once the trigger opens it. `alignSelf: 'flex-start'` keeps
    // the OS control at its own intrinsic width instead of stretching it across the form,
    // and the height is the one thing an iOS inline (calendar) picker will NOT size for
    // itself inside a ScrollView — without it the control lays out at zero height and the
    // field looks like it simply did not open.
    formFieldPickerControl: {
      alignSelf: 'flex-start',
      marginTop: 8,
    },
    // Colour handed to the picker's own iOS API (`textColor`, `accentColor`) — read as
    // `.color` at the call site, the same way FormField.tsx already reads
    // `formFieldLabel.color` for `placeholderTextColor`. A native control is OS chrome, like
    // the keyboard, but where it exposes a colour that colour must still come from the
    // tokens: §0.1 gives every hue in this app to depth, and a system accent (iOS's default
    // blue) inside a form would be a second meaning for colour. Inverted ink for the
    // selection, matching `formChipSelected` above; plain ink for the text.
    formFieldPickerInk: {
      color: theme.fg,
    },
    formFieldPickerAccent: {
      color: theme.action,
    },
    // The `×` that clears an optional picker field back to "not set" (`timeIn`). Shares the
    // `carried ×` chip's vocabulary above — `border` as a fill, mono, muted — because it is
    // the same gesture on the same kind of chip, but it carries no `carried` label beside it
    // and therefore no divider: `formFieldCarriedClear`'s left border exists to separate the
    // `×` from that word, and drawn here it would be a line against nothing.
    formFieldClear: {
      borderRadius: 6,
      backgroundColor: theme.border,
      paddingHorizontal: 10,
      paddingVertical: 5,
      overflow: 'hidden',
    },
    formFieldClearLabel: {
      fontFamily: fonts.mono,
      fontSize: 11,
      color: theme.fgMuted,
    },
    // FormGroup.tsx's own root — one of §2.2's six collapsible groups. `borderTopWidth`
    // (not bottom) is the same "chrome the type scale does not cover" rule `diveRow`
    // above documents at length: a top edge draws the seam under whatever precedes this
    // group, so groups read as separated by a hairline plus whitespace, never doubled up
    // between two adjacent groups the way a bottom edge would.
    formGroup: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 4,
    },
    // The disclosure control — §0.5's own "48 dp minimum tap targets, including each
    // group's header."
    formGroupHeader: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    formGroupTitle: {
      flex: 1,
      fontFamily: fonts['sans-medium'],
      fontSize: 15,
      color: theme.fg,
    },
    // "Show"/"Hide" (FormGroup.tsx's own docblock: text, not a chevron glyph — this
    // codebase's bundled fonts have no triangle/chevron code point, the same gap
    // `reorderArrowUp`/`reorderArrowDown` above already found and fixed for the reorder
    // arrows). Same uppercase/tracked/muted formula as `dayStripActionLabel`.
    formGroupState: {
      fontFamily: fonts.mono,
      fontSize: 11.5,
      color: theme.fgMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    formGroupBody: {
      gap: 14,
      paddingBottom: 16,
    },
    // A fixed-choice field (entry, salinity, water body, suit, cylinder material) —
    // diveFormSchema.ts's own docblock on `optionalPicked` is explicit that these values
    // are "never something a diver could type... rejecting one is catching a real bug
    // upstream": that guarantee only holds if the UI actually restricts input to the
    // fixed list, so these render as tappable chips rather than a FormField the diver
    // could mistype — a mistyped enum would fail zodResolver's per-field validation and
    // block the WHOLE form's `handleSubmit`, exactly the "never block a save" (§1)
    // failure this screen exists to avoid.
    formChipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    formChip: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      backgroundColor: theme.surface,
    },
    // Same `action`/`action-fg` inverted-ink pair the app's one button treatment already
    // uses (§0.1) — reused here for "this option is currently selected" rather than
    // inventing a second colour meaning, the same reasoning `ratingDotFilled` above
    // gives for marking state through fill rather than a new token.
    formChipSelected: {
      backgroundColor: theme.action,
      borderColor: theme.action,
    },
    formChipText: {
      fontFamily: fonts['sans-medium'],
      fontSize: 13.5,
      color: theme.fg,
    },
    formChipTextSelected: {
      color: theme.actionFg,
    },
    // The save action's fixed footer (§0.5: "the primary action sits in the bottom
    // third"; brief step 4: never disabled). Sits OUTSIDE `formScroll` above as a
    // sibling, not inside it, so it stays reachable without scrolling to the end of a
    // long form — "one scroll view" (brief) describes the form's OWN fields, not this
    // persistent action bar.
    formFooter: {
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 24,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.bg,
    },
    // M1d task 6: shown when createDive's own write rejects — §1's "never block a save"
    // cuts both ways, and this is the other one: a diver who thinks a dive logged and
    // later finds it missing is worse off than one told immediately. Sits between
    // formScroll and formFooter, a sibling of both (like reorderNotice is of DivesScreen's
    // SectionList below), so it is visible without scrolling — formFooter itself never
    // scrolls either. Shares noticeBanner/noticeBannerText's shape with reorderNotice and
    // settingsNotice above (this function's own top) rather than a third copy of the same
    // ten properties; not a Pressable, like settingsNotice, since it has no single "this
    // attempt is done" moment to dismiss — the next Save attempt clears it either way.
    formSaveError: noticeBanner,
    formSaveErrorText: noticeBannerText,
    // The blocking-field notice (M1d task 6 fix wave): shown under the one field whose
    // value stopped a save, so a diver who typed a date the schema cannot read is told
    // that, rather than tapping Save and watching nothing happen at all. Same banner
    // vocabulary as `formSaveError` above and the two notices at the top of this function —
    // one shape for "something is wrong and here is what" — spread from `noticeBanner`
    // rather than retyped, with three properties overridden: no horizontal margin, because
    // this one sits INSIDE `formScrollContent`'s own 20 px padding rather than spanning the
    // screen; no bottom margin, because the field group it sits in already owns the gap
    // below it; and no 48 dp floor, because that floor is a TAP TARGET rule (§0.5) and this
    // is a line of text under a field, not something to tap.
    formFieldError: {
      ...noticeBanner,
      marginHorizontal: 0,
      marginBottom: 0,
      minHeight: 0,
    },
    formFieldErrorText: noticeBannerText,
  });
}

const sheets = { light: build('light'), dark: build('dark') };

export function makeStyles(scheme: ColorScheme) {
  return sheets[scheme];
}

export type Styles = ReturnType<typeof makeStyles>;

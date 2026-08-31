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
/**
 * The **floor** under `screenTopInset` below, and nothing else: the clearance a screen gets
 * on a device that reports a smaller top inset than the app's own composition wants. It was
 * every screen's clearance outright from M0 until the fix `screenTopInset` records; it is
 * now only the answer for devices with no notch and no island.
 *
 * It was once spent as an absolute `top` while the action capsule floated over the list:
 * Yoga measures an absolute child's offsets from its containing block's BORDER edge, so
 * `screen`'s padding was invisible to it and a `top: 0` capsule landed over the clock and
 * the battery (seen on the simulator, not deduced). Nothing in the app is absolutely
 * positioned against this any more, so the constant has one meaning again.
 *
 * Module scope rather than inside `build` because it is scheme-independent and
 * `screenTopInset` — which is not a style and takes no theme — has to read it.
 */
const MIN_SCREEN_TOP_INSET = 48;

/**
 * **How far below the top of the display any screen's content begins: the greater of the
 * device's own top safe-area inset and the app's floor above.** One function for the whole
 * app — the pinned bar on Dives, and the root `View` of every other screen — because it is
 * one rule (§4.1), and a second helper computing the same clearance for a different screen
 * is the drift this project keeps paying for.
 *
 * The one number in this sheet's vocabulary that cannot be baked into a scheme-only
 * stylesheet: it depends on the device, not the theme. So `screen` below deliberately
 * carries **no** `paddingTop`, and every screen composes it in as
 * `[styles.screen, { paddingTop: screenTopInset(insets.top) }]` — the same shape
 * `DiveFormScreen`'s footer already uses for `insets.bottom`, and one `unexpectedGraphics`
 * permits by key (nothing here can carry a colour).
 *
 * **Derived, not measured for one phone.** The owner measured iOS 26 on the device: Files
 * puts its trailing `•••` at 62 pt and Photos its trailing controls at the same place, while
 * ours sat at ~52 and read as touching the Dynamic Island. On that device (iPhone 17 Pro)
 * `insets.top` is 62. The safe-area inset IS the clearance Apple is using; there is no magic
 * constant to keep in step with a phone.
 *
 * **Why every screen and not just the bar.** The Dives bar got this first, and for one
 * release the other five roots kept the flat 48 — which is INSIDE the safe area on an island
 * phone, so Settings' title sat at 56.3 pt where the bar's capsule sat at 62. Two screens of
 * one app disagreeing about where the top of the screen is, and only one of them agreeing
 * with iOS. The back controls on the form and the dive detail move down ~14 pt as a result:
 * that is the correction, not a regression — their containers were starting inside the safe
 * area and a control's own 48 dp centring (§0.5) was absorbing enough of it to disguise that.
 *
 * The `max` is what keeps every other device sane rather than cramped: an iPhone SE reports
 * 20 and an iPad 24, and content 20 pt from the top edge would be worse than what this
 * replaces. Below a notch the app's own 48 wins and nothing moves from where it has sat
 * since M0 — which is also what keeps the wide layout's two columns aligned, since the list
 * column's bar and the detail pane beside it now ask this same function the same question.
 */
export function screenTopInset(safeAreaTop: number): number {
  return Math.max(safeAreaTop, MIN_SCREEN_TOP_INSET);
}

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

  // The way out of a stacked screen — `detailBack` (DiveDetailScreen) and `formBack`
  // (DiveFormScreen, M1d task 7) — one definition rather than two copies of the same six
  // properties, the same reasoning `noticeBanner` above records. §0.6: "The dive-detail
  // back control is mono, muted and small — it is a way out, not a heading," and the form's
  // exit is exactly the same kind of object, so it must not invent a second treatment for
  // it. `minHeight: 48` is §0.5's tap-target floor and is not spacing. The two call sites
  // differ only in `paddingHorizontal`, which aligns each to the content beneath it (16 for
  // the detail hero, 20 for the form's own scroll padding) and is therefore set there.
  const backControl: ViewStyle = {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
  };
  const backControlLabel: TextStyle = {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: theme.fgMuted,
  };

  // "This one is chosen", wherever a control shows which of a fixed set is on: the form's
  // option chips (entry, salinity, suit, cylinder material) and its Logged/Planned control
  // (§2.4). §0.1 leaves exactly one lever for that — inverted ink, the same `action` /
  // `action-fg` pair the app's single button treatment uses — because a hue here would
  // land in or beside a depth band and make a diver decide whether a coloured object is
  // data or chrome. One definition rather than two identical literals, the same reasoning
  // `noticeBanner` above records; `ratingDotFilled` marks state through fill for the same
  // reason.
  const selectedFill: ViewStyle = {
    backgroundColor: theme.action,
    borderColor: theme.action,
  };
  const selectedInk: TextStyle = {
    color: theme.actionFg,
  };

  // §0.6's quiet control: "a bordered pill in tracked uppercase, not plain text, so it
  // reads as a control rather than a label." Written once and used by the day strip's
  // Reorder/Done, by an "Up next" row's *Complete dive* (§2.4), and by the form's own
  // Logged/Planned control — one definition for the same object, the same reasoning
  // `noticeBanner` and `backControl` above record. Archivo, not mono: §0.2 splits the two
  // faces on content, and this is a UI control label, the same category as `actionLabel`,
  // never a data figure.
  const actionPill: ViewStyle = {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  };
  const actionPillLabel: TextStyle = {
    fontFamily: fonts['sans-medium'],
    fontSize: 11,
    color: theme.fgMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  // A capsule's shape only — no fill. DESIGN.md §0.6, measured off iOS 26 Messages: "no
  // bar, no border, no top rule — a fully rounded capsule" ("fully rounded" = radius =
  // height / 2, not a merely-rounded rectangle — SearchCapsule.test.tsx pins that relation
  // directly). `height` rather than `minHeight`: the radius/2 relationship above needs a
  // FIXED height to hold exactly, and §0.5's 48 dp tap-target floor is met with nothing to
  // spare either way. No `overflow: 'hidden'`: that would clip `floatingShadow` above,
  // which draws OUTSIDE this shape's own bounds.
  //
  // **Two capsules now share it** (§3's note, built with Settings): the search field, which
  // fills whatever width the top row leaves it, and the top-right action capsule, which is
  // sized by the glyphs inside it. The difference between them is width and padding and
  // nothing else — split below rather than written out twice, so the height, the rounding
  // and the shadow cannot drift between two objects a diver sees side by side.
  const capsuleBase: ViewStyle = {
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    ...floatingShadow,
  };
  // The search field's capsule: `flex: 1` so it takes the top row's remaining width beside
  // the action capsule, with room for the magnifier and the text beside it.
  const searchCapsuleShape: ViewStyle = {
    ...capsuleBase,
    flex: 1,
    paddingHorizontal: 16,
    gap: 8,
  };
  // The top-right action capsule (§3): "one top-right glass capsule carrying ... magnifier
  // and `+` as equal monochrome glyphs". No `flex` — it is as wide as its glyphs, which are
  // each a 48 dp square (`capsuleGlyph` below, §0.5's floor), so the capsule measures itself
  // rather than being told a width that would have to be kept in step with how many glyphs
  // it holds. That is what makes M2's Map and M3's Stats — and the view-toggle glyph
  // Calendar carries alongside them — additions rather than a re-measure.
  const actionCapsuleShape: ViewStyle = {
    ...capsuleBase,
    paddingHorizontal: 4,
  };

  // ---------------------------------------------------------------------------------------
  // The row grammar §0.6 gives the dive detail, and (M1d design pass) gives the form too:
  // "The form is the dive detail you can type into." Each of the four definitions below is
  // written ONCE here and read by both screens, rather than the form restating the detail
  // screen's values under its own names — which is exactly how the two came to speak
  // different visual languages for identical content in the first place. A form field that
  // needs a variant (an editable value has to be a `TextInput`, and a label has to be free
  // to wrap) derives it from the definition below rather than replacing it, so the
  // difference stays visible at the point it is made.
  // ---------------------------------------------------------------------------------------

  // §0.6's table row "Cluster label": Plex Mono 10.5, uppercase, +0.14 em (0.14 × 10.5 ≈
  // 1.5), muted. `detailClusterTitle` and the form's own `formGroupTitle` are the two call
  // sites — "*Conditions* and *Gas & cylinders* name the same groups on both screens and used
  // to carry two different treatments" (§0.6). Deliberately carries no margin: one of the two
  // is a block heading and the other sits in a flex row beside a disclosure state, and a
  // margin that suits one is wrong for the other.
  const clusterLabel: TextStyle = {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    color: theme.fgMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  };

  // What a screen calls itself: the form's "Log a dive" / "Edit dive", and Settings' own
  // title. Archivo SemiBold 20 in full ink — the largest type in the app that is not a
  // depth, which is what makes it read as the name of the thing rather than as part of it.
  // One definition rather than three, the same reasoning `noticeBanner` and `backControl`
  // above record: the call sites differ only in how they are placed (the form's and the
  // Dives list's each sit in a flex row beside a control; Settings' is a block and takes the
  // row inset directly), and none of them may quietly pick a different size.
  const screenHeading: TextStyle = {
    fontFamily: fonts['sans-semibold'],
    fontSize: 20,
    color: theme.fg,
  };

  // The row that title sits in on the one screen where something shares its line: §2.4's
  // Logged/Planned control on the dive form. The Dives list used to be the second — the
  // search/`+` capsule sat at this row's trailing edge — until the capsule moved into a
  // pinned bar of its own and the title dropped below it into the scroll content
  // (`divesBar`/`divesTitle` below). Kept as its own definition rather than folded into
  // `formHeadingRow`, because `headingTitle` beneath it is the half that matters: a title
  // sharing its line with a control has to be told to wrap, and a title that has the line to
  // itself must not be.
  const headingRow: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  };
  // The title inside that row. `flex: 1` so a longer heading wraps rather than squeezing the
  // control beside it off the row — §0.5's "Czech runs 20–30 % longer than English", the
  // same requirement `tripTitle` and `formFieldLabel` already answer the same way. A title
  // with nothing beside it (`divesTitle`, `settingsHeading`) takes plain `screenHeading`
  // instead: there is nothing on its line to be squeezed, and `flex: 1` on a block child
  // would be a claim about a row it is not in.
  const headingTitle: TextStyle = {
    ...screenHeading,
    flex: 1,
  };

  // A row's leading half (§0.6: "Label at the leading edge in Archivo 15 muted — the detail
  // screen's own row label"). Archivo, not mono: §0.2 splits the two faces on content, and a
  // field's NAME is not a data figure however numeric its value turns out to be.
  const rowLabel: TextStyle = {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: theme.fgMuted,
  };

  // A row's trailing half, in the two faces §0.2 splits on content — "Figures in mono, names
  // in sans" (§0.6). Which one a given field takes is decided EXPLICITLY at each call site,
  // on both screens (`Field.mono` on the detail, `FormField`'s own `mono` prop on the form),
  // never inferred from the value's type or from the keyboard the field asks for: a new field
  // must not be able to pick up the wrong face silently.
  const rowValue: TextStyle = {
    textAlign: 'right',
    fontSize: 15,
    color: theme.fg,
  };
  const rowValueMono: TextStyle = {
    ...rowValue,
    fontFamily: fonts.mono,
    fontVariant: ['tabular-nums'],
  };
  const rowValueSans: TextStyle = {
    ...rowValue,
    fontFamily: fonts.sans,
  };

  // The form's own horizontal inset, carried by every row-level child of its ScrollView —
  // each field, each group header, the heading row — rather than by the ScrollView's own
  // contentContainer. That is what makes a field's hairline and its focus fill span the full
  // width the way a dive row's do (§0.6: "a hairline on each row's top edge, the same rule
  // dive rows follow"), while the text inside still lands on the same 20 `detailContent` uses
  // one screen over. It also leaves the `carried ×` chip's outward `hitSlop` (FormField.tsx)
  // 20 dp of room INSIDE the field's own unclipped box, where the old contentContainer
  // padding left it 20 dp outside every field — same floor, delivered closer to home.
  const FORM_ROW_INSET = 20;

  // What a field puts UNDER its label/value row — the option chips, an open date picker, the
  // notes box, and (M2) the autocomplete list §0.6 positions there — owns the clearance
  // between itself and the NEXT row's hairline. The row above it deliberately has no vertical
  // padding of its own: it is `minHeight: 48` with its input stretched to match, so the row IS
  // the tap target (§0.5), and padding there would leave the input short of the floor while
  // the row itself met it.
  const FIELD_EXTRA_CLEARANCE = 12;

  // A scrolling column of §0.6 rows — the dive form, and now Settings, which is the same
  // grammar asking about the app instead of about a dive. One definition rather than two,
  // so the two screens cannot drift on how far their first row sits from the heading above
  // it. `paddingTop: 4` is the trim `formScrollContent` already recorded (a back control's
  // or heading's own 48 dp floor leaves ~17 px of slack, and a second 20 on top read as a
  // gap nothing asked for); `paddingBottom` clears the form's fixed footer, and on Settings
  // is simply the room a last row wants above the tab bar.
  // What a tab label is made of, minus its ink. Two bars now render one — the device's
  // native one and the browser's JS one (`(tabs)/_layout.tsx` and `_layout.web.tsx`) — and
  // they take their colour through different mechanisms: the native bar wants the resting
  // ink baked into the style, while the JS navigator supplies it as a tint prop and would
  // be overridden by a `color` here (see `webTabBarLabel` below). The face and the size are
  // the same rule either way, so they are written once and the two keys differ only in the
  // one thing that genuinely differs.
  const tabBarLabelType: TextStyle = {
    fontFamily: fonts['sans-medium'],
    fontSize: 11,
  };

  // The app's ground, under three names. One definition rather than three literals, the same
  // reasoning `noticeBanner` above records: `screen`, `divesScreen` and `wideScreen` are the
  // roots of every screen in the app, they must paint the same ground and fill the same way,
  // and each of the three says at its own definition what makes it a distinct name (what the
  // call site adds on top, §4.1's "a deliberate near-duplicate names its siblings").
  const screenGround: ViewStyle = { flex: 1, backgroundColor: theme.bg };

  const rowScroll: ViewStyle = { flex: 1 };
  const rowScrollContent: ViewStyle = {
    paddingTop: 4,
    paddingBottom: 40,
    gap: 20,
  };

  return StyleSheet.create({
    // Every screen's root: the app's ground, and the flex that lets its content fill.
    //
    // **`paddingTop` is deliberately absent**, and composed in at the call site from
    // `screenTopInset(insets.top)` — see that function for why the top clearance is read off
    // the device rather than written here. A static number here would be a second answer to
    // the question that function owns, and it was: 48, which is inside the safe area on an
    // island phone. Absent rather than floored at the app's minimum, so a root that forgets
    // to compose it lands its content under the clock instead of quietly looking a little
    // tight — the failure is the visible kind.
    screen: screenGround,
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
      ...searchCapsuleShape,
    },
    // SearchCapsule.tsx's root everywhere else — every pre-26 iPhone and all of Android,
    // "the common case, [which] must look deliberate rather than degraded" (DESIGN.md
    // §0.6). Same `capsuleShape` as the glass version above, plus the one thing GlassView
    // was supplying natively: an opaque fill, so this reads as a deliberate flat capsule
    // rather than a glass capsule that failed to render.
    searchCapsulePlain: {
      ...searchCapsuleShape,
      backgroundColor: theme.surface,
    },
    // ActionCapsule.tsx's two materials, chosen exactly as the search capsule's pair above
    // is (`isLiquidGlassAvailable()`, never a static platform check) and for the same
    // reason: real Liquid Glass where the OS has it, and everywhere else the identical
    // shape in an opaque `surface` fill, which "must look deliberate rather than degraded"
    // (§0.6). The glass variant carries no fill, since GlassView supplies its own material.
    actionCapsuleGlass: {
      ...actionCapsuleShape,
    },
    actionCapsulePlain: {
      ...actionCapsuleShape,
      backgroundColor: theme.surface,
    },
    // One glyph's tap target inside the action capsule — 48 x 48, §0.5's floor as a real
    // box rather than `hitSlop`. Slop is the right tool for a control sitting inline in a
    // row of text (`CLEAR_HIT_SLOP`, FormField.tsx); here the capsule exists to hold these
    // and nothing else, so the target can simply BE the size it needs, and two of them side
    // by side are what give the capsule its width.
    //
    // A square, not a circle: the ink is the glyph, and a rounded fill behind it would be a
    // second object competing with the capsule that already surrounds it.
    capsuleGlyph: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The hairline between two glyphs in one capsule. Without it the capsule reads as one
    // control with two decorations rather than as two buttons — a real risk now that the
    // `+` has given up the 60 dp circle that used to say "this is the button" on its own
    // (§3: "the `+` ... stops being big"). `border`, the same hairline every seam in the
    // app is drawn in, and short of the capsule's full height so it separates without
    // cutting the shape in two.
    capsuleDivider: {
      width: 1,
      height: 20,
      backgroundColor: theme.border,
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
    // SectionList's contentContainerStyle.
    //
    // **No top padding, and its absence is the point.** This carried 60 — the capsule's own
    // 48 plus the gap below it — for as long as the capsule floated over the list's first
    // rows and the list had to open clear of it. `divesBar` below now holds the capsule IN
    // FLOW above this list, so there is nothing overhead to clear: the list's viewport begins
    // where the bar ends, and the first thing in the content is the large title
    // (`divesTitle`, the `ListHeaderComponent`), which brings its own spacing.
    //
    // The bottom keeps its allowance: the tab bar is a sibling of the whole screen, not an
    // overlay on this list, so this is the breathing room a last row wants before the bar
    // rather than clearance for something drawn on top of it.
    listContent: {
      paddingBottom: 24,
    },
    // DivesScreen's wide (tablet) layout (DESIGN.md §3, useWideLayout.ts). Replaces
    // `divesScreen` as the outer wrapper only on that branch — `flexDirection: 'row'` is the
    // one thing it adds. Neither carries a top inset: the list column's own pinned bar and
    // the detail pane's own `screen` each compose theirs from `screenTopInset`, one per
    // column, so a padding here would stack a second one over the detail pane (see
    // `wideListColumn`).
    wideScreen: { ...screenGround, flexDirection: 'row' },
    // Fixed-width list column (task brief: "the list sits at a fixed column width"). Wide
    // enough for a row's number/site/depth to read comfortably without crowding the detail
    // pane out — the same width iPad split views commonly give a master column.
    //
    // **No `paddingTop`.** It carried the app's flat top inset while the list column began
    // with a title row that had no clearance of its own; the pinned bar it now begins with
    // owns that clearance and derives it from the device (`screenTopInset`), so a padding
    // here would stack under it. The two columns line up by construction now rather than by
    // two numbers happening to agree: the bar asks `screenTopInset(insets.top)` and the
    // `DiveDetailScreen` in the pane beside it asks the same function the same question, so
    // an iPad's 24 pt inset floors to 48 on both sides and any future device moves both.
    wideListColumn: {
      width: 360,
      borderRightWidth: 1,
      borderRightColor: theme.border,
    },
    // The detail pane beside it. No padding of its own: the embedded DiveDetailScreen
    // supplies its own root (`screen`, plus the `screenTopInset` it composes in) regardless
    // of whether it's routed to full-screen or embedded here, so this column just has to get
    // out of the way and let that happen — adding padding here too would stack a second top
    // inset under the first and misalign the detail content against the list beside it. The
    // "nothing selected yet" placeholder (DivesScreen.tsx) composes `screen` + the same
    // inset + `centerFill` itself for the same reason, rather than this column supplying it.
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
    // The Dives screen's root. **A deliberate near-duplicate that names its siblings**
    // (§4.1): it is `screenGround`, exactly as `screen` above is, and the difference is not
    // in the style but in what the call site adds. Every other screen composes
    // `screenTopInset(insets.top)` onto `screen`; this one composes nothing, because the
    // pinned bar immediately below (`divesBar`) spends that clearance itself, and a padding
    // here would stack a second one under it. Unifying the two names would delete that
    // distinction and leave a bare `styles.screen` meaning "no top inset here" on one screen
    // and "someone forgot the inset" on the other five. `wideScreen` is the third sibling:
    // the same ground plus a row direction, for the same reason.
    divesScreen: screenGround,
    // DESIGN.md §3's note (owner's call, recorded during M1d, built with Settings): "Tabs go
    // to the bottom; search and `+` move to a top-right capsule." This is the bar that
    // capsule is pinned in — the **native iOS large-title arrangement** the owner chose after
    // seeing both on the device: the controls stay in a bar that does not scroll, and the
    // large title lives in the list's own content and scrolls away beneath it (`divesTitle`
    // below). Measured on iOS 26, not recalled: Files pins its trailing `•••` at ~66 pt and
    // puts "Shared" at ~140 pt INSIDE the scroll view; Photos pins its trailing controls at
    // the same ~66. No compact title fades in to replace the scrolled-away one — the owner's
    // deliberate call, on the grounds that the tab bar already says which screen this is.
    //
    // **It is in flow, above the list, and that is what makes the occlusion impossible.**
    // The capsule used to be an absolutely positioned strip floating over the list's first
    // rows (`topActionRow`, `git log` has it), which is why it needed `useHideOnScroll`: this
    // list's trip headers are sticky and carry their date range in the trailing slot (§0.6's
    // type table), so every header in turn slid under the capsule and lost its date —
    // `UNNAMED SITE`'s range read as `…16` on the simulator. A pinned bar in flow ends that
    // outright rather than timing around it: the SectionList is this bar's SIBLING, so its
    // viewport — and therefore where a sticky header sticks — begins at the bar's bottom
    // edge, at every scroll offset. Overlaying the list and insetting its content instead
    // would have put the sticky headers back under the capsule, since a sticky header sticks
    // to the scroll view's own frame and not to its content inset.
    //
    // **`backgroundColor` is not decoration.** It is the scroll-edge effect, in its plainest
    // form: an opaque ground on the pinned bar, so that nothing the list draws can ever be
    // read through or behind it. It is `bg`, the same ground `divesScreen` above paints, so
    // at rest the bar is invisible and the capsule reads as sitting on the page — and the
    // moment a row or a header scrolls up to meet it, it is the bar that wins. Always
    // present rather than appearing on scroll: iOS fades one in because its bar is
    // translucent and its title has to show THROUGH it, and neither is true here, so a
    // scroll listener would only be a second way for the `…16` defect to come back.
    //
    // `paddingHorizontal: 16` is this screen's own column — `tripHeader` and `diveRow` below
    // both use it, and so does `divesTitle` — so the capsule's trailing edge lines up with
    // the date ranges it used to cover. (It is NOT `FORM_ROW_INSET`: that is the form's and
    // Settings' column, and `detailBack` records the same choice one screen over.)
    //
    // `paddingTop` is deliberately absent and composed in at the call site from
    // `screenTopInset(insets.top)` — the same owner every other screen's root asks, so this
    // bar and the Settings title beside it can no longer disagree about where the top of the
    // screen is. See that function for why the clearance is read off
    // the device rather than written here.
    divesBar: {
      backgroundColor: theme.bg,
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    // The bar's content, under that inset: one row, capsule trailing.
    //
    // A child of `divesBar` rather than `divesBar` itself, because the 48 dp floor has to
    // apply BELOW the safe-area padding and Yoga measures `minHeight` on the border box —
    // a `minHeight: 48` on the bar would be swallowed whole by a 62 pt `paddingTop` and
    // reserve nothing. What it reserves is the height the capsule gives the bar, so the
    // title beneath sits in exactly the same place on the branches that render no capsule (a
    // failed read, an empty logbook — DivesScreen.tsx). A floor and never a `height`: §0.5's
    // tap targets are the capsule's two 48 dp glyphs, and a fixed height here would be the
    // one way to clip them.
    divesBarRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    // The large title, and it is a **block in the list's own content** — the SectionList's
    // `ListHeaderComponent` — not a row in the bar above. That is the whole of the native
    // arrangement: it scrolls away with the logbook and nothing takes its place.
    //
    // `screenHeading` rather than `headingTitle`: nothing shares its line any more, so the
    // `flex: 1` that let it wrap beside a control would be a claim about a row it is not in.
    // The face, the size and the ink are unchanged and still shared with the form's and
    // Settings' own titles (§4.1: what a screen calls itself is one rule) — a native large
    // title is 34 pt bold, and taking that here would have split that rule three ways for
    // one screen.
    //
    // Same 16 dp column as `divesBar` above and the rows below, so the title, the capsule
    // and every trip title line up. `paddingTop` is the gap under the capsule; `paddingBottom`
    // is what separates the title from the first trip header, which brings its own 20.
    divesTitle: {
      ...screenHeading,
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 8,
    },
    // ------------------------------------------------------------------------------------
    // The search screen (SearchScreen.tsx — DESIGN.md §3, measured off iOS 26 Messages)
    // ------------------------------------------------------------------------------------
    // The dock the field sits in, at the BOTTOM of the screen, where the keyboard rises. It
    // mirrors the Dives screen's own top row turned the other way up — the same 12 dp gap
    // between the field and the capsule beside it — because it is the same pair of objects: a
    // capsule that fills the width and a capsule sized by its glyphs. Its own 24 dp either
    // side is what that row carried while it floated; `divesHeadingRow` has since moved into
    // the dive list's 16 dp column, and this screen has no list of rows to line up with. It
    // is IN FLOW rather than absolutely positioned, which is what lets `KeyboardAvoidingView`
    // lift it; `paddingBottom` is composed in at the call site from `insets.bottom`, the one
    // value a scheme-only sheet cannot know (the same composition `formFooter` already
    // makes).
    searchDock: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 12,
      gap: 12,
    },
    // The results list's contentContainer. No top padding: nothing floats over this list —
    // the dock is a sibling below it, in flow — so the first result starts at the top of the
    // screen's own inset. A little at the bottom so the last row is not flush against the
    // dock's hairline-free edge.
    searchResults: {
      paddingBottom: 12,
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
    //
    // It is also what supplies the room `ARROW_HIT_SLOP` (ReorderControls.tsx) needs. A
    // touch is delivered only to a view whose every ANCESTOR contains the point too, so
    // slop reaching outside this box does nothing at all: with this row sized to its 26 dp
    // children and sitting flush against `diveRowTop`'s trailing edge, the arrows' real
    // target was about 37 x 41, not the 48 x 48 both their comments claimed. `minHeight`
    // plus `paddingHorizontal` put that slack INSIDE this view, where it counts; the 14 dp
    // gap keeps the two buttons' slop from meeting, so a tap just to the right of the up
    // arrow still moves the dive up rather than landing on the down arrow drawn over it.
    reorderArrows: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 7,
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
    dayStripActionPill: actionPill,
    // Archivo, not mono: §0.2 draws the type split on content, not on volume — this is a
    // UI control label ("Reorder"/"Done"), the same category as `actionLabel`, not a data
    // figure. Small, muted and uppercase+tracked is what reads as "quiet control" rather
    // than the plain, full-ink 14 px label this used to be. Shared with the "Up next" row's
    // own action via `actionPillLabel` at the top of this function (M1d task 7).
    dayStripActionLabel: actionPillLabel,
    // §2.4's *Complete dive*, on an "Up next" row (M1d task 7): "After surfacing, Complete
    // dive asks only for the missing numbers." A row of its own beneath the dive's row
    // rather than a control inside it — DiveRow is one Pressable that opens the dive, and a
    // second tappable object nested in it would make which of the two a tap lands on a
    // matter of pixels. Trailing-aligned, so a column of queued dives reads as one column
    // of actions; the pill itself is `actionPill` above, the same quiet control the day
    // strip uses, because it is the same kind of thing.
    plannedActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
      paddingBottom: 6,
    },
    // The 48 dp floor (§0.5) sits on the Pressable, centred around the visually smaller
    // pill inside it — the same "small visible control, generous hidden target" split
    // `dayStripAction` above already uses, and the reason the pill is nested rather than
    // being the Pressable itself.
    plannedAction: {
      minHeight: 48,
      minWidth: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    plannedActionPill: actionPill,
    plannedActionLabel: actionPillLabel,
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
    // DESIGN.md §0.6 table's "Cluster label" row — `clusterLabel` at the top of this
    // function, the one definition the form's own group headers now read too (M1d design
    // pass), plus the margin that only a block heading wants. M1c task 5 replaced an earlier
    // Archivo SemiBold 13 px treatment that predated §0.6 — mono is what marks this text as a
    // structural label rather than content, the same distinction §0.2 draws for every data
    // figure on this screen.
    detailClusterTitle: {
      ...clusterLabel,
      marginBottom: 8,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
    },
    detailLabel: rowLabel,
    // Data figures — depths, pressures, durations, timestamps (§0.2) — read through this
    // one; free text and categorical labels (a site name, a buddy, "wet") read through
    // detailValueText below instead. DiveDetailScreen.tsx picks explicitly per field
    // rather than inferring it, so a new field can't silently pick up the wrong one.
    // `rowValueMono`/`rowValueSans` are this function's own shared pair, so the form's typed
    // values (`formFieldInput`/`formFieldInputMono`) are the same two faces at the same size
    // rather than a second, independently-chosen treatment for identical content.
    detailValue: {
      ...rowValueMono,
      flexShrink: 1,
    },
    detailValueText: {
      ...rowValueSans,
      flexShrink: 1,
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
      ...backControl,
      paddingHorizontal: 16,
    },
    // The detail screen's top bar (M1d task 7): the way out at its leading edge, the dive's
    // own action at its trailing edge — always "Edit" since task 8, for a planned dive as
    // much as a logged one; §2.4's "Complete dive" is its own control at the end of the
    // content (`detailComplete` below). A row rather than two stacked controls, because the
    // second one is a peer of the first, not a heading: both are chrome above the hero, and §0.6 already
    // fixes that treatment — mono, small, quiet. No `justifyContent: 'space-between'`,
    // because the back control is hidden in the wide (tablet) layout and the action must
    // stay at the trailing edge regardless of how many children the row has; `detailAction`
    // below carries `marginLeft: 'auto'` for that instead.
    detailTopBar: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // Full ink where `detailBackLabel` below is muted — §0.6: "Ink versus muted ink is the
    // only lever" (§0.1 rules out a hue, and a new shape would be new vocabulary for one
    // control). Wayfinding stays muted; the thing a diver came here to DO reads as the
    // brighter of the two, without becoming the filled `action` button, which on this screen
    // would compete with the hero it sits directly above.
    detailAction: {
      ...backControl,
      paddingHorizontal: 16,
      marginLeft: 'auto',
    },
    detailActionLabel: {
      ...backControlLabel,
      color: theme.fg,
    },
    // §2.4's *Complete dive* on the detail screen (M1d task 8). It sits at the END of the
    // content, immediately above `detailDelete` below, for the reason that style already
    // records for itself: the two acts that operate on the whole dive belong together, at the
    // end of a deliberate reach, rather than crowding the top bar where the thumb already is.
    // The top bar's own action is now always plain *Edit* — a planned dive used to have no
    // plain-edit affordance at all, because that one control read "Complete dive" instead.
    //
    // The treatment is `actionPill`/`actionPillLabel` (this function's own top): §0.6's "a
    // bordered pill in tracked uppercase, not plain text, so it reads as a control rather
    // than a label", and the very treatment this same action already wears on an "Up next"
    // row (`plannedActionPill`). That is what gives it its own weight without inventing
    // anything: §0.1 spends every hue on depth, so a colour is out; the filled `action`
    // button would make finishing a plan louder than the hero above it; and borrowing
    // `detailDeleteLabel`'s plain muted label would make a non-destructive act look exactly
    // like the one destructive act in the app, two indistinguishable rows in one column.
    // Centred rather than trailing-aligned (where `plannedActions` puts it) because here it
    // stacks with `detailDelete`, which is centred, not with a column of other dives' rows.
    // This wrapper is what keeps the Pressable below at the pill's own width: `detailContent`
    // is a column, so without it the 48 dp target would span the full screen and sit directly
    // above `detailDelete`'s own — two full-width targets stacked, one of them the only
    // destructive act in the app, with the boundary between them invisible.
    detailCompleteRow: {
      alignItems: 'center',
    },
    // §0.5's 48 dp floor on the Pressable, centred around the visually smaller pill inside
    // it — the same "small visible control, generous hidden target" split `plannedAction` and
    // `dayStripAction` above already use, and the reason the pill is nested rather than being
    // the Pressable itself.
    detailComplete: {
      minHeight: 48,
      minWidth: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    detailCompletePill: actionPill,
    detailCompleteLabel: actionPillLabel,
    // Deleting a dive (M1d task 7, DESIGN.md §6's tombstone): "a plain muted label, not a
    // red one" — §0.1 spends every hue on depth, so the destructive colour belongs to the
    // OS's own confirmation dialog (`style: 'destructive'`, platform/confirmDestructive.ts) exactly as
    // the keyboard's colours do, and never to a surface this app draws. It sits at the END
    // of the scrolled content, below every cluster, rather than in the top bar beside Edit:
    // a deliberate act on one dive should take a deliberate reach, and the top bar is where
    // the thumb already is.
    // A delete that failed, said plainly (§10: "A local save failure is shown to the
    // diver"). The same `noticeBanner` shape `reorderNotice`/`settingsNotice`/`formSaveError`
    // already share, minus the horizontal margin: this one sits inside `detailContent`'s own
    // 20 px padding rather than spanning the screen.
    detailDeleteError: {
      ...noticeBanner,
      marginHorizontal: 0,
    },
    detailDeleteErrorText: noticeBannerText,
    detailDelete: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    detailDeleteLabel: {
      fontFamily: fonts['sans-medium'],
      fontSize: 14,
      color: theme.fgMuted,
    },
    // M1c task 7 (§0.6: "Chrome the type scale does not cover"): this used to be
    // sans-medium 16 in full ink — the exact size/weight/colour family a heading uses on
    // this screen (`detailHeroSite` is sans-semibold 22) — and read as one. "Mono, muted
    // and small... a way out, not a heading" is the fix: mono because wayfinding chrome is
    // not UI/display text the way "Dives" as a destination NAME would be, muted+small so it
    // never competes with the hero it sits above.
    detailBackLabel: backControlLabel,
    // The dive-entry form (DESIGN.md §2.2, M1d task 4) — DiveFormScreen.tsx's own
    // ScrollView content, and since Settings arrived, `rowScroll`/`rowScrollContent` at the
    // top of this function rather than a private pair (see there; the `gap` separates the
    // core strip from the six collapsible groups below it, and `paddingBottom` keeps the
    // last group clear of `formFooter`'s own fixed height).
    //
    // **No horizontal padding of its own** (M1d design pass, §0.6): every row-level
    // child carries `FORM_ROW_INSET` instead, so a field's hairline and its focus fill reach
    // the screen's real edges the way a dive row's do while the text inside still lands on
    // 20.
    formScroll: rowScroll,
    formScrollContent: rowScrollContent,
    // The core strip (§2.2: "date, site, center, max depth, duration" — always visible,
    // never behind a group).
    //
    // It carries nothing of its own now, and that is the point rather than an oversight: its
    // five rows separate themselves, each with its own top hairline and its own 48 dp height
    // (§0.6), exactly as the dive list's rows do — a `gap` here would push each hairline off
    // the row it belongs to and leave it floating in whitespace. The wrapper stays because
    // §2.2 names this strip as a thing, and because DiveFormScreen.test.tsx pins §2.4's
    // status control OUT of it: "a dive's status is not one of its measurements."
    formCoreStrip: {},
    // The form's header row: the heading, and §2.4's Logged/Planned control beside it.
    // The control belongs HERE and not in `formCoreStrip` above, which §2.2 fixes as date,
    // site, centre, max depth and duration — a dive's status is not one of its
    // measurements, and giving it a sixth slot in that strip would say it was.
    //
    // `headingRow` at the top of this function is the shape, shared with the Dives screen's
    // own title row (`divesHeadingRow` above) — the two differ in the column their screen
    // indents to and in nothing else.
    formHeadingRow: {
      ...headingRow,
      paddingHorizontal: FORM_ROW_INSET,
    },
    // `headingTitle`, the same definition `divesHeading` reads — see it for why the title
    // takes `flex: 1`.
    formHeading: headingTitle,
    // §2.4's Logged/Planned control (M1d). Quiet by construction, on the owner's own brief
    // — "most of the dives will not be created as planned, so this feature should not
    // scream too much" — so it borrows §0.6's existing chip vocabulary (`actionPill`, small
    // and uppercase and tracked and muted) rather than inventing a segmented control this
    // app has nowhere else. It reads as metadata about the form, which is what it is.
    //
    // §0.5's 48 dp floor sits on the Pressable, centred around the visually smaller pill
    // inside it — the same "small visible control, generous hidden target" split
    // `dayStripAction` and `plannedAction` above already use, and the reason the pill is
    // nested rather than being the Pressable itself.
    //
    // **No negative margin.** This carried `marginVertical: -8`, said to "claw back the
    // slack that floor leaves... so the tap target stays 48 dp while the header row keeps
    // the height its heading actually needs" — and that is not what a negative margin
    // does. It shrinks the box the PARENT lays out to 32 dp while leaving this view's own
    // bounds at 48, so the control overhangs `formHeadingRow` by 8 dp top and bottom, and
    // a touch is only ever delivered to a view whose every ancestor also contains the
    // point. The overhanging 16 dp were dead on both platforms: the real target was 32 dp,
    // under the floor the comment claimed it was keeping. The row is simply 48 dp tall now.
    formStatus: {
      minHeight: 48,
      minWidth: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    formStatusPill: actionPill,
    // Only the chosen-and-unusual state fills: a form on Logged is the ordinary case and
    // stays a quiet outline, while Planned — which the diver had to ask for, and which
    // changes what the save does — is visible at a glance. Same `selectedFill`/`selectedInk`
    // pair as the option chips below, so this is not a second way of saying "on".
    formStatusPillOn: selectedFill,
    formStatusLabel: actionPillLabel,
    formStatusLabelOn: selectedInk,
    // **A field is a row, not a box** (DESIGN.md §0.6, M1d design pass) — the root every
    // field on this form shares: FormField.tsx, DateTimeField.tsx, and `OptionChips` /
    // `BooleanField` in DiveFormScreen.tsx. It is `detailRow` one screen over, made
    // typeable: a label leading, the value trailing, and a hairline on the row's TOP edge,
    // "the same rule dive rows follow" (`diveRow` above records at length why the edge is
    // not interchangeable — a top edge draws the line under whatever PRECEDES the row, so a
    // group's header gets a line beneath it and the group's last row closes on whitespace).
    //
    // What it replaces is the reason it exists: a label stacked above a bordered,
    // `surface`-filled, 10-radius input, drawn for every field whether or not it was being
    // used — "five bordered boxes down the core strip was the heaviest chrome in the app"
    // (§0.6), and a depth typed in Archivo inside a box that the detail screen read back in
    // Plex Mono inside no box at all.
    //
    // **`minHeight: 48` is §0.5's floor and carries over from `formFieldHeader`, which this
    // replaces.** It is not spacing and it is not decoration: the `carried ×`
    // (FormField.tsx) and the picker fields' `×` (DateTimeField.tsx) reach the floor through
    // `hitSlop`, and hitSlop is only ever delivered inside a target's ancestors — this row is
    // that ancestor now, exactly as the old label row was, so the vertical slop still lands.
    // It applies to every field rather than only to the rows currently showing a chip, for
    // the same reason it did before: a conditional height would move the input out from under
    // a diver's finger the moment typing dropped the chip.
    //
    // **No vertical padding, deliberately.** `formFieldInput` below carries the same 48, so
    // the input fills the row and the whole 48 dp is a live target for focusing the field.
    // Padding here would leave the row at the floor while the thing a diver actually taps sat
    // short of it — the shape `da2769f` found in four controls at once.
    formField: {
      minHeight: 48,
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: FORM_ROW_INSET,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    // §0.6: "**Focus is what draws the affordance.** The focused row fills with `surface`;
    // nothing else does. The box appears where it is wanted instead of five times over."
    // Composed ON TOP of `formField` above (a two-element style array at the call site),
    // never as a replacement, so a focused row cannot drift from an unfocused one on
    // anything but the fill. `surface` and nothing else — no border, no radius, no shadow:
    // §0.1 spends every hue on depth, and this is the one moment the form has to say "here",
    // so it says it with the token §0.2 reserves for exactly this ("Cards, fields, charts").
    formFieldFocused: {
      backgroundColor: theme.surface,
    },
    // The label/value line inside `formField` above. A separate style rather than putting
    // `flexDirection: 'row'` on the field itself, because a field is not always one line:
    // `OptionChips` puts a wrapping chip row under it, `DateTimeField` puts an opened picker
    // there, notes puts its own box there, and §0.6 fixes that slot as where M2's
    // autocomplete list will go ("The list belongs directly under the focused row").
    //
    // `justifyContent: 'space-between'` is what makes "the value trailing" (§0.6) true for
    // the one field whose value has no `formFieldValue` slot to grow into: hood/gloves/boots
    // put a `formChip` straight in the row, and without this it sat flush against the end of
    // the word "Hood" in the middle of an otherwise empty row. It is a no-op for every other
    // field, whose value slot already carries `flex: 1`.
    //
    // **`minHeight: 48` is §0.5's floor, on the row rather than on one of its children, and
    // it is what puts a label in the same place in every field.** `formField` above states
    // the floor for the FIELD; a field whose value trails meets it through the input's own
    // matching 48 and the field's `justifyContent: 'center'`, so its label sits 24 below the
    // hairline. A field whose value is STACKED underneath — `OptionChips`, notes, an opened
    // picker — has content well past 48 already, so the centring is a no-op and this row
    // collapsed to the height of the label text alone: the label landed 10 below the
    // hairline and read as touching it (reported on the running app, on Settings, where
    // *Units* sat against the rule while *Dives before Ponor* beneath it did not). The floor
    // belongs here, where it holds whether the trailing slot contains an input or nothing at
    // all — and it is what makes `FIELD_EXTRA_CLEARANCE`'s own note ("the row above it... is
    // `minHeight: 48` with its input stretched to match") true of every field rather than of
    // most of them. A no-op wherever the row was already 48, which is every other field.
    formFieldRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    // A field whose value is a CONTROL rather than text — hood/gloves/boots' Yes/No chip,
    // and nothing else today. Composed onto `formField` above at that one call site.
    //
    // `formChip` carries §0.5's 48 dp floor as a real box, and a 48 dp box inside a 48 dp row
    // puts its border exactly on the row's hairlines, top and bottom — three of them in a
    // column read as chips spilling out of their rows. This row can afford the padding
    // `formField` deliberately withholds precisely because it holds no `TextInput`: the rule
    // there exists so an input's own floor cannot end up shorter than the row it fills, and
    // there is no input here to fall short.
    formFieldChoice: {
      paddingVertical: 6,
    },
    // The `carried ×` chip (§0.6, M1d task 5): "muted mono on `border`... gains no
    // colour" — the same monochrome rule `depthValue` exists to be the one exception to
    // (§0.1: colour encodes depth and nothing else). `theme.border` as a FILL, not just
    // the 1 px hairline it draws everywhere else in this file, is what "on border" means
    // here.
    //
    // **No `overflow: 'hidden'`, and that is load-bearing rather than an omission.** It
    // clipped nothing visible — the chip's two children are `Text` nodes with no fill and
    // no radius of their own, and no `android_ripple` is configured — but it did clip the
    // `×`'s `hitSlop`. React Native only descends into a view's subviews for a point
    // outside that view when the view does NOT clip to bounds (`RCTView.hitTest`), so this
    // one property was the whole reason the clear target could not extend past the chip,
    // and therefore the reason it was pointed INWARD over the word "carried" instead. See
    // `CLEAR_HIT_SLOP` (FormField.tsx).
    formFieldCarried: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 6,
      backgroundColor: theme.border,
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
    //
    // `paddingHorizontal` is 14 rather than 10 so that the visible zone plus the slop the
    // layout can actually deliver OUTWARD reaches §0.5's floor without any of it reaching
    // back over the word "carried" — see `CLEAR_HIT_SLOP` (FormField.tsx) for the whole
    // arithmetic. Four dp is what separates a compact chip from a control that clears a
    // field when a diver taps its label. The room that slop is delivered into is
    // `FORM_ROW_INSET` (this function's own top), the field row's own trailing padding —
    // 20 dp inside the row's unclipped box, where it used to be 20 dp of ScrollView padding
    // outside the field entirely.
    formFieldCarriedClear: {
      borderLeftWidth: 1,
      borderLeftColor: theme.fgMuted,
      paddingHorizontal: 14,
      paddingVertical: 5,
    },
    formFieldCarriedClearLabel: {
      fontFamily: fonts.mono,
      fontSize: 11,
      color: theme.fgMuted,
    },
    // `rowLabel` (this function's own top) — the detail screen's `detailLabel`, exactly, so
    // "Max depth" reads the same on the screen you type it into as on the screen you read it
    // back from. It was Archivo **14** in its own private definition until the M1d design
    // pass; §0.6 sets 15 and names the detail row as the source.
    //
    // `flexShrink: 1` rather than `flex: 1`: the same wrapping requirement `tripTitle` above
    // documents (Czech runs 20-30 % longer than English) still has to hold, and shrink is
    // what lets a long label wrap. Growing is deliberately left to `formFieldValue` below,
    // whose `flexBasis: 0` means the label absorbs ALL of the shrinking when the two compete
    // — so a long Czech label wraps to a second line and the value keeps its column, rather
    // than the value being squeezed to nothing.
    formFieldLabel: {
      ...rowLabel,
      flexShrink: 1,
    },
    // A row's trailing half: the input, and the unit that follows it. `flex: 1` (basis 0) so
    // it takes whatever the label leaves and the value lands hard against the row's trailing
    // edge, the same place `detailValue`'s own `textAlign: 'right'` puts it one screen over.
    formFieldValue: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 5,
    },
    // The typed value itself — `rowValueSans`, i.e. `detailValueText` made editable. **No
    // border, no radius, no fill:** §0.6 gives the box to focus alone (`formFieldFocused`
    // above), so an unused field draws nothing at all.
    //
    // `minHeight: 48` is §0.5's floor on the thing a diver actually taps to start typing, and
    // it deliberately matches `formField`'s own so the input fills the row rather than
    // floating in the middle of it — the row's whole height focuses the field. `padding: 0`
    // because the row owns the inset now; the input's own 12/10 would have offset the value
    // from the label beside it.
    formFieldInput: {
      ...rowValueSans,
      flex: 1,
      minHeight: 48,
      padding: 0,
    },
    // §0.6: "Figures in mono, names in sans... a depth, duration, pressure or temperature is
    // a data figure and takes Plex Mono 15 with tabular figures (§0.2); a site, centre or
    // buddy is a name and stays Archivo." Composed ON TOP of `formFieldInput` above, never
    // standalone, and chosen EXPLICITLY per field at the call site (`FormField`'s `mono`
    // prop) — the same rule, and the same reason, `DiveDetailScreen`'s own `Field.mono`
    // follows: a new field must not be able to pick up the wrong face by accident, and the
    // keyboard a field asks for is not the same question (latitude and a cylinder count both
    // take a numeric keypad; only one of them is a figure a diver reads back).
    formFieldInputMono: rowValueMono,
    // The unit that follows a figure, "as a muted suffix, exactly as `12.2 m` reads on the
    // detail" (§0.6). Mono like the figure it qualifies and muted so it never competes with
    // it — the same relationship `depthUnit` above draws between a depth and its `m`, at row
    // scale. It is a sibling `Text`, never concatenated into the input's own value: what the
    // diver typed has to stay exactly what the form holds.
    //
    // Rendered only while the field HAS a figure. An empty numeric field shows its unit as
    // the placeholder instead (§0.6: "so the row still says what belongs in it"), which is
    // the same word in the same slot — drawing both would read as "m m".
    formFieldUnit: {
      fontFamily: fonts.mono,
      fontSize: 15,
      color: theme.fgMuted,
    },
    // Notes, and notes alone: the one field the detail screen does NOT render as a row —
    // there it is `detailNotes`, a full-width paragraph under its cluster, because a
    // paragraph right-aligned in a trailing slot is unreadable. So the form follows it there
    // too: the label keeps its row, and the box drops to the full width beneath it, in the
    // same face, size, ink and line height `detailNotes` uses.
    //
    // `flex: 0` undoes `formFieldInput`'s own `flex: 1` (basis 0), which in a COLUMN would
    // resolve to zero height and leave the field invisible. `marginBottom` is
    // `FIELD_EXTRA_CLEARANCE` — see that constant for why anything below a row owns its own
    // clearance to the next row's hairline.
    formFieldInputMultiline: {
      flex: 0,
      alignSelf: 'stretch',
      minHeight: 96,
      lineHeight: 22,
      textAlign: 'left',
      textAlignVertical: 'top',
      marginBottom: FIELD_EXTRA_CLEARANCE,
    },
    // DateTimeField.tsx's trigger (M1d, date/time pickers): the control that stands where a
    // `formFieldInput` stands for every other field, so the form reads as one column of
    // identically-shaped rows rather than one odd row among six. Deliberately the same slot
    // as `formFieldInput` above — same `flex: 1`, same 48 dp floor (§0.5), and since the M1d
    // design pass the same absence of a box — because it IS that field, with a picker behind
    // it instead of a keyboard.
    //
    // `justifyContent: 'center'` rather than the input's own text-centring: this holds a
    // `Text`, not a `TextInput`, and a `Text` does not vertically centre itself in a box
    // taller than its line. `alignItems: 'flex-end'` is what `textAlign: 'right'` does for
    // the input — the value trails, like every other value in the column.
    formFieldPicker: {
      flex: 1,
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'flex-end',
    },
    // The value the trigger shows — `rowValueMono`, the same face `detailValue` gives the
    // "Date" and "Time in" rows one screen over, which is what §0.2 reserves for a timestamp.
    //
    // It used to be Archivo, under a comment arguing that "one mono row among six sans ones
    // reads as a different KIND of field rather than as data." That was true of the form as
    // it stood, where every value was sans and mono would have been the odd one out; §0.6's
    // design pass removes the premise rather than the conclusion. The form is a mixed column
    // of figures and names now, exactly as the detail screen is, and a date is a figure in
    // both places or in neither.
    formFieldPickerText: rowValueMono,
    // "Not set" — an optional field the diver never recorded (`timeIn`). Same muted ink
    // `formFieldInput`'s own placeholder uses (FormField.tsx reads `formFieldLabel.color`
    // for exactly this), so an unset picker field and an empty text field look equally
    // empty rather than one of them looking filled in.
    formFieldPickerTextUnset: {
      ...rowValueMono,
      color: theme.fgMuted,
    },
    // The native picker itself, once the trigger opens it — in the slot §0.6 fixes for
    // anything a field puts under its own row. `alignSelf: 'flex-start'` keeps the OS control
    // at its own intrinsic width instead of stretching it across the form.
    //
    // No `marginTop` any more: `formField`'s own `gap` is what separates this from the row
    // above it now, and the two stacked read as roughly double what either asked for.
    // `marginBottom` is `FIELD_EXTRA_CLEARANCE` — see that constant.
    formFieldPickerControl: {
      alignSelf: 'flex-start',
      marginBottom: FIELD_EXTRA_CLEARANCE,
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
    // `paddingHorizontal` and the absent `overflow` match `formFieldCarriedClear` above for
    // the same reason: this `×` reaches §0.5's floor through slop pointed outward, and a
    // clipping ancestor — or this view's own clip, for the subviews it does not have — is
    // what decides whether that slop is delivered at all.
    formFieldClear: {
      borderRadius: 6,
      backgroundColor: theme.border,
      paddingHorizontal: 14,
      paddingVertical: 5,
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
    },
    // The disclosure control — §0.5's own "48 dp minimum tap targets, including each
    // group's header." No `paddingTop` on `formGroup` above to stack under it: that floor
    // already leaves roughly 19 px of slack around a 10.5 px label, and the two together read
    // as a gap nothing asked for — the same arithmetic `detailHero`/`detailBack` above record.
    formGroupHeader: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: FORM_ROW_INSET,
    },
    // §0.6: "**A group header is a cluster label** — Plex Mono 10.5, uppercase, +0.14 em,
    // muted. *Conditions* and *Gas & cylinders* name the same groups on both screens and used
    // to carry two different treatments." `clusterLabel` at the top of this function is that
    // one treatment, read here and by `detailClusterTitle` above; this was Archivo Medium 15
    // in full ink, which is a heading, and the same words one screen over were a mono label.
    formGroupTitle: {
      ...clusterLabel,
      flex: 1,
    },
    // §0.6: "**A collapsible group is marked by a chevron, not by the words 'Show'/'Hide'.**
    // **Drawn, not typed** — the same reason §0.6 already gives for rating marks: a glyph's
    // size varies by typeface, so a typed chevron looks broken somewhere. It rotates to show
    // state, needs no translation, and drops a word from a row that is otherwise pure
    // structure."
    //
    // Drawn exactly as `reorderArrowUp`/`reorderArrowDown` above are, and for the reason
    // those record: neither bundled font (Archivo, IBM Plex Mono — theme/fonts.ts) carries a
    // chevron code point, so a typed one renders as tofu or nothing, device-dependent. That
    // finding is what made the header carry the WORD "Show"/"Hide" until now; §0.6 keeps the
    // finding and changes the conclusion, because a glyph is not the only alternative to a
    // word. Two adjacent borders on a zero-content box, rotated, is the same no-image
    // no-path-library technique the reorder arrows use for a triangle.
    //
    // `fgMuted` — the same ink `formGroupTitle` beside it wears, so the mark reads as part of
    // the header rather than as the loudest object on a row of quiet ones. The 2 dp stroke is
    // the smallest that stays visible against `bg` in both themes at this size.
    formGroupChevron: {
      width: 9,
      height: 9,
      borderRightWidth: 2,
      borderBottomWidth: 2,
      borderRightColor: theme.fgMuted,
      borderBottomColor: theme.fgMuted,
      // 45° clockwise turns the box's bottom-right corner — the only corner its two borders
      // draw — into a chevron pointing DOWN: closed, "there is more below this."
      transform: [{ rotate: '45deg' }],
    },
    // The same mark turned through a half-circle, so open points UP. A second `transform`
    // rather than an `Animated` value: nothing else in this app animates yet, and a rotation
    // that snaps is still a rotation — §0.6 asks the mark to SHOW state, not to perform the
    // transition. Composed over the base style, which is why this repeats `transform` (the
    // whole property is replaced, not merged) and nothing else.
    formGroupChevronExpanded: {
      transform: [{ rotate: '225deg' }],
    },
    formGroupBody: {
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
    // In the slot §0.6 gives a field's second line, under its own label row — a fixed-choice
    // field cannot put six water-body chips at Czech length into a trailing slot without
    // wrapping them into a column two words wide.
    //
    // It is therefore the one thing on this form that does NOT trail, and that is deliberate:
    // this is a set of options to read through, not a value to read off, and a set reads
    // left-to-right. Trailing them was tried on the simulator first and is what made the
    // decision — six chips fill the first line and push the seventh to the far right, so the
    // block is left-aligned except for one orphan hanging under its own last chip.
    // `paddingBottom` is `FIELD_EXTRA_CLEARANCE` — see that constant.
    formChipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingBottom: FIELD_EXTRA_CLEARANCE,
    },
    // **A chip is filled** — the owner's call after seeing the form built, now written into
    // §0.6: "`surface` behind an unselected chip, `action` ink behind the selected one — the
    // same invert the save control uses, so 'the chosen thing is the inverted thing' is one
    // rule across the app."
    //
    // The fill was taken away during the M1d design pass, under the reading that §0.6's
    // "The focused row fills with `surface`; nothing else does" spent the token on the
    // focused row alone. §0.6 now answers that directly rather than leaving it inferred, and
    // it does so with its eyes open: "This does put a `surface` fill on two different things
    // (a chip, and the focused row); they are told apart by shape and scale rather than by
    // colour, a small pill inside a row against a full-bleed fill. Recorded as a known
    // trade-off, not an oversight." So the outline stays *and* the ground comes back — an
    // unfilled chip on the app's `bg` reads as an outline drawn on nothing, which is the
    // opposite failure from the one the removal was fixing.
    //
    // The at-rest/chosen pair is still exactly `actionPill`/`selectedFill`'s, the one §2.4's
    // Logged/Planned control one row up already wears, rather than a second way of saying
    // the same thing; only the at-rest ground is new.
    // `flexDirection: 'row'` and the 6 dp gap are what let §0.6's icon stand BESIDE the
    // label rather than over it — "it supplements the label rather than replacing it, never
    // an icon alone." A chip with no icon (four of the five fields, and `other` on the
    // fifth) is a row of one child, which lays out exactly as the centred column did.
    formChip: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      backgroundColor: theme.surface,
    },
    // `selectedFill`/`selectedInk` at the top of this function — the §0.1 inverted-ink
    // pair every "this one is chosen" state in the app shares, rather than a second
    // colour meaning invented per control.
    formChipSelected: selectedFill,
    formChipText: {
      fontFamily: fonts['sans-medium'],
      fontSize: 13.5,
      color: theme.fg,
    },
    formChipTextSelected: selectedInk,
    // The save action's fixed footer (§0.5: "the primary action sits in the bottom
    // third"; brief step 4: never disabled). Sits OUTSIDE `formScroll` above as a
    // sibling, not inside it, so it stays reachable without scrolling to the end of a
    // long form — "one scroll view" (brief) describes the form's OWN fields, not this
    // persistent action bar.
    formFooter: {
      paddingHorizontal: FORM_ROW_INSET,
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
    // The blocking-field notice (M1d task 6 fix wave; reshaped in task 7): shown under the
    // one field whose value stopped a save, so a diver who typed a date the schema cannot
    // read is told that, rather than tapping Save and watching nothing happen at all.
    //
    // It used to spread `noticeBanner` — a bordered, `surface`-filled, 12-radius box — and
    // that was the defect, found by using the app: directly beneath the bordered,
    // `surface`-filled input this form drew back then it rendered as *the same object one row
    // down*, so the message read as a second, empty field rather than as a sentence about the
    // field above it. §0.1 rules out solving that with a red, so the lever is shape and
    // weight: no box at all, and text a size smaller than the input's, in muted ink with
    // medium weight. The wrapping View stays for the spacing alone — see FieldNote
    // (DiveFormScreen.tsx).
    //
    // §0.6 states the finished rule: "**A field error is text, not a field.** Muted,
    // trailing, under the row it belongs to." *Trailing* is what `alignItems: 'flex-end'`
    // (and the text's own `textAlign`) adds here — the message lands in the same column as
    // the value it is about, rather than under the label, which names the field and is not
    // what went wrong. `paddingHorizontal` is `FORM_ROW_INSET`, so it sits in the same
    // column every row on this form does; it draws no hairline, because it is not a row.
    formFieldError: {
      alignItems: 'flex-end',
      paddingHorizontal: FORM_ROW_INSET,
      paddingTop: 2,
      paddingBottom: 8,
    },
    formFieldErrorText: {
      fontFamily: fonts['sans-medium'],
      fontSize: 12.5,
      color: theme.fgMuted,
      textAlign: 'right',
    },
    // The form's own way out (M1d task 7) — `backControl` at the top of this function, the
    // one definition `detailBack` above also uses, so the two screens' exits cannot drift
    // into two different treatments. `FORM_ROW_INSET` rather than the detail screen's 16: it
    // aligns to this form's own row inset, which is what the heading directly beneath it —
    // and every field row below that — is aligned to.
    formBack: {
      ...backControl,
      paddingHorizontal: FORM_ROW_INSET,
    },
    formBackLabel: backControlLabel,
    // ------------------------------------------------------------------------------------
    // Settings (DESIGN.md §3, M1's two entries: units and `dives_before`)
    // ------------------------------------------------------------------------------------
    // The screen is a column of §0.6 rows, exactly as the form is — "a field is a row, label
    // leading, value trailing" — so it borrows the form's scroll shape and its row inset
    // rather than inventing a third vocabulary for the same objects. Every row-level style
    // it uses (`formField`, `formFieldRow`, `formFieldLabel`, `formChipRow`, `formChip`) is
    // literally the form's, read through the shared components; only the three keys below
    // are its own, and each is a thing the form has no equivalent of.
    settingsScroll: rowScroll,
    settingsContent: rowScrollContent,
    // The screen's title — `screenHeading` at the top of this function, the form's own, plus
    // the row inset so it lands in the same column as the labels beneath it. The tab bar
    // names this screen too, and the title still earns its place: a tab label is chrome the
    // eye skips, and this is the first line of the page.
    settingsHeading: {
      ...screenHeading,
      paddingHorizontal: FORM_ROW_INSET,
    },
    // A sentence under a row, explaining what the row does — `dives_before`'s "every dive
    // number moves with this", and the note shown when the stored value cannot be read.
    //
    // Shaped after `formFieldError` (§0.6: "A field error is text, not a field. Muted...")
    // and turned around: that message trails, into the column of the value it is about,
    // because it names what went wrong with something the diver typed. This one LEADS,
    // under the label, because it explains what the row IS — read before the value, not
    // after it. Same absence of a box, for the reason recorded there: a bordered, filled
    // message under a row reads as a second, empty row.
    settingsCaption: {
      paddingHorizontal: FORM_ROW_INSET,
      paddingTop: 6,
    },
    settingsCaptionText: {
      fontFamily: fonts.sans,
      fontSize: 12.5,
      color: theme.fgMuted,
      lineHeight: 17,
    },
    // ------------------------------------------------------------------------------------
    // The tab bar (DESIGN.md §3's note — "Tabs go to the bottom")
    // ------------------------------------------------------------------------------------
    // **One key, and that is the point.** The bar is the platform's own — `NativeTabs`
    // (expo-router/unstable-native-tabs) renders a real `UITabBarController` on iOS, so its
    // ground, its hairline, its height and its tap targets are UIKit's and not this sheet's.
    // This file previously carried a `tabBar` fill-plus-hairline and a `tabBarItem` with
    // §0.5's 48 dp floor, and both are gone rather than merely unused: painting a ground
    // would replace the Liquid Glass material the native bar exists to give us, and
    // asserting a minimum height would be this app second-guessing metrics a diver's thumb
    // is already calibrated to.
    //
    // The label stays here, because type is the app's (§0.2 splits the two faces on
    // content, and a tab label is UI chrome — the same category as `actionLabel` and
    // `actionPillLabel`, never a data figure). `fgMuted` is the resting ink; the selected
    // tab's is `tintColor`, a prop rather than a style, because that is the shape the
    // navigator's own options take (navigation/tabs.ts).
    tabBarLabel: {
      ...tabBarLabelType,
      color: theme.fgMuted,
    },
    // ------------------------------------------------------------------------------------
    // The browser's tab bar (`(tabs)/_layout.web.tsx`)
    // ------------------------------------------------------------------------------------
    // **Web draws its own bar, so this sheet has to say what the native one says for itself.**
    // `NativeTabs`' web implementation is a Radix tab list fixed at `top: 24px`, centred
    // (`expo-router/assets/native-tabs.module.css`), which is §3's "tabs go to the bottom"
    // turned upside down and, at a narrow viewport, sits underneath the top-right capsule.
    // The browser gets expo-router's ordinary JS `Tabs` instead — a real bottom bar — and
    // everything UIKit supplies on the device has to be named here.
    //
    // `bg`, not `surface`: this bar is docked to the bottom edge with the list running up to
    // it, so it is the ground continuing rather than an object resting on it (§0.2). The
    // hairline above it is the app's own `border`, drawn on the bar's TOP edge — the same
    // rule §0.6 gives every other separator in the app, and it has to be stated because
    // react-navigation's default would otherwise draw its own theme's hairline, which knows
    // nothing about the scheme (the same class of defect as the `#272727` the native web bar
    // fell back to).
    //
    // The height is react-navigation's, deliberately, exactly as the native bar's is UIKit's:
    // §0.5's 48 dp floor is the navigator's to keep, and a `height` here would be this sheet
    // second-guessing it in one place out of two.
    // `borderColor`, not `borderTopColor`, and that is empirical rather than stylistic: only
    // the top edge has a width, so the two say the same thing here — but react-navigation
    // sets the shorthand `borderColor` from ITS theme, and react-native-web resolves a
    // shorthand against a longhand by generated-CSS order rather than by the order of the
    // style array, so the longhand lost and the hairline came out `rgb(216, 216, 216)` (the
    // navigator's own literal) on BOTH schemes. Seen in the browser with `getComputedStyle`,
    // not deduced. Matching the property the navigator uses is what lets the app's own token
    // win, since `tabBarStyle` is last in that array.
    webTabBar: {
      backgroundColor: theme.bg,
      borderTopWidth: 1,
      borderColor: theme.border,
    },
    // The same tab label, minus the colour — and the omission is the whole reason this is a
    // second key rather than `tabBarLabel` above. The JS navigator composes
    // `[{ color: activeOrInactiveTint }, tabBarLabelStyle]` in that order
    // (`BottomTabItem.js`), so a `color` here would win over `tabBarActiveTintColor` and the
    // selected tab's label would never change ink — silently, since both are valid colours.
    // The face and the size are shared rather than retyped, so the two bars cannot drift on
    // what a tab label looks like.
    webTabBarLabel: {
      ...tabBarLabelType,
    },
  });
}

const sheets = { light: build('light'), dark: build('dark') };

export function makeStyles(scheme: ColorScheme) {
  return sheets[scheme];
}

export type Styles = ReturnType<typeof makeStyles>;

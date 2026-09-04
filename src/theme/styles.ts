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
 * app — every screen's root `View`, the Dives list's included since M1k took away the pinned
 * bar that used to spend it — because it is one rule (§4.1), and a second helper computing
 * the same clearance for a different screen is the drift this project keeps paying for.
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

/**
 * The **floor** under `screenBottomInset` below, and a deliberate near-duplicate of
 * `MIN_SCREEN_TOP_INSET` above rather than a second use of it (§4.1: "a deliberate
 * near-duplicate names its siblings"). The two hold the same number and answer different
 * questions. The top's 48 is what a phone with neither notch nor island needs to clear its
 * status bar. This one is the breathing room a control wants above the bottom edge on the
 * platforms whose tab bar is IN FLOW beneath the screen instead of drawn over it — the
 * browser's JS bar (`(tabs)/_layout.web.tsx`) and Android's, where `insets.bottom` is 0 or a
 * thin gesture strip and nothing at all is obscured. Sharing one constant would assert that
 * a future device moving one edge must move the other, and nothing here has measured that.
 */
const MIN_SCREEN_BOTTOM_INSET = 48;

/**
 * **How far above the bottom of the display a control must sit: the greater of the device's
 * own bottom safe-area inset and the app's floor above.** `screenTopInset`'s sibling in
 * every sense — same shape, same reason, other edge — and, like it, one function rather than
 * a number any screen is free to guess at.
 *
 * **The inset already contains the tab bar, and that was measured rather than reasoned.**
 * Running on an iPhone 17 Pro, `useSafeAreaInsets().bottom` reports **83** on a screen inside
 * `(tabs)` and **34** on the dive form, which is a root-Stack screen drawn over the tabs:
 * 34 pt of home indicator, plus the 49 pt `UITabBar` wherever there is one. `NativeTabs`
 * ((tabs)/_layout.tsx) renders a real `UITabBarController`, UIKit folds that bar into the
 * child controller's `safeAreaInsets`, and react-native-screens reports each screen's own
 * insets rather than the window's — so a screen under the tab bar asks this one function and
 * gets the bar and the home indicator together. There is no bar height to look up and none
 * to keep in step with when iOS changes it.
 *
 * **The defect it exists to prevent.** `emptyStateWrap` carried a flat `paddingBottom: 48`
 * — 35 pt short of the 83 the device reports — so "Log your first dive" rendered UNDERNEATH
 * the iOS 26 Liquid Glass tab bar: the label illegible through the material, only the
 * button's left edge exposed. The exposed sliver still opened the form, which is the worst
 * version of this — nothing was broken, so nothing failed. §0.6 leaves the top-right capsule
 * off the empty logbook on purpose, so that button is a brand-new diver's ONLY way to log a
 * dive, and the constant hid the one control the screen exists for.
 *
 * It survived because the development database has held dives since M1a, so the branch had
 * never once rendered on a device; and no unit test can see it, because a tab bar is a
 * layout fact of a real `UITabBarController` and not of a Jest tree. That is why the tests
 * next door pin that the number comes from the device AT ALL rather than restating whichever
 * number one phone produces, and why the fix was looked at on a simulator before it was
 * called done.
 *
 * The `max` is a floor and not a clamp, exactly as at the top: in the browser and on Android
 * the tab bar is a sibling below the screen rather than glass over it, `insets.bottom` is 0
 * or a gesture strip, and the empty state keeps the 48 it has had since M0.
 *
 * **A caller with its own gap composes it into the argument**, not onto the result:
 * `screenBottomInset(insets.bottom + 24)` is what `EmptyState` asks, so the gap is spent
 * over the tab bar where there is one, and the app's floor still wins where the device
 * reports nothing at all. Added to the result instead, the browser would gain 24 pt it has
 * never had and never needed. The gap itself is the call site's business and is written
 * there, exactly as `DiveFormScreen`'s footer and `SearchScreen`'s dock write theirs — this
 * function owns the clearance, never how much air a particular control wants above it.
 *
 * **One call site today, and the two queued behind it.** Only `EmptyState` asks — it is the
 * app's only control pinned to the bottom of a tab screen. Two constants are the same rule
 * waiting to be asked and are deliberately NOT converted here, because each is a scroll
 * view's content padding rather than a fixed child, which is a different question (a list may
 * legitimately scroll its last row under a bar that has a scroll-edge effect): `listContent`'s
 * 24 on the Dives list, and `rowScrollContent`'s 40, which Settings shares with the dive form
 * — one screen under the bar and one over it, so that definition has to be split before
 * either can ask. **The moment either is converted this stops being a local fix and this
 * function is the owner they both ask**, which is the whole reason it is a function here and
 * not a `Math.max` written inline in a component.
 */
export function screenBottomInset(safeAreaBottom: number): number {
  return Math.max(safeAreaBottom, MIN_SCREEN_BOTTOM_INSET);
}

function build(scheme: ColorScheme) {
  const theme = themeFor(scheme);

  // **How far in from a screen's side edges its content begins** — the app's one content
  // column, and the horizontal half of the pair `SCREEN_HEADING_TOP` below completes. Every
  // screen hangs everything it draws off this: the Dives title and its summary, trip headers,
  // dive rows, the day strip, the floating capsule's trailing edge, the first-run block, the
  // dive detail's hero, back control and clusters, every form row and group header, and
  // Settings' own title and rows.
  //
  // **It was two numbers until M1l** (the owner: *"I think there is no reason to have them
  // different"*). The list was at 16 and the form, the detail screen's clusters and Settings
  // at 20, under a constant called `FORM_ROW_INSET` — and the difference was visible exactly
  // where two things stack and are left-aligned. The owner found it comparing the Dives title
  // against Settings'; M1d had already found the same 4 pt step inside one screen, between the
  // detail's back control and the hero title under it, and fixed that one by moving the
  // control to 16. This is that fix applied to the whole app instead of one control.
  //
  // **The 20 had two stated reasons and both had expired.** Its own docblock recorded the
  // first as retired with M1h: the `carried ×` chip's outward `hitSlop` needed 20 dp of room
  // inside the field's unclipped box, and `clearFieldControl` replaced it with a real 48 dp
  // box laid out IN the row, which needs width rather than slop — and a narrower inset hands
  // the row 8 pt more of it, not less. The second was that a form field's text should land on
  // "the same 20 `detailContent` uses one screen over", which is 20 justified by 20; the
  // detail screen's own 20 was in turn justified as an "indented column" against the hero's
  // full-bleed 16, a contrast that cost the screen a left edge to buy a distinction the
  // hairlines were already making.
  //
  // **Named for the rule, not for its first caller** (§0.6's `disclosureChevron`, not
  // `formGroupChevron`). `FORM_ROW_INSET` stopped being true of anything the moment the number
  // was the app's; and two spellings of one distance is precisely how the 56 pt title gap
  // `SCREEN_HEADING_TOP` exists to close stayed invisible for four milestones.
  //
  // Not every 16 in this sheet is this rule: a notice banner's inner padding, a search
  // capsule's, and the `action` button's own label padding are distances INSIDE an object,
  // and they stay literals because they answer a different question.
  const CONTENT_INSET = 16;

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
    marginHorizontal: CONTENT_INSET,
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

  // A control that is a deliberate act rather than the screen's primary one: *Delete dive*,
  // *Delete preset*, and the dive form's own *Save as preset*. §0.1 spends every hue on
  // depth, so there is nothing to make a destructive control look destructive — and a plain
  // muted label is exactly right for one you should not hit by accident (§10: "a destructive
  // confirmation is OS chrome; the app's own control stays muted"). The weight goes into the
  // platform dialog that follows, which this app does not draw.
  //
  // One definition rather than three literals, the same reasoning `backControl` above
  // records. It was already three: `detailDelete`/`detailDeleteLabel` below, and
  // `formPresetActionLabel`, whose own comment said it was "`detailDelete`'s shape" while
  // being a byte-identical retyping of it. The call sites differ in how they are PLACED — the
  // two deletes are centred at the end of their screen's content, the preset control trails
  // inside a group of trailing-value rows — and that is set there.
  const mutedControl: ViewStyle = {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  };
  const mutedControlLabel: TextStyle = {
    fontFamily: fonts['sans-medium'],
    fontSize: 14,
    color: theme.fgMuted,
  };

  // A sentence under a row or a heading, explaining what the thing IS — Settings'
  // "Dives you logged before Ponor", and the account screen's line about what an account is
  // for. §0.6's "a field error is text, not a field" turned around: that message trails, into
  // the column of the value it is about, because it names what went wrong with something the
  // diver typed; this one LEADS, under the label, because it is read before the value rather
  // than after it. Same absence of a box, for the reason `formFieldError` records — a
  // bordered, filled message under a row reads as a second, empty row.
  //
  // One definition rather than two, the same reasoning `noticeBanner`, `backControl` and
  // `mutedControl` above each record. It was Settings' alone until §3's "account & sync"
  // needed the identical sentence-under-a-row, and a second screen retyping five properties
  // is exactly how `reorderNotice`/`settingsNotice` came to be two copies of one banner.
  const captionBlock: ViewStyle = {
    paddingHorizontal: CONTENT_INSET,
    paddingTop: 6,
  };
  const captionText: TextStyle = {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: theme.fgMuted,
    lineHeight: 17,
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
  // **How tall a floating capsule is.** §0.5's 48 dp tap floor, met with nothing to spare, and
  // the radius above is half of it. It was briefly the Dives title's `minHeight` as well (M1l,
  // reversed in M1m — the clearance the summary line needs comes out of WIDTH now, see
  // `DIVES_HEADER_TRAILING_INSET` below), so this is a name with one consumer again; it stays
  // named because the three lines beneath it are geometry too and a bare 48 among them would be
  // the only one that could not be pointed at.
  const CAPSULE_HEIGHT = 48;
  // **One glyph's box inside a capsule** — §0.5's floor as a real target rather than `hitSlop`
  // (`capsuleGlyph` below), and a square: the ink is the glyph, so the box is as wide as it is
  // tall. Its own 48 is a deliberate near-duplicate of `CAPSULE_HEIGHT` above rather than a
  // second use of it (§4.1's rule, `MIN_SCREEN_BOTTOM_INSET`'s own note): both are §0.5's floor,
  // and a capsule that ever gained vertical padding would move one and not the other.
  const CAPSULE_GLYPH = 48;
  // The hairline BETWEEN two glyphs, never leading or trailing (`capsuleDivider` below, and
  // ActionCapsule.tsx renders it only for `index > 0`) — which is why `actionCapsuleWidth`
  // counts one fewer of these than it counts glyphs.
  const CAPSULE_DIVIDER = 1;
  // The action capsule's own inner padding, the whole of what it adds around its glyphs.
  const ACTION_CAPSULE_PADDING = 4;
  /**
   * **How wide the action capsule is with `glyphs` glyphs in it**, and it is a function because
   * the capsule is sized BY its glyphs rather than told a width: `actionCapsuleShape` carries no
   * `flex` and no `width`, so this is Yoga's own sum written down, not a second opinion about it.
   *
   * It exists because something outside the capsule now has to know where its leading edge is —
   * the Dives header's text column, which must stop short of it (`DIVES_HEADER_TRAILING_INSET`).
   * Written as a function of the glyph count rather than as the 105 pt the capsule measures
   * today, because §3 expects a third glyph (M2's Map, M3's Stats, Calendar's view toggle) and
   * that addition must move the header column with it. DivesScreen.test.tsx pins the count this
   * screen actually renders against the count the inset assumes, which is the half of that a
   * stylesheet cannot check.
   */
  const actionCapsuleWidth = (glyphs: number) =>
    ACTION_CAPSULE_PADDING * 2 + glyphs * CAPSULE_GLYPH + Math.max(glyphs - 1, 0) * CAPSULE_DIVIDER;
  const capsuleBase: ViewStyle = {
    height: CAPSULE_HEIGHT,
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
    paddingHorizontal: ACTION_CAPSULE_PADDING,
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

  // **How far below the safe area a screen's title begins** — the "ordinary heading padding"
  // §0.6 names, and the second half of `screenTopInset`'s rule rather than a spacing choice
  // of anyone's. Every root in the app composes that inset; this is what each of them then
  // puts between it and the first line of the page, so the form's, Settings' and the Dives
  // list's titles land on one line across the app.
  //
  // **One constant because the owner made it a requirement** (M1k): the Dives title sat a
  // whole pinned bar — 56 pt — below every other screen's, which he found by putting Dives
  // and Settings side by side. The form and Settings reach it through their scroll's own
  // `rowScrollContent` below; the Dives title carries it itself, since its scroll's content
  // padding has to stay at nothing (`listContent`). Two spellings of one distance is exactly
  // how the 56 pt gap became invisible, so there is one number and both read it.
  const SCREEN_HEADING_TOP = 4;

  // **How much air the Dives header's text keeps beside the floating capsule.** A distance
  // between two objects rather than one inside either, so it is its own number: a deliberate
  // near-duplicate of `searchDock`'s own 12 — the gap between the search field and the action
  // capsule on the search screen — and NOT a shared constant with it, because that one is a
  // flex `gap` between two capsules in a row and this is clearance from a floating shape to
  // text underneath it. §4.1's "a deliberate near-duplicate names its siblings"; sharing would
  // assert that restyling the search dock must move the Dives header, which nothing has decided.
  //
  // It is not zero, though §0.6 says the column stops "at the capsule's leading edge": at zero
  // the sheet's own three-digit example fits `128 dives · 96 h 12 min · deepest 41.2` on the
  // first line and orphans the `m`, which is the arithmetic being right about the wrong question
  // one more time. Text needs air from glass; 12 is what the app already gives it.
  const CAPSULE_CLEARANCE = 12;

  // **How far the Dives header's text column stops short of the screen's trailing edge** (§0.6,
  // M1m — the correction to M1l). The floating capsule's trailing edge sits at `CONTENT_INSET`
  // (`capsuleFloat`), so its LEADING edge is that plus its own width, and the header's text
  // stops one `CAPSULE_CLEARANCE` before that. The summary line then wraps under the capsule
  // instead of into it, which is what the owner's sheet draws.
  //
  // **Derived from the capsule, never typed.** `actionCapsuleWidth` above is the capsule's own
  // geometry summed; the 105 pt it currently returns appears nowhere. That matters twice: §3
  // expects a third glyph in this capsule, which widens it, and §0.5's 48 dp floor could move
  // under both. A hand-typed number here is the two-spellings-of-one-distance defect
  // `SCREEN_HEADING_TOP` and `CONTENT_INSET` were each written about — and this screen has now
  // been bitten by it twice.
  //
  // **The glyph count is the one part that is not derived**, because the capsule's glyphs are a
  // prop (DivesScreen.tsx's `capsuleActions`) and a scheme-only sheet cannot read a render.
  // DivesScreen.test.tsx closes that by counting the glyphs the screen actually renders and
  // requiring this inset to clear a capsule of that many — so §3's third glyph fails here rather
  // than arriving as a header line back under the glass.
  const DIVES_CAPSULE_GLYPHS = 2;
  const DIVES_HEADER_TRAILING_INSET =
    CONTENT_INSET + actionCapsuleWidth(DIVES_CAPSULE_GLYPHS) + CAPSULE_CLEARANCE;

  // **The same clearance for the Map tab's header, and it is a different number because that
  // capsule holds a different number of glyphs** — one, the layer toggle §3 asks for ("toggle
  // to explore all community sites"), against the Dives screen's magnifier and `+`.
  //
  // Two constants rather than one, and derived rather than typed, for exactly the reason
  // `actionCapsuleWidth` exists: the inset is a consequence of what is in the capsule, so the
  // screen with fewer glyphs must get a narrower reserve on its own rather than inheriting the
  // other screen's. Sharing one number would put 61 pt of empty reserve on this title today and
  // would silently under-reserve the day either capsule changes. `MapScreen.test.tsx` counts the
  // glyphs this screen actually renders against the count assumed here, exactly as
  // `DivesScreen.test.tsx` does for its own — the half a scheme-only sheet cannot see.
  const MAP_CAPSULE_GLYPHS = 1;
  const MAP_HEADER_TRAILING_INSET =
    CONTENT_INSET + actionCapsuleWidth(MAP_CAPSULE_GLYPHS) + CAPSULE_CLEARANCE;

  // The row that title sits in on the one screen where something shares its line: §2.4's
  // Logged/Planned control on the dive form. The Dives list used to be the second — the
  // search/`+` capsule sat at this row's trailing edge — until the capsule stopped being IN
  // that line: it floats over the list beside the title now (`capsuleFloat`/`divesTitle`
  // below), which is a different arrangement from sharing a flex row with it and needs none
  // of this. Kept as its own definition rather than folded into
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

  // The same row label in **full ink**, for the two rows on Settings that are not settings:
  // a cylinder preset's name, and §3's "account & sync". §0.6: "Ink versus muted ink is the
  // only lever", which it already spends this way twice (`detailActionLabel` over
  // `detailBackLabel`, `tripTitleUpNext` over a trip's own title). "Units" and "Dives before
  // Ponor" are fixed words naming a setting and are muted; these two are not.
  //
  // `flexShrink: 1` for the reason `formFieldLabel` records: §0.5's "Czech runs 20–30 %
  // longer", and a long label must wrap rather than truncate.
  const settingsRowInk: TextStyle = {
    ...rowLabel,
    color: theme.fg,
    flexShrink: 1,
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

  // The form's inset is `CONTENT_INSET` at the top of this function, like every other screen's
  // — see that constant for why there is only one number now. What is still the FORM's own
  // decision, and is why this note stays here, is *which node carries it*: every row-level
  // child of the ScrollView (each field, each group header, the heading row) rather than the
  // ScrollView's own contentContainer. That is what makes a field's hairline and its focus
  // fill span the full width the way a dive row's do — §0.6, "a hairline on each row's top
  // edge, the same rule dive rows follow" — which they now do at the same width as well as by
  // the same rule.

  // What a field puts UNDER its label/value row — the option chips, an open date picker, the
  // notes box, and §2.3's autocomplete list, which §0.6 positions there — owns the clearance
  // between itself and the NEXT row's hairline. The row above it deliberately has no vertical
  // padding of its own: it is `minHeight: 48` with its input stretched to match, so the row IS
  // the tap target (§0.5), and padding there would leave the input short of the floor while
  // the row itself met it.
  const FIELD_EXTRA_CLEARANCE = 12;

  // **How wide a line of prose is allowed to get** (M1l, the owner: *"the text lines should
  // not go for full width"*). The first-run screen is the only place in Ponor that sets running
  // prose at all — every other screen is rows, labels and figures — and left to the column it
  // ran edge to edge, which at 402 pt is a line long enough that the eye loses its place
  // returning to the left margin. This is the typographic measure that stops it.
  //
  // **A max, and in points**, which is what makes it a measure rather than a layout: a narrower
  // phone simply uses the width it has and nothing overflows, while a tablet — where the empty
  // logbook renders full-bleed, before the wide layout's split — keeps a readable column
  // instead of a 900 pt line. A percentage would do the opposite of both.
  //
  // **Not hand-inserted line breaks**, which is the version this rules out: §0.5 has Czech
  // running 20–30 % longer, so a break placed to look right in English lands mid-phrase in
  // Czech, and the same is true of every language i18next adds after it (§4).
  const PROSE_MEASURE = 320;

  // The rating's two geometries on the form, named rather than typed into three styles,
  // because a third value is *derived* from the difference between them — see
  // `formRatingRow`, which cancels the leading slack this pair creates. Written as constants
  // so that changing the dot or the target moves the row's own offset with them; two literals
  // and a hand-computed `-15` are the same rule in two places, which is §4.1's defect.
  const RATING_DOT_FIELD_SIZE = 18;
  const RATING_TARGET_SIZE = 48;

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

  // The app's ground, under two names. One definition rather than two literals, the same
  // reasoning `noticeBanner` above records: `screen` and `wideScreen` are the roots of every
  // screen in the app, they must paint the same ground and fill the same way, and each says
  // at its own definition what makes it a distinct name (what the call site adds on top,
  // §4.1's "a deliberate near-duplicate names its siblings").
  //
  // **There were three until M1k**: the Dives screen had a `divesScreen` of its own, whose
  // entire reason for existing was that its call site composed NO top inset — the pinned bar
  // under it spent that clearance instead. The bar is gone and that screen's root now
  // composes exactly what the other five compose, so the third name had nothing left to
  // distinguish it and was deleted rather than left as a second spelling of `screen`.
  const screenGround: ViewStyle = { flex: 1, backgroundColor: theme.bg };

  const rowScroll: ViewStyle = { flex: 1 };
  // **The shared part only, and the bottom is deliberately not in it** (M1h). This carried
  // `paddingBottom: 40` while it served both the form and Settings, and one number could
  // never have been right for both: the form's scroll is a SIBLING ABOVE `formFooter`, which
  // spends `insets.bottom + 24` itself, so 40 there is internal spacing and the device's edge
  // is somebody else's problem; Settings' scroll is the last child of its root and runs to the
  // bottom of the display, where 40 is 43 pt short of what a screen under the tab bar reports
  // and the last row scrolls under the glass. The top and the gap ARE one rule — the two
  // screens are the same column of §0.6 rows — so they stay here, and each alias states what
  // it meets at its own end (`formScrollContent`, `settingsContent` below).
  const rowScrollContent: ViewStyle = {
    // `SCREEN_HEADING_TOP` above, not a 4 of its own: what this padding actually decides is
    // where the screen's title sits under the safe area, and the Dives list has to land on
    // the same line without sharing this style.
    paddingTop: SCREEN_HEADING_TOP,
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
    // box rather than `hitSlop`. The capsule exists to hold these and nothing else, so the
    // target can simply BE the size it needs, and two of them side by side are what give the
    // capsule its width. `clearFieldControl` below is the same answer for the same question
    // one screen over; the form's clear used to reach the floor through slop instead, and
    // that style records at length what an invisible target cost when it did.
    //
    // A square, not a circle: the ink is the glyph, and a rounded fill behind it would be a
    // second object competing with the capsule that already surrounds it.
    capsuleGlyph: {
      width: CAPSULE_GLYPH,
      height: CAPSULE_GLYPH,
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
      width: CAPSULE_DIVIDER,
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
    // The Dives list's contentContainer, and it is **empty on purpose** — a record of two
    // absences rather than a style with nothing to say. Neither may quietly come back.
    //
    // **No `paddingTop`, and M1k is the second arrangement to need that said.** The capsule
    // floats over this list again (`capsuleFloat` below) — but it floats BESIDE the
    // large title, in the space a five-letter heading leaves empty at the trailing edge, not
    // above it. So there is still nothing overhead for the first row to clear. It carried 60
    // — the capsule's 48 plus the gap under it — the first time the capsule floated, when it
    // sat over the top of the content rather than beside its first line; a list that took
    // that back would open with a 60 px hole above its title and would push the title down
    // by exactly the height this arrangement exists to give back.
    //
    // **No `paddingBottom`:** composed at the call site from `screenBottomInset(insets.bottom)`
    // (M1h). It was 24, described here as "a last row's breathing room above the tab bar" —
    // which is exactly the claim it could not keep: a screen inside `(tabs)` reports 83, so
    // the last dive row ended 59 pt INSIDE the bar and scrolled under the Liquid Glass with
    // its site name cut mid-word and its duration line lost entirely. Seen on the device,
    // once the logbook had enough dives to scroll; the branch that shows it is the one every
    // returning diver sees, and nothing in 1400 tests could.
    listContent: {},
    // DivesScreen's wide (tablet) layout (DESIGN.md §3, useWideLayout.ts). Replaces `screen`
    // as the outer wrapper only on that branch — `flexDirection: 'row'` is the one thing it
    // adds. It carries no top inset: the list column and the detail pane's own `screen` each
    // compose theirs from `screenTopInset`, one per column, so a padding here would stack a
    // second one over the detail pane (see `wideListColumn`).
    wideScreen: { ...screenGround, flexDirection: 'row' },
    // Fixed-width list column (task brief: "the list sits at a fixed column width"). Wide
    // enough for a row's number/site/depth to read comfortably without crowding the detail
    // pane out — the same width iPad split views commonly give a master column.
    //
    // **No `paddingTop`**, and composed at the call site from `screenTopInset(insets.top)`
    // exactly as `screen` next door is — the column is this layout's list root, so it asks
    // the device the same question every other root asks (M1k; the pinned bar it used to
    // begin with asked it instead, and before that the column carried the app's flat 48).
    // The two columns line up by construction rather than by two numbers happening to agree:
    // this one and the `DiveDetailScreen` in the pane beside it ask one function, so an
    // iPad's 24 pt inset floors to 48 on both sides and any future device moves both.
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
      paddingHorizontal: CONTENT_INSET,
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
    // EmptyState's outer wrapper: the scrolling teaching block, and the primary action pinned
    // under it in the bottom third of the screen (§0.5).
    //
    // **`paddingBottom` is deliberately absent**, and composed in at the call site from
    // `screenBottomInset(insets.bottom)` — the same shape, and the same reason, as `screen`
    // above carrying no `paddingTop`. It was a flat 48 until M1h, which is 35 pt short of
    // what an iPhone 17 Pro reports under the native tab bar, and that put "Log your first
    // dive" behind the Liquid Glass with its label unreadable (see `screenBottomInset`). A
    // number here would be a second answer to a question only the device can be asked, and
    // it would be the answer this component actually got. Its absence makes a caller that
    // forgets to compose one fail visibly — the button flush against the bottom edge —
    // instead of quietly sitting under a bar and still responding to taps.
    //
    // **A `justifyContent` of its own went with M1h's first-run rewrite** (it was `flex-end`
    // here): the wrap is now a scroll and a button, the scroll takes the slack (`flex: 1` on
    // `emptyStateScroll`), and it is `emptyStateContent` that decides where the teaching block
    // sits inside it. Left here, it would have been a second, contradicting answer to the same
    // question — and M1k, which moved that block, would have had to find both.
    // **`CONTENT_INSET`, matching `divesTitle` and `divesSummary` above it — one column.**
    // It was 20 from M0, when the only thing in here was a sentence and a button and there was
    // nothing above them to line up with. The first-run block put five more elements under a
    // title that sits at 16, so the wrap's own 20 became a **four-point step** between the
    // heading and everything it heads. Measured on the device at 3×, not eyeballed: the mark's
    // ink started at 20.00 pt and "0 dives" at ≈16.7. Centring had hidden it — a centred block
    // has no left edge to disagree with — and left-aligning is what made it visible, which is
    // the same "a design decision exposes a latent one" this screen has now produced twice.
    // This was the first of the two 20s to go; M1l took the other, so the step it fixed can no
    // longer be reintroduced anywhere. Still pinned next door as a relation to `divesTitle`,
    // because the rule is *the same column* and not *this number*.
    emptyStateWrap: {
      flex: 1,
      paddingHorizontal: CONTENT_INSET,
      gap: 16,
    },
    // **The teaching block scrolls; the action does not** (M1h). Everything above the button
    // — the mark, the label, the local-first line, the depth legend and its reason — is seven
    // elements deep, and on a 4.7" phone in Czech (§0.5: "Czech runs 20–30 % longer") they do
    // not all fit. A column that simply overflowed would push the mark off the top edge with
    // nothing to say it was there; a column that shrank would put the one control a first-run
    // diver has back into the region `screenBottomInset` was written to get it out of. So the
    // overflow goes somewhere reachable instead, and the button stays exactly where the device
    // says it may be, which is the guarantee that has already shipped broken once.
    emptyStateScroll: { flex: 1 },
    // **`flexGrow: 1` with `justifyContent: 'center'` is the pair that makes that work.**
    // Content shorter than the screen is centred in the space above the button, so the block
    // reads as the page rather than as something resting on the action. Content taller than
    // the screen makes the container taller than the frame, which leaves `justifyContent` no
    // free space to distribute — so it lays out from the top and every element stays
    // scrollable to. One property could not do both.
    //
    // **`center` rather than `flex-end`** (M1k, the owner's call: *"lets just move the content
    // a bit more up"*). It was `flex-end`, which pushed the whole teaching block down against
    // the button and left every point of slack in one hole between "0 dives" and the mark —
    // 264 pt of it on an iPhone 17 Pro, and 56 more once the title stopped sitting under a
    // pinned bar. The slack is split evenly now. What did NOT move is the button: it is a
    // sibling below this scroll, and its clearance is the device's (`screenBottomInset`, and
    // the `+ 24` EmptyState composes into it) — §0.5's thumb zone is that clearance's job and
    // was never this property's, whatever the sentence here used to claim.
    //
    // **Across the block, `flex-start` and not `center` — the owner's drawing, settled
    // against the build.** `alignItems` is the other axis from the two properties above, and
    // the two answers differ on purpose: the block is centred vertically in the space it has
    // and left-aligned horizontally. Every element of it begins at the same left edge — the
    // cluster label, the local-first paragraph, the legend's first bar and both reason lines.
    // That is the app's own rhythm rather than a preference: every other screen in Ponor hangs
    // its content off one column, and a centred column here would have been the single place
    // the eye has to find a new starting point. The first build centred it, which was the one
    // visible departure from the drawing.
    //
    // It also puts a load on `depthLegend` below: the moment this stops centring, a child sized
    // by its content is a child that has to claim the width itself, and the legend is six
    // `flex: 1` columns with nothing to divide. `styles.test.ts` pins the two as one relation
    // for that reason.
    emptyStateContent: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'flex-start',
      gap: 16,
    },
    // **The mark, drawn once, monochrome — and the monochrome is §0.1 enforcing itself.**
    // §0.3 strokes this same shape in the depth gradient *on the app icon*, where the mark is
    // the only thing there is. On screen the identical gradient would be colour used as
    // **brand**, and §0.1 says colour encodes depth and nothing else: the only hue anywhere on
    // this screen is the legend below, and the legend is depth. Restoring the gradient here
    // would break the rule the screen exists to teach, six lines above the sentence that
    // teaches it — so it is written here rather than left to be inferred from a grey PNG.
    //
    // `tintColor` is what paints it, from `fg`, so one asset serves both themes and neither
    // gets a baked-in ink that goes invisible on the other ground. `opacity` is the "half
    // strength" the owner's drawing shows: the mark is the quietest thing on a screen whose
    // job is the legend, and `depthUnit` above already establishes opacity as this sheet's
    // lever for "quieter than the ink it is drawn in". `fgMuted` was the alternative and is
    // the wrong token — §0.2 gives it to "labels, units, metadata", and this is a graphic.
    //
    // **120 wide, and the height is the drawing's own proportion — tied, not guessed.**
    // `assets/images/mark-mono.png` is trimmed to its ink (scripts/build-icons.mjs), so 120
    // means the mark rather than the frame around it. mark.svg's 64×64 box leaves a fifth of
    // its height empty above the wave and a quarter below the profile; on an icon that
    // emptiness insets the mark from the tile's edge, and in a left-aligned column it is simply
    // a hole — the block runs on a 16 pt rhythm and the untrimmed mark sat 49 pt clear of the
    // label under it. Looked at on the simulator, then measured off the screenshot.
    //
    // **The height has to be stated, and that was established by rendering it.** A `width`
    // alone does not give React Native an aspect ratio to solve for: it takes the asset's
    // INTRINSIC height in points, so the trimmed 360×209 asset laid out as 120×209 and
    // `contain` letterboxed the mark inside it — a bigger hole than the one the trim closed.
    //
    // So the ratio is written here, which makes it the drawing's geometry in a second file, and
    // `markAsset.test.ts` closes that by requiring these two numbers to agree with the shipped
    // asset's own — §4.1's "derive, or tie", tied at test time because the asset is a build
    // artifact this sheet cannot read. The failure mode of a stale pair is benign in the
    // meantime: `contain` letterboxes, so the worst case is air, never a clipped mark.
    //
    // **`marginBottom` is clearance under the mark, on top of the block's own rhythm** (M1l,
    // the owner: *"the icon/logo should have a bit higher bottom padding"*). Every other gap in
    // this block is `emptyStateContent`'s 16, which is right between five text objects and too
    // tight under a 120 pt graphic — the mark reads as the first item of the list it heads
    // rather than as the thing the page opens with. Written here rather than as a bigger
    // container `gap`, which would have spread the same air between the legend and its caption
    // and broken the rhythm to fix a single seam.
    //
    // **It costs the button nothing.** `emptyStateContent` centres the block in the space above
    // a control whose clearance is the device's (`screenBottomInset`, and the `+ 24`
    // EmptyState composes into it), so this takes its air from the centring slack. On a screen
    // with no slack the container is already taller than its frame and this is 16 more points
    // to scroll — see `emptyStateScroll`.
    emptyStateMark: {
      width: 120,
      height: 70,
      resizeMode: 'contain',
      tintColor: theme.fg,
      opacity: 0.5,
      marginBottom: 16,
    },
    // §0.6's cluster-label treatment, third call site — "NOTHING LOGGED YET" over the
    // first-run block. Derived from the same `clusterLabel` the dive detail's and the form's
    // group headings take, rather than retyped at 10.5/uppercase/+0.14 em for a third time,
    // for the reason §0.6 gives when it introduced the shared definition: *Conditions* and
    // *Gas & cylinders* carried two treatments for one thing until they did not.
    emptyStateLabel: clusterLabel,
    // §1's promise, said to a diver. `PROSE_MEASURE` above is what stops it running the width
    // of the screen.
    emptyStateText: {
      fontFamily: fonts.sans,
      fontSize: 16,
      color: theme.fgMuted,
      maxWidth: PROSE_MEASURE,
    },
    // The two lines under the legend that give the rule its reason. Mono, because they are a
    // caption to a data legend and they carry the scale's own figures — §0.2 splits the faces
    // on content, and "red fades out by 6 m" is a reading, not a sentence about the app. Sized
    // at `tripDateRange`'s 11, which is this sheet's existing "small mono metadata", with a
    // line height because unlike a date range this one wraps — and `PROSE_MEASURE` above is
    // what decides where it wraps.
    emptyStateReason: {
      fontFamily: fonts.mono,
      fontSize: 11,
      lineHeight: 16,
      color: theme.fgMuted,
      maxWidth: PROSE_MEASURE,
    },
    // **The depth legend** (§0.6, M1h) — six bars in the six band colours, each under its own
    // range. The one place in Ponor where a depth colour appears without a depth beside it,
    // and the only thing a first-run screen can teach that the app then keeps using.
    //
    // `alignSelf: 'stretch'` because its parent aligns its children to one edge rather than
    // sizing them: a legend is a scale and has to span the column, or the six `flex: 1` bands
    // have nothing to divide and collapse to the width of their own labels. It was needed under
    // the centred first build for the same reason and is needed under `flex-start` for a
    // sharper one — `center` at least left the row a content width to be centred at.
    depthLegend: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      gap: 4,
    },
    // One band's column. `flex: 1` on every one is what makes the six equal without anybody
    // computing a width from a screen size — and equal is the honest drawing: the bands are
    // not equal in metres (6, 6, 8, 10, 10, open) and a legend scaled to depth would give the
    // deepest band an infinite share.
    depthLegendBand: {
      flex: 1,
      gap: 6,
    },
    // The swatch. Colour is composed at the call site from `depthBandColor` (theme/depth.ts)
    // for the same reason `depthValue` above carries none: a depth colour depends on the band
    // as well as the scheme, so it cannot be precomputed into a scheme-only sheet.
    depthLegendBar: {
      height: 6,
      borderRadius: 3,
    },
    // The range beneath it. Mono with tabular figures because these are depths — the same face
    // and the same reason `depthValue` takes it — and muted, because the bar above is the part
    // that is meant to be looked at.
    //
    // Aligned to its own bar's LEADING edge rather than centred under it, with the rest of the
    // block (`emptyStateContent`). That is not only consistency: each label names the depth its
    // band STARTS at, so a number sitting where its colour starts reads as a ruler, where a
    // centred one floats between the boundary above it and the one below. The trailing edge is
    // ragged as a result — `40+ m` is wider than `0–6` — and that is the honest shape of a scale
    // whose bands are not equal.
    depthLegendLabel: {
      fontFamily: fonts.mono,
      fontSize: 10.5,
      fontVariant: ['tabular-nums'],
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
    // **The region the capsule floats in** (M1k) — the large title and the list beneath it,
    // which on this screen are one object: the title is the list's `ListHeaderComponent`.
    // Nothing but `flex: 1`, and its whole job is to be a containing block whose TOP EDGE is
    // the title's own top edge, so `capsuleFloat` below can say `top: 0` and mean
    // "beside the title" rather than "this far down the screen".
    //
    // That is what makes the float survive the two notices (DivesScreen.tsx), which stay
    // pinned ABOVE this region: when one is showing it pushes the title down, and the capsule
    // goes with it instead of landing on the banner. The alternative — an absolute capsule
    // against the screen root, offset by `screenTopInset` — would have been a second answer
    // to a question the root's own padding already answers, and would sit on a notice.
    divesListArea: { flex: 1 },
    // **The search-and-`+` capsule floats beside the title** (DESIGN.md §0.6 and §10, the
    // owner's call, M1k — reversing the pinned bar this replaces). §3's note put the capsule
    // top-right when the tab bar landed; the bar it was pinned in cost the large title the
    // height every other screen's title has, which is what the owner saw comparing Dives
    // against Settings. So the capsule is an overlay again and the title takes the ordinary
    // heading position (`divesTitle` below, `SCREEN_HEADING_TOP` above).
    //
    // **At rest it covers nothing, and that is the acceptance test rather than a hope**: a
    // five-letter heading leaves the whole trailing half of its line empty, and the capsule
    // sits in it. A ROW that passes under it while scrolling is fine — the owner's own
    // reasoning, because you scroll on. A STICKY trip header is not, because it parks there
    // for a whole trip's scroll extent instead of passing beneath, and that is exactly how a
    // trip's trailing date range came to read `…16` twice (§10). Which is why the list this
    // floats over does not stick its headers any more (DivesScreen.tsx); the two decisions
    // are one decision and neither is safe alone.
    //
    // `top: 0` is the region's own top edge, not a distance from the display: see
    // `divesListArea` above. `right` is `CONTENT_INSET`, the app's one content column, so the
    // capsule's trailing edge lines up with the date ranges it floats near and with the title
    // beside it. This used to say "it is NOT `FORM_ROW_INSET`: that is the form's and Settings'
    // column" — there is no second column to be not, since M1l.
    //
    // No ground of its own: the capsule inside it draws its own material (`actionCapsuleGlass`
    // /`actionCapsulePlain`), and a fill here would put a second opaque shape behind a shape
    // that is deliberately glass. Nothing the list draws needs to be hidden by this wrapper —
    // the list is clipped by the screen root's own safe-area padding, which is what keeps
    // content out of the status bar now that there is no bar to do it.
    //
    // **Named for the rule rather than for its first screen** (M2n), which is the same
    // correction `CONTENT_INSET` and `disclosureChevron` each record. It was `divesCapsuleFloat`
    // while the Dives list was the only screen with a capsule beside its title; §3's Map tab now
    // floats its layer toggle in exactly this position, against exactly this kind of region, and
    // a second style holding the same three properties under a second name is §4.1's defining
    // defect. The two screens differ in what the capsule HOLDS and therefore in how far their
    // header text has to stop short of it (`DIVES_HEADER_TRAILING_INSET`,
    // `MAP_HEADER_TRAILING_INSET`) — not in where the capsule sits.
    capsuleFloat: {
      position: 'absolute',
      top: 0,
      right: CONTENT_INSET,
    },
    // The large title, and it is a **block in the list's own content** — the SectionList's
    // `ListHeaderComponent` — not a row in a bar above. That is the whole of the native
    // arrangement: it scrolls away with the logbook and nothing takes its place.
    //
    // `screenHeading` rather than `headingTitle`: nothing shares its line any more, so the
    // `flex: 1` that let it wrap beside a control would be a claim about a row it is not in.
    // The face, the size and the ink are unchanged and still shared with the form's and
    // Settings' own titles (§4.1: what a screen calls itself is one rule) — a native large
    // title is 34 pt bold, and taking that here would have split that rule three ways for
    // one screen.
    //
    // Same 16 dp column as the rows below and as `capsuleFloat`'s trailing edge, so the
    // title, the capsule and every trip title line up.
    //
    // **`paddingTop` is `SCREEN_HEADING_TOP`, and that is the owner's M1k call in one
    // property**: the list's content begins at the screen root's safe-area padding and this is
    // the whole of what sits above the first line, so "Dives" lands exactly where "Settings"
    // does. It used to be a 4 of its own under a bar that had already spent 56 pt, which is
    // the gap the owner found. `paddingBottom` separates the title from the first trip header,
    // which brings its own 20.
    //
    // **`paddingRight` is `DIVES_HEADER_TRAILING_INSET`, and it is what keeps the summary line
    // out from under the glass** (§0.6, M1m). The capsule floats at `top: 0` of the region this
    // title heads and reaches 48 pt down — past this title's own ~36 and into the line beneath
    // it — so the two objects overlap in the vertical and the clearance has to come out of the
    // horizontal. The header's text column stops at the capsule's leading edge; the summary
    // wraps to a second line under the capsule, which is what the owner's sheet draws.
    //
    // It sits BESIDE `paddingHorizontal` rather than replacing it, and that is not sloppiness:
    // Yoga resolves the edge-specific property over the axis one, so the left edge is still
    // `CONTENT_INSET` and still the app's one column — which is what the column sweep in
    // styles.test.ts reads, and what has to stay true of the title's own left edge.
    //
    // **M1l reserved the capsule's HEIGHT here instead** — `minHeight: CAPSULE_HEIGHT`, so the
    // line was pushed below the capsule rather than narrowed beside it — and rejected the width
    // with arithmetic: 257 pt of remaining room for a line already 255 pt long. The arithmetic
    // was right; the constraint it was handed was not. Nothing in §0.6 asks this line to fit on
    // one, and the sheet it came from wraps it. What the reserve actually cost, measured on the
    // device either side of this change, is **14 pt** of extra gap between "Dives" and the line
    // under it — the summary's ink started at 113.3 pt down the screen and starts at 99.3 now —
    // on the one screen whose title height the owner had just spent M1k measuring. See §10,
    // "Right arithmetic, wrong question".
    //
    // **The title is inside the cap too, and that is deliberate**: it is one column, not a
    // narrow line under a full-width one. Measured, "Dives" sets 50 pt wide at this heading's
    // 20 pt Archivo SemiBold and Czech's "Ponory" is one character more — neither is near the
    // ~253 pt this leaves on a 402 pt phone, so nothing wraps today. If a title ever did, it
    // would wrap to two lines beside the capsule and push the summary down with it, which is the
    // correct failure: §0.5 already says labels wrap rather than truncate, and a title running
    // under the glass is the defect this whole entry is about.
    divesTitle: {
      ...screenHeading,
      paddingHorizontal: CONTENT_INSET,
      paddingRight: DIVES_HEADER_TRAILING_INSET,
      paddingTop: SCREEN_HEADING_TOP,
      paddingBottom: 8,
    },
    // **The summary line under the title** (§0.6, M1l — the owner's sheet): `128 dives ·
    // 96 h 12 min · deepest 41.2 m`, the three figures §3 gives the Stats tab, said once at
    // the top of the logbook they describe. `formatLogbookSummary` (format/display.ts) owns
    // every word of it and `logbookStats` (domain/logbookStats.ts) owns the numbers.
    //
    // **It was `divesCount` and it existed on one branch only** (M1h): the empty logbook,
    // where it read "0 dives". That job is unchanged and is still the load-bearing one — the
    // line is the difference between a screen that has *read* the logbook and found nothing
    // and one that has not looked yet, which is the confusion §10's "a screen with no answer
    // must not state one" records costing a diver their whole list for a frame. An empty
    // logbook has no duration and no depth to report, so the same formatter still produces
    // exactly "0 dives" there. Renamed for the rule rather than for the first figure it
    // carried (§4.1).
    //
    // Mono because these are figures (§0.2), muted because the title above it is the heading,
    // and in `divesTitle`'s own 16 dp column so it hangs off the title rather than starting a
    // new margin.
    //
    // **No colour, and the depth in it is why that is a rule and not a default.** §0.1 has
    // colour encode depth and §0.6 makes a dive's depth the anchor of its row, drawn in its
    // band — but the depth here is an aggregate over a whole logbook, and one band colour
    // would be a claim about a set that no single band is true of. `fgMuted`, like the rest of
    // the line.
    // **The same trailing cap as the title above it** (M1m), because the cap is on the header's
    // COLUMN and not on one line of it. This is the line the cap exists for: it is the one that
    // grows with the logbook, and it is what was rendering behind the glass.
    //
    // **A third line is capped too, and that is accepted.** A summary long enough to need three
    // lines puts the third below the capsule, where the full width is actually free, and it will
    // still stop at `DIVES_HEADER_TRAILING_INSET` — a slightly short line where a longer one
    // would have fitted. That is invisible; a line running under the capsule is not, and buying
    // the second with a per-line rule would mean measuring text, which is neither a stylesheet's
    // job nor worth a layout pass for a case no logbook reaches (three lines needs ~68 characters
    // where the three-digit example is 40).
    divesSummary: {
      fontFamily: fonts.mono,
      fontSize: 11.5,
      color: theme.fgMuted,
      paddingHorizontal: CONTENT_INSET,
      paddingRight: DIVES_HEADER_TRAILING_INSET,
      paddingBottom: 8,
    },
    // **§7.5's quiet indicator** (M2h): `3 changes waiting to sync`, under the summary line,
    // drawn only while a signed-in device is holding something the account has not received.
    //
    // **It is the summary's own treatment and not a new one**, deliberately. §7 asks for an
    // indicator that is *quiet*, §0.1 rules out a hue for it, and §0.6 already has exactly one
    // vocabulary for a muted mono line of figures hanging under the title — inventing a second
    // size, weight or ink for one line would be new vocabulary for one control, which is the
    // argument §0.6 makes about the "Up next" header and about the `+` in the capsule. Ink
    // versus muted ink is the only lever there is, and this line is on the muted side of it,
    // below a summary that is already there: it can be read without being looked at, which is
    // what quiet means here.
    //
    // **Same trailing cap, same column** (`DIVES_HEADER_TRAILING_INSET`, M1m). The cap is on
    // the header's column rather than on one line of it, and this is a line of that column; a
    // pending count running under the floating capsule would be the same defect the cap was
    // added for.
    //
    // **It appears and disappears, and what that moves is the list and never the title.** The
    // whole header block is the SectionList's `ListHeaderComponent`, so the title and the
    // summary above this line keep the exact position §0.6 measures them at, and the rows below
    // shift by one line when a save arrives. That is the opposite way round from M1l's
    // mistake, which bought clearance out of vertical space above the title and made the title
    // itself look wrong.
    divesPending: {
      fontFamily: fonts.mono,
      fontSize: 11.5,
      color: theme.fgMuted,
      paddingHorizontal: CONTENT_INSET,
      paddingRight: DIVES_HEADER_TRAILING_INSET,
      paddingBottom: 8,
    },
    // ------------------------------------------------------------------------------------
    // The Map tab (MapScreen.tsx, components/DiveMap.tsx — DESIGN.md §3's Map bullet)
    // ------------------------------------------------------------------------------------
    //
    // **Everything here is monochrome, and on this screen that is a decision rather than a
    // default.** §0.1 spends every hue on depth; a map is made of colour, and the marks on it
    // are the app's. `DiveMap.tsx`'s own docblock carries the three arguments that settled it —
    // in short, §3's mark stands for a SET of dives at several depths (§0.6 already ruled that
    // an aggregate depth takes no band), and a mark at map scale has nowhere to put the number
    // that §0.1 requires beside every colour. So the depth palette appears on this screen only
    // where it appears on every other one: on the `DiveRow`s inside the site sheet.
    //
    // The region the capsule floats in — `divesListArea`'s sibling and the same one property,
    // for the same reason: its top edge is the title's top edge, so `capsuleFloat` can say
    // `top: 0` and mean "beside the title" rather than "this far down the display". Its own
    // definition rather than a shared one because what it contains differs (a list there, a
    // header block over a map here) and only the containing-block job is common; the shared
    // half is `capsuleFloat` itself.
    mapArea: { flex: 1 },
    // The `MapView` itself, filling what is left under the title block. No ground of its own:
    // the map paints the whole rectangle, and a `backgroundColor` here would only ever be seen
    // in the frame before it does.
    mapSurface: { flex: 1 },
    // The large title, in every respect the Dives title's twin apart from its trailing cap —
    // this screen's capsule holds ONE glyph (the layer toggle) rather than two, and
    // `MAP_HEADER_TRAILING_INSET` is derived from that count rather than copied from the other
    // screen's number. `screenHeading` is what a screen calls itself (§4.1, one rule); the
    // 16 dp column and `SCREEN_HEADING_TOP` are what put "Map" on exactly the line "Dives" and
    // "Settings" sit on.
    mapTitle: {
      ...screenHeading,
      paddingHorizontal: CONTENT_INSET,
      paddingRight: MAP_HEADER_TRAILING_INSET,
      paddingTop: SCREEN_HEADING_TOP,
      paddingBottom: 8,
    },
    // The line under it — which layer is showing and what is on it, e.g. `My dives · 3 sites ·
    // 7 of 24 pinned`. `divesSummary`'s treatment exactly (mono, muted, the header's own
    // column and cap), because it is the same object: a muted mono line of figures hanging
    // under a title. §0.6's argument against inventing a second size or ink for one line is
    // what makes that a rule rather than a convenience — and it is also how this screen says
    // which layer the toggle has selected, in words, since §0.1 leaves no hue to say it with.
    mapSummary: {
      fontFamily: fonts.mono,
      fontSize: 11.5,
      color: theme.fgMuted,
      paddingHorizontal: CONTENT_INSET,
      paddingRight: MAP_HEADER_TRAILING_INSET,
      paddingBottom: 8,
    },
    // **One mark's tap target** — §0.5's 48 dp floor as a real box, exactly as `capsuleGlyph`
    // above is for a capsule's glyph and for the same reason: the visible mark has to be small
    // enough that nine sites in one bay are readable, and the thing a wet thumb has to hit does
    // not. Transparent and centred, so the mark sits ON its coordinate rather than beside it.
    mapMarkTarget: {
      width: CAPSULE_GLYPH,
      height: CAPSULE_GLYPH,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // **A place of the diver's own: a pill carrying its dive count** (§3: "badge = count per
    // site"). Always the count, including `1` — a bare mark for a single dive would make the
    // ABSENCE of a number mean "one", which is a legend, and §0.6/§10 have twice ruled that a
    // symbol needing one has already failed.
    //
    // `surface` behind it with a full-ink hairline, which is §0.6's option-chip rule read on a
    // map: "`surface` behind an unselected chip, `action` ink behind the selected one". The
    // border is `fg` rather than the `border` token every seam inside the app uses, and that is
    // the one place this screen departs from the sheet's habits on purpose: a hairline tuned to
    // separate two surfaces of the app's own ground disappears over Apple's cartography, which
    // is neither. Ink against the map, ink inside the app.
    mapMarkBadge: {
      minWidth: 26,
      height: 26,
      borderRadius: 13,
      paddingHorizontal: 7,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.fg,
      backgroundColor: theme.surface,
    },
    // The chosen mark is the inverted one — `selectedFill`'s own rule, spelled out here rather
    // than composed from it because this also has to overwrite the border: an inverted pill
    // with a `fg` hairline would draw a ring in its own fill colour.
    mapMarkBadgeSelected: {
      borderColor: theme.action,
      backgroundColor: theme.action,
    },
    // The count. Mono because it is a figure (§0.2), medium so it holds against a busy map at
    // 12 pt, and full ink — never a depth colour, for the reasons at the top of this block.
    mapMarkBadgeLabel: {
      fontFamily: fonts['mono-medium'],
      fontSize: 12,
      color: theme.fg,
    },
    mapMarkBadgeLabelSelected: {
      color: theme.actionFg,
    },
    // **A community site: a dot, because there is no count to show.** §3 badges "your dives"
    // per site, and a catalogue site the diver has never dived has none — a badge reading `0`
    // would be a number about the wrong thing. Same two-state ink as the badge above, so the
    // toggle changes what a mark IS without changing the vocabulary it is drawn in.
    mapMarkDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.fg,
      backgroundColor: theme.surface,
    },
    mapMarkDotSelected: {
      borderColor: theme.action,
      backgroundColor: theme.action,
    },
    // **The sheet a tapped mark opens** (§3: "tapping a site shows your dives there with a
    // depth/temp summary"), anchored over the bottom of the map.
    //
    // **Absolute rather than a sibling below the map**, so the map keeps its size when a site
    // is selected: a map that resized under the diver's finger would move every other mark away
    // from the one they were aiming at. `maxHeight` in per cent rather than points because what
    // it is protecting is the map, not the list — the sheet may never take more than half the
    // surface it is describing, on a phone or on an iPad.
    //
    // `surface` with the app's own hairline and a rounded top: the same card `noticeBanner`
    // above is, at the scale of a panel. Rounded at the top only, since the bottom runs off the
    // screen edge behind the tab bar.
    mapSheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '50%',
      backgroundColor: theme.surface,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    },
    // Its title row: the site's name, and the way out at the trailing edge. `space-between`
    // rather than `marginLeft: 'auto'` on the control, because both children are always drawn
    // here — unlike the dive detail's bar, whose back control disappears in the wide layout.
    mapSheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: CONTENT_INSET,
    },
    // The site's name. `headingTitle` rather than `screenHeading`: it shares its line with the
    // close control, so it has to be free to wrap rather than squeeze that control off the row
    // — §0.5's "Czech runs 20–30 % longer", the same answer `formHeadingRow`'s title gives.
    mapSheetTitle: headingTitle,
    // **The way out of the sheet, in the app's one treatment for a way out** (§0.6: "Leaving a
    // screen has one treatment everywhere" — mono, muted, small, and it must never compete with
    // the content beside it). `backControl`'s own definition, so this cannot become a third
    // spelling of the dive detail's back and the form's `‹ Cancel`. No `paddingHorizontal` of
    // its own: the row above already sets the column, and a second inset would push the
    // control's 48 dp box off the screen's trailing edge.
    mapSheetClose: backControl,
    mapSheetCloseLabel: backControlLabel,
    // §3's "depth/temp summary" — `formatSiteSummary` (format/display.ts) owns every word.
    // `divesSummary`'s treatment for the same reason it is used above: one vocabulary for a
    // muted mono line of figures under a heading. **No colour**, and the `deepest` in it is
    // why that is a rule: an aggregate over the dives at a place is a claim no single band is
    // true of (§0.6, the Dives header's own argument).
    mapSheetSummary: {
      fontFamily: fonts.mono,
      fontSize: 11.5,
      color: theme.fgMuted,
      paddingHorizontal: CONTENT_INSET,
      paddingBottom: 8,
    },
    // What the catalogue knows about a community site — `formatSiteFacts`. Archivo rather than
    // mono: §0.2 splits the two faces on content, and "Croatia · shore · salt" is a list of
    // names with one figure in it rather than a line of figures.
    mapSheetFacts: {
      fontFamily: fonts.sans,
      fontSize: 14,
      color: theme.fgMuted,
      paddingHorizontal: CONTENT_INSET,
      paddingBottom: 12,
    },
    // The dive rows inside the sheet. Its bottom padding is composed at the call site from
    // `screenBottomInset` (this module's own owner of "how far above the bottom edge content
    // may end"), because the sheet's own bottom edge is the display's and the tab bar is in
    // front of it — the exact defect that constant was written for, arriving on a second
    // screen.
    mapSheetList: {},
    // ------------------------------------------------------------------------------------
    // The search screen (SearchScreen.tsx — DESIGN.md §3, measured off iOS 26 Messages)
    // ------------------------------------------------------------------------------------
    // The dock the field sits in, at the BOTTOM of the screen, where the keyboard rises. It
    // mirrors the Dives screen's own top row turned the other way up — the same 12 dp gap
    // between the field and the capsule beside it — because it is the same pair of objects: a
    // capsule that fills the width and a capsule sized by its glyphs. Its own 24 dp either
    // side is what that row carried while it floated; the Dives capsule has since moved into
    // the dive list's own 16 dp column, and this screen has no list of rows to line up with. It
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
      paddingHorizontal: CONTENT_INSET,
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
    // The same mark at the size a thumb picks rather than the size an eye reads (M1h): the
    // dive form's rating is five *controls*, and a 7 px circle inside a 48 dp target reads as
    // five specks scattered across a row. Everything except the geometry is `ratingDot`'s,
    // deliberately — same border, same ink, and `ratingDotFilled` above composes on top of
    // this one unchanged, which is what keeps §0.6's actual rule ("draw both as circles of
    // one diameter, filled or outlined") true of the row and the form at once. A second
    // *filled* style per size is what would break it, so there isn't one.
    ratingDotField: {
      width: RATING_DOT_FIELD_SIZE,
      height: RATING_DOT_FIELD_SIZE,
      borderRadius: RATING_DOT_FIELD_SIZE / 2,
      borderWidth: 1,
      borderColor: theme.fg,
    },
    // §0.5's floor around one rating dot: "Tap targets never below 48 dp." Each dot is its
    // own control — tapping the third gives a rating of three — so the floor applies to each
    // of them and not to the row they sit in, which is the same reading that put `minHeight:
    // 48` on `formChip` rather than on `formChipRow`.
    ratingTarget: {
      width: RATING_TARGET_SIZE,
      height: RATING_TARGET_SIZE,
      // Centred, and it stays centred: the dot is what a diver aims at, so the slack around
      // it has to sit on both sides — `flex-start` would put every dot on the leading edge of
      // its own target and hand the 30 dp to its right to the WRONG dot, so a thumb landing
      // just left of the third circle would set a rating of two. What the centring costs is
      // 15 dp of leading indent for the first dot, and that is `formRatingRow`'s to give back.
      alignItems: 'center',
      justifyContent: 'center',
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
      paddingHorizontal: CONTENT_INSET,
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
      paddingHorizontal: CONTENT_INSET,
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
    // The banner DivesScreen shows when a sync the diver **asked for** — pull-to-refresh,
    // §7.5 — could not run. The same `noticeBanner` shape again, and Pressable like
    // `reorderNotice` rather than standing like `settingsNotice`, because it reports one
    // attempt rather than a condition: the diver made a gesture, it failed, and the notice is
    // finished the moment they have read it.
    //
    // **There is no style here for an automatic cycle failing, and there must not be.** §1
    // makes a sync failure something the logbook survives rather than something the app
    // reports, and the pending line under the title (`divesPending` above) already says the
    // only true thing there is to say about it — the account has not got these yet. A banner
    // that appeared by itself every time a boat lost signal would be that same fact, said
    // alarmingly, over and over.
    syncNotice: noticeBanner,
    syncNoticeText: noticeBannerText,
    // DiveDetailScreen's hero (§0.6, M1c task 5): the site name, a `#N · date · centre`
    // mono sub-line, and the 34 px depth anchor (DepthValue's `variant="hero"`, from task
    // 1) — "the same anchor idea the row now uses, at detail scale." Sits above
    // `detailContent` below, outside its padding, and carries `CONTENT_INSET` itself plus a
    // bottom divider, so it reads as one banner across the screen. It used to be described as
    // spanning "the screen's true edge rather than another indented cluster", against a
    // `detailContent` at 20 — the clusters are in this same column now (M1l), and what still
    // makes the hero a banner is the divider under it, not a 4 pt difference in where it
    // starts. `flexDirection: 'row'` +
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
      paddingHorizontal: CONTENT_INSET,
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
    //
    // **The horizontal padding is `CONTENT_INSET`, and the vertical is not it** (M1l). This was
    // one `padding: 20` doing both jobs, which is what let the screen's column be argued about
    // as if it were the same decision as the gap under the hero. It is not: the 20 above the
    // first cluster is clearance below the hero's divider (`detailClusterFirst` zeroes the
    // cluster's own `paddingTop` so it does not stack), and 48 at the bottom is a scroll's
    // run-out. Only the horizontal half is the app's content column, so only that half reads
    // the constant.
    detailContent: {
      paddingHorizontal: CONTENT_INSET,
      paddingTop: 20,
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
    // The hero deliberately does NOT drop its bottom border to solve this instead: the line
    // closing a banner is not the same line as the one dividing two clusters, and the banner
    // is what the diver needs shut before the column of facts starts. That argument used to
    // lean on the hero sitting at 16 while the clusters sat at 20; both are `CONTENT_INSET`
    // now (M1l), so the two lines are the same width and the distinction is entirely in what
    // each one closes — which is what it always actually rested on.
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
    // `CONTENT_INSET` matches `detailHero` directly beneath it (M1d). At 20 the back label sat
    // 4 px further in than the title under it, which is visible precisely because they are
    // stacked and left-aligned — the same step the owner later found between the Dives title
    // and Settings', and the reason there is now one constant for the whole app rather than
    // this fix repeated per control. `minHeight: 48` is §0.5's tap-target floor and is not
    // spacing — it stays exactly as it is.
    detailBack: {
      ...backControl,
      paddingHorizontal: CONTENT_INSET,
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
      paddingHorizontal: CONTENT_INSET,
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
    detailDelete: mutedControl,
    detailDeleteLabel: mutedControlLabel,
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
    // child carries `CONTENT_INSET` instead, so a field's hairline and its focus fill reach
    // the screen's real edges the way a dive row's do — at the same inset as a dive row's,
    // since M1l.
    formScroll: rowScroll,
    // **`paddingBottom` is a constant here, and that is the correct answer rather than the
    // unconverted one** — the near-duplicate `settingsContent` names below, and the reason
    // the two stopped sharing a number (§4.1). This scroll never reaches the bottom of the
    // display: `formFooter` is a sibling below it, in flow, and that footer composes
    // `insets.bottom + 24` from the device. So the scroll's frame ends at the footer's top
    // edge, nothing the device puts at the bottom is in front of it, and 40 is what it has
    // always been — the gap between the last group and the footer's hairline. Reading the
    // safe area here would spend the tab bar's height a second time, in the one place it is
    // already spent. `GearPresetScreen` has the identical arrangement and the same answer.
    formScrollContent: { ...rowScrollContent, paddingBottom: 40 },
    // The core strip (§2.2, as M1i shrank it: "date, site and centre — what identifies the dive
    // rather than what measures it" — always visible, never behind a group).
    //
    // It carries nothing of its own now, and that is the point rather than an oversight: its
    // three rows separate themselves, each with its own top hairline and its own 48 dp height
    // (§0.6), exactly as the dive list's rows do — a `gap` here would push each hairline off
    // the row it belongs to and leave it floating in whitespace. The wrapper stays because
    // §2.2 names this strip as a thing, and because DiveFormScreen.test.tsx pins §2.4's
    // status control OUT of it, and every measurement with it.
    formCoreStrip: {},
    // The form's header row: the heading, and §2.4's Logged/Planned control beside it.
    // The control belongs HERE and not in `formCoreStrip` above, which §2.2 fixes as date,
    // site and centre — that strip says which dive this is, and whether the dive has happened
    // yet is not one of the things that say so.
    //
    // `headingRow` at the top of this function is the shape, and this is now its one caller:
    // the Dives screen's title had the identical row until its capsule left the line
    // altogether (`headingRow`'s own comment, and `capsuleFloat`).
    formHeadingRow: {
      ...headingRow,
      paddingHorizontal: CONTENT_INSET,
    },
    // `headingTitle`, the same definition `divesHeading` reads — see it for why the title
    // takes `flex: 1`.
    formHeading: headingTitle,
    // **The line that says what the return marks below it mean** (§0.6, M1h): the drawn mark
    // itself, then `Carried from #127 — clear any of them`.
    //
    // It is the mark's legend, and that is why it exists rather than being a nicety. §0.6's
    // standing test is "a symbol that needs a legend has already failed" — the computed-value
    // square is the precedent — and a bare `↵` down the side of a form is exactly the symbol
    // that would need one. Stating it **once, in the same view as the marks it describes**, is
    // the difference between a legend a diver has to carry and a sentence they read as the
    // form opens: the marks below are on screen while the sentence is, and nothing has to be
    // remembered for the next dive.
    //
    // It sits between the heading row and the core strip, so `formScrollContent`'s own `gap`
    // spaces it; it carries no margin of its own. `CONTENT_INSET` puts it in the same column
    // every field's label starts in.
    formCarriedNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: CONTENT_INSET,
    },
    // Muted mono 11 — the same treatment `formFieldCleared` gives the cleared tag and the §0.6
    // type table gives a dive number, because this is the same kind of thing: metadata about
    // the form, not a heading and not a value. `flexShrink` so the Czech translation of a
    // sentence this long wraps rather than pushing the mark off the row (§0.5).
    formCarriedNoteText: {
      fontFamily: fonts.mono,
      fontSize: 11,
      color: theme.fgMuted,
      flexShrink: 1,
    },
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
    // `EquipmentTokenField` in DiveFormScreen.tsx. It is `detailRow` one screen over, made
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
    // replaces.** It is not spacing and it is not decoration. It used to be what made the two
    // clear controls' vertical `hitSlop` land — slop is only ever delivered inside a target's
    // ancestors, and this row is that ancestor — and since M1h both are `clearFieldControl`,
    // a real 48 dp box, so the floor is now what the ROW has to be for one of them to fit in
    // it without stretching it. Either way it applies to every field rather than only to the
    // rows currently carrying one, for the reason it always did: a conditional height would
    // move the input out from under a diver's finger the moment a mark was dropped.
    //
    // **No vertical padding, deliberately.** `formFieldInput` below carries the same 48, so
    // the input fills the row and the whole 48 dp is a live target for focusing the field.
    // Padding here would leave the row at the floor while the thing a diver actually taps sat
    // short of it — the shape `da2769f` found in four controls at once.
    formField: {
      minHeight: 48,
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: CONTENT_INSET,
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
    // there, notes puts its own box there, and §2.3's autocomplete list now sits there too
    // (`formSuggestions` below) — §0.6: "The list belongs directly under the focused row."
    //
    // `justifyContent: 'space-between'` is what makes "the value trailing" (§0.6) true for
    // the one field whose value has no `formFieldValue` slot to grow into: each accessory in
    // the equipment set puts a `formChip` straight in the row, and without this it sat flush
    // against the end of the word "Hood" in the middle of an otherwise empty row. It is a no-op for every other
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
    // A field whose value is a CONTROL rather than text — one accessory's Yes/No chip in the
    // equipment set, and nothing else today. Composed onto `formField` above at that one call
    // site.
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
    // §0.6's carried treatment, as M1h's design sheet redrew it — **a drawn return mark and
    // a clear control, where a `carried ×` chip used to sit**. Three styles replace four, and
    // what went with the chip is a filled `border` ground, the word "carried", the divider
    // that made its `×` read as a control, and the `hitSlop` arithmetic all of that needed.
    //
    // The ink is `fgMuted` in all three: §0.1 spends every hue on depth, and a mark that says
    // where a value came from is metadata about the row, not the row's value.
    //
    // **The ink is a style rather than a colour passed to `SymbolView` directly**, which is
    // §4.1's rule for a drawn mark ("A *drawn* mark resolves that ink back to a sheet style
    // rather than painting it directly — theme/styles.ts gives every token-to-property
    // binding, and the graphics guard enforces it"). `formFieldPickerInk` above is the same
    // shape for the same reason, one control over.
    carriedMarkInk: {
      color: theme.fgMuted,
    },
    // The `— cleared` tag (§0.6, M1h): what a field reads once the diver has thrown its
    // carried value away, so "nothing was carried here" and "I threw it away" stop looking
    // alike. Muted mono 11 — the same treatment a dive number wears in the §0.6 type table,
    // which is what this is: a small piece of metadata about the row, in the row's own value
    // slot.
    formFieldCleared: {
      fontFamily: fonts.mono,
      fontSize: 11,
      color: theme.fgMuted,
    },
    // **A row's trailing state slot: the return mark and the control that clears it, as one
    // object** (M1h, the owner's ruling after the first build).
    //
    // The mark started at the LEADING edge of the value slot, which is where the design sheet
    // draws it and where the detail screen's computed `=` sits. On a device that is not what it
    // does: a field's value is right-aligned in a `flex: 1` slot, so the mark landed against the
    // LABEL, twelve points from a word it does not describe and ~240 from the value it does —
    // and because labels differ in length it landed at a different x on every row (`Site` at
    // ~65, `Centre` at ~84, `O₂` at ~58). A column of marks that is not a column reads as an
    // artefact rather than as a deliberate mark, which is the same failure §10 records for the
    // outlined square that used to mean "computed".
    //
    // Trailing, the two halves of one subject sit together, land on the same x on every row
    // because this slot is the last thing in a `space-between` row, and give a diver one place
    // to look per row. **It is also the one placement that serves both components**: a chip
    // group's options live on the row below, so it has no value to lead and always drew its
    // mark here — one rule for the whole form rather than two placements of one mark (§4.1
    // applied to a visual rule).
    //
    // No `gap`: `clearFieldControl` below is a 48 dp box around a 20 pt glyph, so it brings 14
    // dp of its own padding to this join, and an explicit gap would draw the two halves apart
    // into two objects again.
    formFieldCarryState: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // **The control that empties a form row: a 20 pt drawn ring inside a real 48 dp box**
    // (§0.5's floor, and the owner's sheet in as many words — "a 20 px ring in a 48 dp box").
    // Shared by `FormField`'s carried clear and `DateTimeField`'s optional-picker clear,
    // through `ClearFieldControl`, because they are one control: §4.1's "a second
    // implementation is a defect, not a style preference".
    //
    // **The box IS the target, and that is the load-bearing property here.** What it replaces
    // is a compact chip that reached §0.5's floor through `hitSlop`, and the hazard that
    // arrangement carried is worth restating because it is the reason this is a box: slop is
    // invisible, so it is free to point anywhere — and it did, 21 dp INWARD over the word
    // "carried", so tapping that word cleared the field. The owner asked for a visible control
    // precisely so clearing would be deliberate ("a label you are expected to guess is
    // tappable is not an affordance"), and an invisible target over the label undoes exactly
    // that. On `DateTimeField` the same inward slop would have covered the picker's own
    // trigger, which sits immediately to this control's left — "clear the field" drawn over
    // "open the picker".
    //
    // A box has no such freedom: it occupies its own trailing column in the row, nothing of it
    // reaches back over the value or the label, and what a diver can see is exactly what a
    // diver can press. Both components' tests assert that it carries no `hitSlop` at all.
    clearFieldControl: {
      minWidth: 48,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearFieldInk: {
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
    /* The `×` that cleared an optional picker field back to "not set" (`timeIn`) used to be a
       second chip here — `border` fill, mono, muted, its own copy of the padding, and the same
       `hitSlop` the carried chip needed. It is `clearFieldControl` above now, through
       `ClearFieldControl`, on the plain ground that a form row has one way to be emptied and
       one control that does it (§4.1). Both were already the same gesture in the same slot;
       they are now the same control. */
    // §2.3's autocomplete list (FormField.tsx), in the slot §0.6 fixes for it: "The list
    // belongs directly under the focused row" — the same second line `formChipRow` above puts
    // its chips in and an open picker takes. `paddingBottom` is `FIELD_EXTRA_CLEARANCE` for
    // the reason that constant records: anything under a row owns its own clearance to the
    // next row's hairline.
    //
    // **It is deliberately the least this can be, and that is a decision rather than an
    // omission.** §0.6, in the same sentence that fixes the position: "How it looks waits for
    // M2, which reworks site search around the shared site database and adding new sites —
    // designing it now means designing it twice." So there is no new token, no border, no
    // fill and no radius here; the rows borrow `rowLabel`, the treatment a field's own label
    // already wears, which reads as an offer rather than as data the diver has entered. The
    // focused row's `surface` fill (`formFieldFocused`) is already behind all of it, which is
    // what visually attaches the list to the field it belongs to — one more reason it needs
    // no ground of its own.
    formSuggestions: {
      paddingBottom: FIELD_EXTRA_CLEARANCE,
    },
    // One offer. `minHeight` is §0.5's floor, and it is the only number here that is not a
    // borrowed treatment: a suggestion is a control a diver taps with wet hands on a rocking
    // deck, so it gets the same 48 dp every other control in this app does. `justifyContent`
    // centres the text in it, since a `Text` does not centre itself in a box taller than its
    // own line — the same note `formFieldPicker` above carries.
    formSuggestion: {
      minHeight: 48,
      justifyContent: 'center',
    },
    // `rowLabel` — Archivo 15 muted, the field label's own treatment, and leading rather than
    // trailing. Both halves borrowed on purpose. Muted, because an offer is not yet a value.
    // Leading, on `formChipRow`'s own recorded reasoning one style down: a list of options is
    // "a set of options to read through, not a value to read off, and a set reads
    // left-to-right." Trailing it would put every offer in the value column, where the value
    // it has not yet become already sits.
    formSuggestionText: rowLabel,
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
      paddingHorizontal: CONTENT_INSET,
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
    // **Named for the rule rather than for its first caller** (M1h). It was `disclosureChevron`
    // while a group header was the only thing that disclosed anything; §0.6 now states the
    // rule on the axis the controls actually differ on — *a control that discloses further
    // rows in place carries the chevron; one that opens a picker over the row does not, and it
    // is never spent on navigation* — so the form's cylinder row wears the same mark for the
    // same reason and `DateTimeField`'s picker trigger still wears none. A style named after
    // one of its callers invites the next one to draw its own.
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
    disclosureChevron: {
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
    disclosureChevronExpanded: {
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
    // The rating's five tap targets, in the same second-line slot `formChipRow` above
    // occupies and for the same §0.6 reason — this is a set of options to read through, not a
    // value to read off, so it starts at the leading edge under its own label.
    //
    // **No `gap`, unlike the chip row, and no wrapping.** Each target is already 48 dp wide
    // (`ratingTarget`), so the dots sit 48 apart with nothing added; a gap on top of that
    // would space five 18 px circles nearly four diameters apart and stop them reading as one
    // scale. Five targets come to 240 dp, which fits the narrowest phone this app targets
    // without wrapping — and wrapping is what must not happen here, since a rating broken
    // across two lines stops being a row of five at a glance. The chip row wraps because six
    // water-body chips at Czech length genuinely cannot fit; a rating's width is fixed and
    // known, so it is laid out to fit rather than allowed to reflow.
    //
    // **`marginLeft` is what makes the sentence above true**, and it was missing until a
    // review put a ruler on the screen. Each target is 48 dp with its 18 dp dot centred
    // inside it (`ratingTarget`, §0.5's floor), so the first dot's ink began 15 dp to the
    // right of the label above it and of every chip row on the form — an indent nothing asked
    // for, on the one row that is supposed to start where the others do. In code it looks
    // right, because each *style* is right; it is only visible on a device, and 15 dp is
    // exactly the size that reads as "slightly off" rather than as broken.
    //
    // So the row gives back precisely the slack the target's own centring takes, computed
    // from the two sizes rather than written as `-15`: change either and this follows. The
    // dots keep their centred 48 dp targets — see `ratingTarget` for why that centring must
    // not be traded away instead — and the row's trailing target simply overhangs into the
    // field's own padding, which nothing else occupies.
    formRatingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: -(RATING_TARGET_SIZE - RATING_DOT_FIELD_SIZE) / 2,
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
    // an icon alone." A chip with no icon — every chip on the form but `Entry`'s shore and
    // boat, since M1i took the scale marks out — is a row of one child, which lays out exactly
    // as the centred column did.
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
    // M1h's chip marks had five styles here — a row that held N copies of one symbol, and the
    // visibility bars in three heights and two inks. They went out with the marks (M1i, §10):
    // the bars cost *Visibility low* a glyph that read as punctuation, and the repeated arrows
    // cost *Current* and *Surge* a second line. §9's shelf carries what a replacement has to be,
    // and it will bring its own geometry rather than inherit theirs.
    // The save action's fixed footer (§0.5: "the primary action sits in the bottom
    // third"; brief step 4: never disabled). Sits OUTSIDE `formScroll` above as a
    // sibling, not inside it, so it stays reachable without scrolling to the end of a
    // long form — "one scroll view" (brief) describes the form's OWN fields, not this
    // persistent action bar.
    formFooter: {
      paddingHorizontal: CONTENT_INSET,
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
    // what went wrong. `paddingHorizontal` is `CONTENT_INSET`, so it sits in the same
    // column every row on this form does; it draws no hairline, because it is not a row.
    formFieldError: {
      alignItems: 'flex-end',
      paddingHorizontal: CONTENT_INSET,
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
    // into two different treatments. `CONTENT_INSET`, which is also what `detailBack` takes:
    // this used to be the one place the two exits deliberately differed, each aligning to its
    // own screen's column, and there is one column now (M1l). It is still what the heading
    // directly beneath it — and every field row below that — is aligned to.
    formBack: {
      ...backControl,
      paddingHorizontal: CONTENT_INSET,
    },
    formBackLabel: backControlLabel,
    // §2.1's cylinder presets, at the two ends of the Gas & cylinders group (M1e).
    //
    // **The chips are `formChip`/`formChipText` above, unchanged and unwrapped**, and there
    // is deliberately no `formPresetChip` of any kind: §0.6's chip is one object with one
    // treatment, and a second set of chip properties here is exactly the drift §4.1 is
    // about. What the preset row does NOT borrow is `formChipSelected` — a preset is
    // *applied*, not *selected*, so there is no chosen state for the invert to express, and
    // a chip that could never invert would be the invert rule written down and then denied.
    // See `PresetChips` (DiveFormScreen.tsx) for why the same reasoning keeps this out of
    // `OptionChips`, which owns that invert and nothing else.
    //
    // The capture control is `detailDelete`'s shape, on `detailDelete`'s own reasoning:
    // "a deliberate act on one dive should take a deliberate reach". Saving a preset is that
    // kind of act — it is not part of the flow down the fields — so it sits at the END of
    // the group, wears a muted label rather than a fill, and never competes with the one
    // primary action on the screen (`action`/`actionLabel`, which stays the dive's save).
    // Trailing (`flex-end`) rather than centred, unlike `detailDelete`: it sits inside a
    // group of trailing-value rows rather than alone at the bottom of a screen, and a
    // centred label in that column would read as a heading for the group below it.
    formPresetActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: CONTENT_INSET,
      paddingTop: FIELD_EXTRA_CLEARANCE,
    },
    formPresetAction: {
      minHeight: 48,
      justifyContent: 'center',
      // The 48 dp floor (§0.5) is the row's height; this is what gives a two-word label a
      // target wider than the words themselves without a visible box around it.
      paddingHorizontal: 8,
    },
    formPresetActionLabel: mutedControlLabel,
    // ------------------------------------------------------------------------------------
    // The cylinder-preset editor (DESIGN.md §3 and §10, M1e) — `GearPresetScreen`
    // ------------------------------------------------------------------------------------
    // Almost every style this screen needs is already the form's, and that is the point
    // (§0.6: "the form is the dive detail you can type into", and §3's preset editor is that
    // same grammar asking about a cylinder set). It takes `screen`, `formBack`/`formBackLabel`,
    // `formScroll`/`formScrollContent`, `formFooter`, `action`/`actionLabel` and every
    // `formField*` row through the shared components, unchanged. Only the three keys below
    // are its own, and each is a thing the form has no equivalent of.
    //
    // The title: `screenHeading` plus the row inset, which is exactly the composition
    // `settingsHeading` below makes — a block title with nothing on its line, so plain
    // `screenHeading` rather than `headingTitle`'s `flex: 1`. Two keys from one definition
    // rather than one key shared across two screens, on `detailBack`/`formBack`'s own
    // precedent: the placement is per screen, the type is not.
    presetHeading: {
      ...screenHeading,
      paddingHorizontal: CONTENT_INSET,
    },
    // Deleting a preset — `mutedControl` at the top of this function, the same object
    // *Delete dive* is, at the end of the same kind of deliberate reach.
    presetDelete: mutedControl,
    presetDeleteLabel: mutedControlLabel,
    // A failed save or a failed delete, said plainly (§10: "a local save failure is shown to
    // the diver"). `noticeBanner`'s own shape, with its horizontal margin intact — unlike
    // `detailDeleteError` above, which drops it because `detailContent` already pads its
    // children; this screen's scroll content deliberately has no horizontal padding of its
    // own (`formScrollContent`, so a row's hairline reaches the screen's edges), so the
    // banner has to carry its own.
    presetNotice: noticeBanner,
    presetNoticeText: noticeBannerText,
    // ------------------------------------------------------------------------------------
    // Settings (DESIGN.md §3: units, `dives_before`, and the cylinder-preset list)
    // ------------------------------------------------------------------------------------
    // The screen is a column of §0.6 rows, exactly as the form is — "a field is a row, label
    // leading, value trailing" — so it borrows the form's scroll shape and its row inset
    // rather than inventing a third vocabulary for the same objects. Every row-level style
    // it uses (`formField`, `formFieldRow`, `formFieldLabel`, `formChipRow`, `formChip`) is
    // literally the form's, read through the shared components; only the three keys below
    // are its own, and each is a thing the form has no equivalent of.
    settingsScroll: rowScroll,
    // **`paddingBottom` is deliberately absent**, and composed at the call site from
    // `screenBottomInset(insets.bottom)` — the near-duplicate of `formScrollContent` above,
    // and the half of the old shared pair that genuinely needed the device (§4.1: a
    // deliberate near-duplicate names its siblings). This ScrollView is the only child of
    // this screen's root, so it runs to the bottom of the display and its content scrolls
    // under the tab bar; the form's is a sibling above a footer that already spent the inset.
    // The 40 they shared was right for the form and 43 pt short here, which is a last row
    // under the Liquid Glass — the same defect `screenBottomInset` was written for, in a
    // screen that simply had too few rows to reach the bottom and show it.
    settingsContent: rowScrollContent,
    // The screen's title — `screenHeading` at the top of this function, the form's own, plus
    // the row inset so it lands in the same column as the labels beneath it. The tab bar
    // names this screen too, and the title still earns its place: a tab label is chrome the
    // eye skips, and this is the first line of the page.
    settingsHeading: {
      ...screenHeading,
      paddingHorizontal: CONTENT_INSET,
    },
    // A sentence under a row, explaining what the row does — `dives_before`'s "every dive
    // number moves with this", and the note shown when the stored value cannot be read.
    //
    // `captionBlock`/`captionText` at the top of this function, which carry the whole account
    // of the treatment and of why the account screen shares this definition rather than
    // retyping it.
    settingsCaption: captionBlock,
    settingsCaptionText: captionText,
    // A named group of rows on this screen — §3's cylinder presets, which is the first thing
    // here that is a *list* rather than a setting and so needs saying what it is.
    //
    // `clusterLabel` (this function's own top), the same treatment §0.6 gives *Conditions*
    // and *Gas & cylinders* on both the form and the detail: "A group header is a cluster
    // label — Plex Mono 10.5, uppercase, +0.14 em, muted." Nothing new is invented for one
    // heading. `paddingBottom` is what keeps it off the first row's own top hairline, which
    // that row draws for itself (`formField`); the row inset puts it in the column the names
    // beneath it land in.
    settingsSectionTitle: {
      ...clusterLabel,
      paddingHorizontal: CONTENT_INSET,
      paddingBottom: 8,
    },
    // A preset's name, leading its row exactly as `Units` leads its own — `rowLabel`, in full
    // ink rather than muted.
    //
    // **Ink versus muted ink is the only lever** (§0.6, which uses it for exactly this
    // twice: `detailActionLabel` over `detailBackLabel`, and `tripTitleUpNext` over a trip's
    // own title). "Units" and "Dives before Ponor" are fixed words naming a setting, and
    // muted is right for them. A preset's name is the diver's own data and the thing they
    // scan this list for, so it takes `fg`; §0.1 rules out a hue and a different shape would
    // be new vocabulary for one row.
    //
    // `flexShrink: 1` for the reason `formFieldLabel` records: §0.5's "Czech runs 20–30 %
    // longer", and a long name must wrap rather than truncate.
    settingsPresetName: settingsRowInk,
    // §3's "account & sync" row, which takes the same ink for a related but distinct reason,
    // and it is worth naming the difference rather than letting one key serve both. A
    // preset's name is full ink because it is the diver's own data; this row is full ink
    // because it is a **destination** — a row that opens another screen rather than holding a
    // value, and the only other one on this screen. §0.6 leaves exactly one lever for that
    // ("ink versus muted ink is the only lever"): §0.1 rules out a hue, and the chevron is
    // spoken for — it "marks in-place disclosure... and nothing else", with the explicit
    // rider that "the mark is never spent on navigation".
    //
    // One definition, two keys, on `detailBack`/`formBack`'s own precedent: the treatment is
    // shared and cannot drift, while each caller keeps a name that says what it is.
    settingsAccountLabel: settingsRowInk,
    // The cylinders under that name (`formatCylinders`, format/display.ts) — §0.6's row
    // metadata, which is precisely what this is: "Plex Mono 11.5 · time · duration · rating,
    // middot-separated". Mono because it is almost entirely figures (§0.6: "Figures in mono,
    // names in sans"), which is also why it is not `settingsCaptionText` above — that is a
    // sentence in Archivo explaining what a row does, and this is data about the row.
    //
    // Leading, under the name, in the slot §0.6 gives a field's second line — not trailing in
    // the value column, where a two-cylinder summary would wrap into a two-word-wide ribbon
    // beside a name that had been squeezed to make room for it.
    settingsPresetSummary: {
      fontFamily: fonts.mono,
      fontSize: 11.5,
      color: theme.fgMuted,
      lineHeight: 17,
    },
    // The line that stands where the preset rows would be: either "you have none yet" or
    // "they could not be read", which are different sentences and must not be confused
    // (db/useGearPresets.ts's `error` exists for exactly that). `settingsCaption`'s own
    // treatment — a sentence under a heading, leading, no box — with the top padding it does
    // not need here, since there is no row above it for it to clear.
    settingsPresetEmpty: {
      paddingHorizontal: CONTENT_INSET,
    },
    // Where the diver stands on §3's **location access** (M2m), trailing its row.
    //
    // `rowValueSans` — §0.6's "Figures in mono, names in sans", read the way `accountEmail`
    // below reads it: "Allowed" is a word, not a data figure. It is a value the row REPORTS,
    // which is why it takes the value column's full ink rather than the muted label ink: the
    // row's own label is the muted half, exactly as on `Dives before Ponor`.
    settingsLocationStatus: rowValueSans,
    // The same slot before the permission has been read — "Checking…", muted.
    //
    // **A placeholder and an answer must not look alike** (M1f's rule, which this screen
    // already keeps for `dives_before`: a screen with no answer must not state one). Muted is
    // the lever §0.6 leaves for it, and it is the pairing `formFieldPickerText` /
    // `formFieldPickerTextUnset` already draws one screen over for a value that is read rather
    // than typed.
    settingsLocationStatusUnread: {
      ...rowValueSans,
      color: theme.fgMuted,
    },
    // ------------------------------------------------------------------------------------
    // The account screen (DESIGN.md §5's auth bullet and §7.4, M2e) — `AccountScreen`
    // ------------------------------------------------------------------------------------
    // **Not one new shape between them.** §0.6's origin is "a screen that was built to spec
    // and then styled by default into a different language", and a sign-in screen is where
    // that happens by reflex: every app has one, they all look alike, and none of them looks
    // like this app. So this screen is the form's own grammar — `formBack` out of it,
    // `FormField` rows, `FieldNote` for what went wrong, `action` in a fixed footer — and the
    // six keys below are the same six definitions the preset editor takes one screen over,
    // each under a name that says which screen it is placed on.
    //
    // The title: `screenHeading` plus the row inset, exactly as `presetHeading` and
    // `settingsHeading` are. Two keys from one definition rather than one key shared across
    // screens, on `detailBack`/`formBack`'s precedent — the placement is per screen, the type
    // is not.
    accountHeading: {
      ...screenHeading,
      paddingHorizontal: CONTENT_INSET,
    },
    // What an account is for, and what signing out will do — `captionBlock`/`captionText` at
    // the top of this function, the same sentence-under-a-row Settings uses.
    accountCaption: captionBlock,
    accountCaptionText: captionText,
    // The signed-in address, trailing its row. `rowValueSans` — §0.6's "Figures in mono,
    // names in sans": an e-mail address is a name, not a data figure, however little it looks
    // like one. It is read, never typed, so it is a `Text` in a `formFieldRow` rather than a
    // `FormField`; the row it sits in is the form's.
    accountEmail: rowValueSans,
    // A failed sign-out, said plainly (§10: "a local save failure is shown to the diver").
    // `noticeBanner`'s shape with its horizontal margin intact, exactly as `presetNotice`
    // takes it and for the same reason: this screen's scroll content carries no horizontal
    // padding of its own, so the banner has to bring its own.
    accountNotice: noticeBanner,
    accountNoticeText: noticeBannerText,
    // The two controls on this screen that are deliberate acts rather than its primary one:
    // switching between signing in and creating an account, and signing out. `mutedControl`
    // at the top of this function — the object *Delete dive*, *Delete preset* and *Save as
    // preset* already are.
    //
    // **The treatment is one thing and the placement is another, and only the treatment is
    // here** (M2f). Sign-out is centred at the end of its branch's content, where the two
    // deletes sit; the mode toggle is in the footer directly under the primary action,
    // because it is about that action rather than about the page (AccountScreen.tsx's
    // `SWITCH_TO`). Both are still this one definition: a `mutedControl` centres its label
    // inside a real 48 dp box wherever it is put, which is what let one of them move without
    // the sheet gaining a second spelling of the same six properties.
    //
    // **One pair for both, named for what they share rather than for either caller.** They
    // are the same object doing the same job: §0.1 spends every hue on depth, so a control
    // you should not hit by accident is a plain muted label, and the weight for the one that
    // destroys something goes into the platform dialog this app does not draw (§10). A second
    // key would be two spellings of one treatment, which is the drift `mutedControl` itself
    // exists to have stopped three times already.
    accountSecondaryAction: mutedControl,
    accountSecondaryActionLabel: mutedControlLabel,
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

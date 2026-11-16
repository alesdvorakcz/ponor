import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDepthBoundary, METADATA_SEPARATOR } from '../format/display';
import { t } from '../i18n';
import { type UnitSystem } from '../format/units';
import { deepestBandStartM, shallowestBandEndM } from '../theme/depth';
import { makeStyles, screenBottomInset } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { AccountOfferCard, OrRule } from './AccountOfferCard';
import { DepthLegend } from './DepthLegend';

/**
 * The mark, monochrome and on a transparent ground — `scripts/build-icons.mjs` builds it from
 * the same `assets/mark.svg` the app icons come from, so the shape cannot drift from the icon.
 *
 * **A bitmap, and deliberately still not a rendered SVG.** When this was written
 * `react-native-svg` was not a dependency at all, and adding one for a single drawing would
 * have bought a native rebuild and a permanent runtime renderer to draw seven line segments
 * that never change. The dive profile has since brought the dependency in (the profile spec's
 * §2 amendment to §10), which removes the cost half of that argument and none of the rest: the
 * mark is a fixed shape built from the same `assets/mark.svg` the app icons come from, so
 * rendering it at runtime would buy nothing and would let the mark on screen drift from the
 * mark on the home screen. `src/testing/unexpectedGraphics.ts` still counts the images.
 *
 * Required at module scope, not inside the component: Metro resolves the asset at bundle time
 * either way, and a `require` in a render body reads as if it might not be. Annotated rather
 * than inferred, because Metro's `require` is typed `any` and an unannotated asset would hand
 * that `any` straight to a prop.
 */
const MARK: ImageSourcePropType = require('../../assets/images/mark-mono.png');

/**
 * **How much of the teaching block a guest's first-run screen shows** (review round 2 of PR #52,
 * Aleš's call). `0` is all of it; `1` drops the two reason lines under the legend; `2` drops the
 * mark as well. The label, the promise and the legend's bars stay at every level — the bars are
 * what still say that colour is depth.
 */
type TeachingLevel = 0 | 1 | 2;
const LAST_LEVEL: TeachingLevel = 2;

interface EmptyStateProps {
  scheme: ColorScheme;
  /** The diver's units, for the legend's labels — passed in, like `scheme`, because a screen
   * decides once and its components stay pure (`useUnitSystem`'s docblock). */
  system: UnitSystem;
  onPress: () => void;
  /**
   * **Where the account offer sends the diver, or nothing** (issue #24). Present only while
   * `offersAccount` says this diver is a guest — the caller asks, this component never does —
   * and then the screen draws *or* and the offer card under *Log your first dive*. Absent, the
   * screen is exactly the first-run screen it was before.
   */
  onAccount?: () => void;
}

/**
 * Shown only when the logbook genuinely has no dives (`useDives()` returned
 * an empty list with no error) — never for a search that matched nothing,
 * and never for a failed read. Those three read the same to a diver unless
 * DivesScreen.tsx tells them apart, and this component is only ever the
 * first of them: a failed read is a lie this component would tell if it
 * were reused for that case, which is why DivesScreen.tsx checks `error`
 * before it ever gets here (see its own comment).
 *
 * ---
 *
 * **It is a first-run screen, not a placeholder** (M1h, the owner's design). It held one
 * sentence — "Your logbook is empty." — over the button, which is the only thing the screen
 * *had* to say and nothing a diver did not already know. What it now says is the one thing no
 * other screen in Ponor can: **§0.1, the app's central conceit, was explained nowhere.** A
 * diver met the depth palette one number at a time at the right-hand end of a dive row, where
 * it reads as decoration that happens to vary. This is the only screen with no dive to attach
 * a colour to, so it is the only place the scale can appear as a scale — and the last time it
 * is seen out of context. Everything above the button is that lesson, in the order a diver
 * needs it: the mark, what state the logbook is in, what the app promises (§1's "Works at sea",
 * said to a diver rather than to a planner), the scale, and why the scale is that sequence.
 *
 * **The mark is monochrome, and that is §0.1 enforcing itself.** §0.3 strokes this same shape
 * in the depth gradient *on the app icon*, where the mark is the only thing there is. Drawn
 * inside the interface, that gradient would be colour used as **brand** — and §0.1 says colour
 * encodes depth and nothing else. So the only hue anywhere on this screen is the legend, and
 * the legend is depth. The tint and the half strength live in `emptyStateMark`
 * (theme/styles.ts), which says the same thing at the point where it could be undone; the
 * asset itself is single-colour before any tint is applied, so even a platform where tinting
 * failed could not restore the gradient (scripts/build-icons.mjs).
 *
 * **Not one number on this screen is typed here.** The legend's boundaries come from
 * `theme/depth.ts` and its words from `format/display.ts`; so do the two depths in the reason
 * line, which would otherwise be the same drift arriving one line below the legend it
 * contradicts — and in imperial, a caption reading "6 m" under bars labelled `0–20 · 20–39 · …`
 * would be a first-run screen teaching in two unit systems at once.
 *
 * **Nor is one word.** The reason line is a single key with the two depths interpolated, not an
 * English sentence with figures dropped into gaps: §0.5's Czech is 20–30 % longer and puts its
 * clauses in a different order, so a sentence assembled from JSX fragments would be
 * untranslatable without rebuilding this component. Same for the promise above it, which was
 * two source lines and is one string.
 *
 * The primary action sits in the bottom third of the screen (DESIGN.md
 * §0.5: wet hands, one thumb) and is styled from the `action`/`action-fg`
 * tokens — the app's one button treatment (§0.1: colour is depth and
 * nothing else, so every control, including this one, is monochrome).
 *
 * **The clearance beneath that action is the device's, never a constant**
 * (M1h — `screenBottomInset`, theme/styles.ts, owns the rule and records
 * the measurement). This wrapper carried `paddingBottom: 48` and the
 * screen it lives on sits inside a real iOS 26 `UITabBarController`, which
 * reports 83 pt of bottom safe area on an iPhone 17 Pro — 34 of home
 * indicator plus 49 of Liquid Glass tab bar. So the button rendered
 * *underneath* the bar: label illegible through the material, only its
 * left edge exposed, and still tappable, so nothing anywhere reported a
 * failure. §0.6 leaves the top-right capsule off this branch on purpose,
 * which makes this button the ONLY way a first-run diver reaches the form
 * — the one control that must never be the one that is hidden.
 *
 * This is why the component reads a hook at all rather than staying a pure
 * function of `scheme`: the clearance is a property of the device, and a
 * scheme-only stylesheet is exactly where the wrong answer hid.
 *
 * **The teaching block scrolls and the button does not, which is this screen's answer to a
 * small phone.** Five elements now sit above a control whose position is fixed by the device;
 * on a 4.7" screen, or in Czech (§0.5: 20–30 % longer), they do not all fit. The two failure
 * modes that had to be avoided are the ones this project has already paid for: content clipped
 * off the top edge with nothing to say it is there, and a button that gives back the clearance
 * `screenBottomInset` exists to defend. A `ScrollView` above a fixed footer does neither — it
 * is the arrangement `DiveFormScreen` already uses for the same pair of objects.
 *
 * Review task 7, Important #4: this is the entire first-run experience, so its `Pressable`
 * carries `accessibilityRole="button"` rather than relying on the default — `Pressable`
 * does not supply one on its own. No separate `accessibilityLabel`: unlike `DiveRow`'s
 * fragmented number/site/depth, this button's own visible text already says exactly what
 * it does.
 */
export function EmptyState({ scheme, system, onPress, onAccount }: EmptyStateProps) {
  const styles = makeStyles(scheme);
  const insets = useSafeAreaInsets();
  const offered = onAccount !== undefined;

  /**
   * **Keeping *Log your first dive* above the fold** (review round 2 of PR #52, Aleš's call). With
   * the offer, the button scrolls with the teaching block (below), so at a large text size on a
   * small phone the screen's one primary action could start under the fold. When it would, the
   * screen teaches less — the reason lines first, then the mark — rather than leave a first-run
   * diver looking at a screen with no visible way to log.
   *
   * Three measurements decide it: the scroll's own height (the viewport), the button's height,
   * and where the footer starts inside the content. `marginTop: 'auto'` puts the footer straight
   * after the teaching block whenever the content overflows, so `footer.y + button > viewport` is
   * the whole test.
   *
   * **One step per measurement, never back up.** A footer measurement is kept with the level it
   * was measured at, and only one measured at the current level can step it down — so the frame
   * that removes the reasons cannot be judged by the layout that still had them. Coming back up
   * from a trimmed layout that fits would push the button under again and flicker between the two;
   * so the level only resets, to full, when the viewport or the text size changes (rotation, a new
   * text size). The first frame draws in full before any trimming, and that one-frame jump is
   * accepted rather than paying for an invisible measuring pass. If the button is still under the
   * fold at the last level, the screen stops there; the content still scrolls.
   *
   * None of this runs without the offer: then the button is pinned outside the scroll (M1h) and
   * cannot be under the fold at all.
   */
  const { fontScale } = useWindowDimensions();
  const [viewport, setViewport] = useState<number | null>(null);
  const [buttonHeight, setButtonHeight] = useState<number | null>(null);
  // Kept with the level and the text size it was measured at: only a measurement of the layout on
  // screen now may step the level down. A new text size re-lays the content out, so a fresh one
  // always follows; the viewport is not part of it, because once the content overflows the footer
  // starts where the teaching block ends whatever the viewport's height.
  const [footerAt, setFooterAt] = useState<{ y: number; level: TeachingLevel; fontScale: number } | null>(null);
  const [level, setLevel] = useState<TeachingLevel>(0);
  const fitKey = `${viewport ?? '-'}|${fontScale}`;
  const [fittedFor, setFittedFor] = useState(fitKey);
  if (fittedFor !== fitKey) {
    // React's own pattern for state derived from a changed input: reset during render, so no
    // frame is drawn at the stale level.
    setFittedFor(fitKey);
    if (level !== 0) setLevel(0);
  }
  const buttonHidden =
    offered &&
    viewport !== null &&
    buttonHeight !== null &&
    footerAt !== null &&
    footerAt.level === level &&
    footerAt.fontScale === fontScale &&
    footerAt.y + buttonHeight > viewport;
  // Stepped down during render, like the reset above: the measurement that asked for it was taken
  // at the old level, so it stops counting the moment the level moves and cannot step it twice.
  if (buttonHidden && level < LAST_LEVEL) setLevel((level + 1) as TeachingLevel);
  const showReasons = level < 1;
  const showMark = level < 2;
  // Measured only with the offer; without it nothing here is ever read.
  const onViewport = offered ? (e: LayoutChangeEvent) => setViewport(e.nativeEvent.layout.height) : undefined;
  const onButton = offered ? (e: LayoutChangeEvent) => setButtonHeight(e.nativeEvent.layout.height) : undefined;
  const onFooter = offered ? (e: LayoutChangeEvent) => setFooterAt({ y: e.nativeEvent.layout.y, level, fontScale }) : undefined;
  /**
   * **The primary first, then the offer** (issue #24, the owner's order). Logging stays one tap and
   * stays the one inverted control here; the offer is an alternative under it, never a step in
   * front of it, and has nothing to dismiss.
   *
   * **Without the offer the primary is pinned outside the scroll** (M1h): the one control a
   * first-run diver has must never scroll away. **With it, the block scrolls with the teaching
   * above it** (review of PR #52) — pinned, the button, the rule and the card are ~260 pt in Czech
   * and grow with the diver's text size, and at a large size on a 4.7" phone they outgrew the
   * screen, collapsed the scroll to nothing and put the card's button under the tab bar where no
   * gesture could reach it. In the scroll it is pinned to the bottom of the content instead
   * (`emptyStateFooterInScroll`), so on a phone where it fits the screen is unchanged.
   *
   * **§0.5 is bent here, knowingly.** With the card beneath it the primary sits mid-screen rather
   * than in the bottom third. The owner accepted that for this one screen, which a diver sees once
   * and mostly on land; without the card — signed in, or a build with no backend — the button is
   * back at the bottom.
   */
  const footer = (
    <View style={[styles.emptyStateFooter, offered && styles.emptyStateFooterInScroll]} onLayout={onFooter}>
      <Pressable style={styles.action} onPress={onPress} accessibilityRole="button" onLayout={onButton}>
        <Text style={styles.actionLabel}>{t('empty.action')}</Text>
      </Pressable>
      {onAccount !== undefined && (
        <>
          <OrRule scheme={scheme} />
          <AccountOfferCard scheme={scheme} onPress={onAccount} />
        </>
      )}
    </View>
  );
  return (
    // `paddingBottom` composed here, not in the sheet: `screenBottomInset` is the app's one
    // owner of "how far above the bottom edge content may end" (§4.1), and what the device
    // hands it on this screen already includes the tab bar in front of the button — see its
    // docblock for the measurement, and `emptyStateWrap` for why the sheet deliberately
    // carries no `paddingBottom` of its own.
    //
    // **The `+ 24` is a gap over the bar, not a guess at its height.** Composed the way
    // `DiveFormScreen`'s footer already composes `insets.bottom + 24` — the same 24, for the
    // same object: a full-width `styles.action` anchored to the bottom of a screen. Without
    // it the button lands exactly on the safe-area line, which on iOS 26 is exactly the
    // Liquid Glass bar's own top edge: legible, but abutting it, with the bar's shadow
    // falling on the button and the two reading as one stacked object (looked at on the
    // simulator, not deduced — the flush version was rendered and rejected). Inside the
    // `screenBottomInset` call rather than added after it so the app's floor still wins
    // where a device reports no inset at all: the browser's tab bar is a sibling below the
    // screen, nothing is obscured, and the empty state keeps the 48 it has had since M0.
    <View style={[styles.emptyStateWrap, { paddingBottom: screenBottomInset(insets.bottom + 24) }]}>
      {/* **With the offer, the teaching block sits at the top** (the owner's call, 2026-11-16):
          the card under the button would otherwise crowd the scale's last line, so the air goes
          between the scale and the button instead of above the mark. */}
      <ScrollView
        // Remounted when the text size changes (found on the simulator): a trim re-rendering this
        // screen while iOS applies a new Dynamic Type size left the texts that stayed with their
        // old heights — the promise clipped going up, a two-line-tall button going down. A fresh
        // mount measures every text at the new size.
        key={offered ? `teaching-${fontScale}` : 'teaching'}
        style={styles.emptyStateScroll}
        contentContainerStyle={[styles.emptyStateContent, offered && styles.emptyStateContentTop]}
        onLayout={onViewport}
      >
        {/* Decorative, and said so rather than left to a platform default: the sentence and
            the legend below carry every fact the mark carries, so a screen reader announcing
            it would only ever announce "image". */}
        {showMark && <Image source={MARK} style={styles.emptyStateMark} accessible={false} />}
        <Text style={styles.emptyStateLabel}>{t('empty.label')}</Text>
        <Text style={styles.emptyStateText}>{t('empty.promise')}</Text>
        <DepthLegend scheme={scheme} system={system} />
        {/* The reason lines are the first thing to go when the button would start under the
            fold (see `level` above); the bars above still say that colour is depth. */}
        {showReasons && (
          <>
          <Text style={styles.emptyStateReason}>
            {t('empty.reasonColour')}
            {METADATA_SEPARATOR}
            {t('empty.reasonNothingElse')}
          </Text>
          {/* The two depths come from `theme/depth.ts` and are read in the diver's own units,
              so this sentence can never contradict the bars directly above it — see the
              docblock, and `formatDepthBoundary` for why a band boundary is not formatted the
              way a dive's depth is. */}
          <Text style={styles.emptyStateReason}>
            {t('empty.reasonLight', {
              shallow: formatDepthBoundary(shallowestBandEndM, system),
              deep: formatDepthBoundary(deepestBandStartM, system),
            })}
          </Text>
          </>
        )}
        {offered && footer}
      </ScrollView>
      {!offered && footer}
    </View>
  );
}

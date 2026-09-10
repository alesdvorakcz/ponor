import { useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Ellipse, Line, Path } from 'react-native-svg';

import { type DiveSample } from '../db/schema';
import { consumptionSeries } from '../domain/consumption';
import {
  axisMax,
  colourRuns,
  deepestSampleIndex,
  depthAxis,
  gasAt,
  gasSegments,
  medianIntervalS,
  pathOf,
  type Plotted,
  type ProfilePoint,
  round,
  scrubbedIndexAt,
} from '../domain/profile';
import { type Dive } from '../domain/types';
import {
  formatDepth,
  formatDepthBoundary,
  formatDuration,
  formatRmv,
  formatSampleCount,
  formatSampleInterval,
  isDisplayableDepth,
  METADATA_SEPARATOR,
  NO_FIGURE,
} from '../format/display';
import { type UnitSystem } from '../format/units';
import { t } from '../i18n';
import { depthColor } from '../theme/depth';
import { themeFor } from '../theme/resolve';
import {
  makeStyles,
  PROFILE_DEEPEST_MARK_RADIUS,
  PROFILE_DEPTH_STROKE_WIDTH,
  PROFILE_PLOT_HEIGHT,
  PROFILE_PLOT_INSET_Y,
} from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * **The viewBox's nominal x-extent, not a width anything is laid out at.**
 *
 * The `<Svg>` is `width="100%"` with `preserveAspectRatio="none"`, so the drawing stretches to
 * whatever the content column gives it (`profilePlot`, theme/styles.ts) and this number only
 * decides the units the path data is written in. It is set near a phone's real content width,
 * so on a phone the horizontal scale sits at about 1 and the stretch is invisible.
 *
 * **It is not about 1 everywhere, which is the whole-branch review's Minor #3.** `DivesScreen`'s
 * wide layout puts this whole screen in `wideDetailColumn` — a `flex: 1` column beside a fixed
 * 360 pt list — so the plot runs about 590 pt on a 1024 pt iPad and about 930 pt on a 1366 pt
 * one, scales of ~1.8 and ~2.9. Every stroke carries `vectorEffect="non-scaling-stroke"` and so
 * cannot be distorted at any of them; the deepest-sample mark is the one shape a non-uniform
 * scale genuinely stretches, and it now counteracts the stretch itself (`markRx`) rather than
 * relying on there being little to counteract.
 *
 * **The column IS measured now, and this constant is deliberately not what it measures.** The
 * scrub (spec §5) maps a touch's x back to a time, which needs the real width, so the plot
 * reports its own through `onLayout` — see `scrubbedIndexAt` (domain/profile.ts). That
 * measurement is the *touch* scale and stays out of the drawing's units: the path data below is
 * written in these, the SVG goes on stretching to whatever the column gives it, and the only
 * thing the measurement changes about the drawing is the mark's own horizontal radius — one
 * number, redrawn when it arrives, with the round mark of a phone standing until it does. Two
 * scales, one for what is drawn and one for what is touched, is what keeps every test in this
 * file able to render the real card without a layout pass Jest never performs.
 */
export const PLOT_WIDTH = 320;

/**
 * **The plot's own handle**, for `onLayout`'s measurement and for the pan attached to it.
 *
 * One string for both, because to a test they are one thing: the view whose width is measured
 * is the view the finger is dragged across, and a scrub mapped through any other box's width
 * would be wrong by exactly the difference. RNGH keeps gesture test ids in a registry of its
 * own (`getByGestureTestId`), separate from React Native's `testID` tree, so the two uses
 * cannot collide.
 *
 * Exported because the test drives both halves through it, and because this is the app's first
 * `testID` — a string a component and its test must agree on letter for letter is exactly the
 * kind of thing §4.1 says gets one owner rather than two spellings.
 */
export const PROFILE_PLOT_TEST_ID = 'profile-plot';

/**
 * The three stroke weights this file still owns, in viewBox units.
 *
 * **Deliberately not in `makeStyles`**, which is the one place a *token* may meet a *style
 * property* (theme/styles.ts's own header). None of these is either: they are geometry handed
 * to an SVG element as props, they carry no colour, and no `View` is painted with them — so
 * putting them in the sheet would widen its contract rather than honour it.
 *
 * **The depth stroke and the marker radius are NOT here, and their absence is the same rule
 * read the other way.** `PROFILE_PLOT_INSET_Y` is derived from those two, the axis column is
 * laid out against that inset, and the sheet is where a number two files must agree on lives —
 * `PROFILE_PLOT_HEIGHT`'s own reason. They are module constants there rather than entries in
 * the sheet, so nothing about the paragraph above is weakened by the move; see their docblock
 * in theme/styles.ts for the shear that followed from their once being local here.
 */
const GAS_STROKE_WIDTH = 1;
const GRID_STROKE_WIDTH = 1;
const HAIRLINE_STROKE_WIDTH = 1;

/**
 * **How far a finger must travel sideways before the chart takes the gesture**, in points —
 * spec §5's *"horizontal activation only"*.
 *
 * The dive detail is a `ScrollView`, and a pan with no activation threshold wins the touch the
 * instant it lands: the page would stop scrolling anywhere over the chart, which reads as a
 * broken screen rather than as a feature. With the threshold, a straight vertical drag never
 * activates the pan at all and scrolls the page as it always did, while a horizontal one scrubs.
 *
 * Applied symmetrically (`[-8, 8]`), because a diver scrubs in both directions.
 */
const SCRUB_ACTIVATION_X = 8;

/**
 * **How far it may drift vertically while doing it**, in points — the companion
 * `activeOffsetX` needs and did not have (whole-branch review).
 *
 * A sideways threshold alone decides nothing about a *diagonal* drag: a finger heading mostly
 * down the page still accumulates `SCRUB_ACTIVATION_X` of sideways travel on the way, and
 * whichever threshold it crosses first wins the touch. Without this the chart could take a
 * gesture the diver meant as a scroll — the exact failure `SCRUB_ACTIVATION_X` exists to
 * prevent, arriving by the other axis, and the sentence above used to claim it could not.
 *
 * **Equal to the sideways threshold, and the equality is the whole rule**: the chart takes the
 * touch only when the drag is more sideways than down. That is a line with a meaning rather
 * than a tuned number — no ratio to re-guess when either threshold moves.
 *
 * A first version made this larger, on the thought that a thumb tracing a curve wanders and the
 * band between the two should belong to the chart. Review priced that: at 12 against 8 the pan
 * wins every drag inside 56° of horizontal, which is well past the point where the finger is
 * travelling further down the page than across it. **The two harms are not symmetric.** A page
 * that stops scrolling anywhere over the chart reads as a broken screen — the failure
 * `SCRUB_ACTIVATION_X` exists to prevent — where a scrub that needs one straighter second
 * attempt is a moment's friction. When in doubt the scroll should win, so it does.
 *
 * **It only governs activation.** Once the pan has the touch the finger may go anywhere;
 * tracing the curve up and down does not hand the gesture back mid-scrub. (RNGH 2.32 evaluates
 * the offsets inside `checkBegan()` alone, guarded on `State.BEGAN`.)
 *
 * Reasoned, not measured: Jest never runs gesture arbitration, so no test can feel this. It is
 * the one number on this card a thumb has to settle.
 */
const SCRUB_FAIL_Y = SCRUB_ACTIVATION_X;

/**
 * `PROFILE_PLOT_INSET_Y`'s counterpart on the other axis (theme/styles.ts), and it exists for
 * exactly one shape: **the scrub hairline**, which is the only thing this plot draws whose
 * stroke runs along x rather than across it. A vertical line at `x = 0` or `x = PLOT_WIDTH` has
 * half its own width outside the viewport and renders at half weight — the same clip the
 * finding behind that inset describes for a gridline, turned ninety degrees — and a diver
 * reaches both edges routinely, since the ends of the series are where a scrub naturally runs
 * out.
 *
 * Half the hairline's own width and nothing else's: the curve's endpoints do not need it (a
 * stroke is laid perpendicular to its path, so a run ending at `x = 0` extends inward, not
 * past the edge) and the marker already has `PROFILE_PLOT_INSET_Y` for its radius on the
 * vertical axis, where nothing scales it.
 *
 * In viewBox units, like every other number here, and on a phone that is near enough to points
 * because this viewBox is written at about a phone's real content width (`PLOT_WIDTH`'s own
 * argument). On the wide layout it is not: a hairline drawn 0.5 units in from the edge sits
 * 1.5 pt in on a 1366 pt iPad. That costs nothing here, because all this number has to do is
 * keep the line off the edge, and a wider column only puts it further off — unlike the mark,
 * whose actual roundness depends on the scale and which corrects for it (`markRx`).
 */
const PLOT_INSET_X = HAIRLINE_STROKE_WIDTH / 2;

/**
 * Several stretches of one series as a single path — each begins with its own `M`, so the pen
 * lifts between them and nothing is drawn across the gap.
 *
 * **One `Path` rather than one per stretch**, which is what the spec's §2 amendment bought the
 * dependency for: the whole argument for adopting `react-native-svg` was counted in native
 * views, and a surfacing diver can produce a handful of breaks in a dive. SVG's own subpath is
 * exactly this, so there is nothing to gain by spending an element on each.
 *
 * Built on `pathOf` (domain/profile.ts, moved there in Task 6 so `ProfileSparkline` can share
 * it) rather than a second points-to-`d` builder of its own — this function's whole job is the
 * multi-segment `M`-per-stretch behaviour `pathOf` alone does not have, nothing more.
 */
function multiPathOf(segments: readonly (readonly Plotted[])[]): string {
  return segments.map(pathOf).join(' ');
}

export interface DepthProfileProps {
  /**
   * The dive the series belongs to. Read for exactly two things: `maxDepthM`, which scales the
   * depth axis (spec §3 — the device's own maximum is finer than the series and the samples
   * can be shallower), and `tanks`, which is where the cylinder size the gas trace needs comes
   * from.
   */
  dive: Dive;
  /**
   * The dive's recorded profile, or `null` where there is none — `useDiveSamples`' own answer,
   * handed down rather than read here. A screen does the fetching; a component is a pure
   * function of its props (`useUnitSystem`'s standing rule), which is what lets every test in
   * this file render the real card without a database.
   */
  samples: DiveSample[] | null;
  scheme: ColorScheme;
  /** The diver's units, for the axis labels and the caption. The drawing itself is unitless:
   * every point is scaled against an axis in stored SI, so switching systems relabels the
   * chart and redraws not one pixel of it. */
  units: UnitSystem;
}

/**
 * **§0.4's depth profile: the dive as the computer recorded it, stroked through the depth
 * gradient.**
 *
 * ── What is drawn, and what is refused ────────────────────────────────────────────────────
 *
 * **Nothing at all, unless there is a real series with a real shape in it.** `null` samples,
 * an empty series, a series of one point, a series whose depths `depthBand` would reject, and
 * a series with no elapsed time between its first point and its last all render `null` — no
 * card, no title, no empty plot. §0.4 forbids drawing a curve from anything but real samples
 * and forbids a placeholder standing in for one, and a card carrying a title and an axis over
 * an empty box is exactly that placeholder.
 *
 * **Colour is depth and nothing else** (§0.1). Every stroke of the curve is `depthColor()`'s
 * answer for the band that stroke draws — `colourRuns` (domain/profile.ts) owns the split, one
 * `Path` per band, so no single stroke ever spans two colours and the colour stays *data*
 * rather than becoming a gradient smeared across the dive. The gridlines are `border` and the
 * gas trace is `fgMuted`: the two theme tokens for a hairline and for secondary ink, read from
 * `themeFor` because an SVG `stroke` is a prop and not a style property, so `makeStyles` — the
 * one place a token may meet a *style* — is not where it can come from. `depthColor` reaching
 * a component directly is the same shape and has the same licence (`unexpectedGraphics`'s own
 * `isDepthPaint` exists for it).
 *
 * **The depth axis is scaled from the dive's stored maximum, not from the deepest sample**
 * (spec §3, import spec §4.2), taking whichever of the two is deeper so the curve can never
 * run off the bottom of a plot scaled by a header that disagrees with its own series.
 *
 * **The dot marks the deepest SAMPLE**, in that sample's own band colour — not the stored
 * maximum, which is a figure with no point on the curve to sit on. §0.4 again: the mark has to
 * be somewhere the device actually was.
 *
 * ── The gas trace ─────────────────────────────────────────────────────────────────────────
 *
 * Instantaneous RMV over a moving 60 s window (`consumptionSeries`, domain/consumption.ts),
 * muted, against a right axis that runs 0 to the next multiple of ten — `axisMax`, the same
 * function the depth axis uses, so spec §4.5's *"one convention rather than two"* is one
 * function rather than two roundings that happen to agree.
 *
 * **It is absent entirely when there is nothing to compute it from** — no cylinder size, no
 * per-sample pressure, or fewer than two windows that clear the 1.5 m floor. No trace, no
 * right axis, no apology.
 *
 * **Which cylinder it describes: the dive's first, which is the main one.** `Tank`'s own
 * docblock (domain/types.ts) states that rule — *"first entry = the main cylinder"* — and the
 * per-sample pressures in a series come from one transmitter, which is on that cylinder;
 * `domain/consumption.test.ts` already pairs the reference dive's series with `tanks[0]` on
 * exactly this basis. Note what this is NOT: it is not `derived.ts`'s whole-dive figure, which
 * reads *every* cylinder (`gasUsedLitres`) because it is summing what the diver breathed, and
 * it is not the M1b defect the dive detail records — showing one cylinder's MOD as though it
 * were the dive's — because that hid a fact the other cylinders carried, where this trace can
 * only ever describe the cylinder the transmitter was actually on. A diver who also logged a
 * stage will see it in the whole-dive figure and not in this curve, which is the truth about
 * what was measured.
 *
 * ── The scrub ─────────────────────────────────────────────────────────────────────────────
 *
 * **§5: a fixed readout over the chart, not a tooltip under the finger.** A tooltip is covered
 * by the hand that summons it and clips at both edges of the plot; the row above states the
 * depth and the gas at the position being touched, always present, never moving (`profileReadout`,
 * theme/styles.ts, gives each figure a fixed share of the row so a changing figure cannot
 * shift its neighbour).
 *
 * **Before any touch it reads the deepest SAMPLE**, which is the point already marked with a
 * dot — not `dive.maxDepthM`, which is a figure with nothing on the curve to sit on, and which
 * for the reference dive is genuinely a different number (24.33 m against a deepest sample of
 * 24.29). One `deepestSampleIndex` (domain/profile.ts) answers for both the dot and the
 * readout, so the row cannot describe a point other than the one marked.
 *
 * **Both halves answer for ONE instant** — the scrubbed sample's — so the hairline, the depth
 * and the gas figure are three statements about the same moment rather than three near-misses.
 * The gas half shows an em dash wherever the trace itself is not drawn (`gasAt`,
 * domain/profile.ts), which is §0.4 reaching the readout: no complete window covered that
 * instant, so there is no reading, and interpolating one across a surface break would invent a
 * measurement.
 *
 * **The pan runs its callbacks on the JS thread (`runOnJS(true)`), and that is required rather
 * than a preference.** Reanimated's Babel plugin turns a gesture callback into a worklet, and a
 * worklet runs on the UI thread where `setState` is not available — so without this the scrub
 * would work in every test here (Jest has no UI thread to be wrong about) and do nothing on a
 * device. It also silences RNGH's own warning about the same thing, which is the library asking
 * for exactly this to be made explicit.
 *
 * **A `GestureHandlerRootView` has to be mounted above this**, or `GestureDetector` throws in
 * development — `src/app/_layout.tsx` carries the app's one root view, added with this card.
 *
 * ── The drawing itself ────────────────────────────────────────────────────────────────────
 *
 * One `<Svg>`, stretched to the content column (see `PLOT_WIDTH`), holding the gridlines, then
 * the gas trace, then the depth runs, then the hairline, then the mark — in that order, because
 * that is the order they stack: the secondary series passes under the curve it accompanies,
 * never over it, and the hairline passes over both because being hidden by the data it points
 * at is the one thing it may not do.
 *
 * **Three inks, one meaning each**, which is what keeps §0.1's rule readable on a chart that has
 * to draw three non-depth things: `border` is the grid, `fgMuted` is the gas series, and `fg` is
 * where the diver's finger is. A hairline in either of the other two would be a second thing
 * wearing a colour that already means something here.
 *
 * **The axis labels are `Text`, not SVG text**, and that is deliberate: they are type, so they
 * belong to §0.2's faces and to `makeStyles` like every other word in the app, and they stay
 * readable to a screen reader and to a test. `profileDepthAxis` (theme/styles.ts) carries the
 * arithmetic that lands each one on its own gridline.
 *
 * **The drawing carries no accessibility label of its own, and that is a decision.** Every
 * fact on this card that can be said in words already is: the caption states how many readings
 * and how often, the axis labels state the range, and the hero above states the dive's maximum
 * depth and duration. What is left is the *shape*, which is the one thing a label cannot
 * convey — and spec §5's scrub readout, which puts the depth and gas at a chosen instant on
 * screen as text, is the designed answer to reading the curve rather than looking at it. A
 * sentence invented here would be a second owner of those same facts before that lands.
 */
export function DepthProfile({ dive, samples, scheme, units }: DepthProfileProps) {
  // **Both hooks sit above every guard below, and have to.** This component refuses to draw a
  // great many shapes of series (see its docblock) and did so before it held any state at all;
  // a `useState` under one of those early returns would be called on some renders and not
  // others, which React forbids outright. So the state is declared first and the refusals read
  // exactly as they did.
  //
  // `plotWidth` is the column's measured width in points, `null` until `onLayout` has fired —
  // the touch scale, never the drawing's (`PLOT_WIDTH`). `scrubbed` is an index into `samples`,
  // `null` until a finger has actually moved across the plot, which is what tells "the diver is
  // reading the dive's maximum" apart from "the diver is reading the point they chose".
  const [plotWidth, setPlotWidth] = useState<number | null>(null);
  const [scrubbed, setScrubbed] = useState<number | null>(null);

  if (samples === null) return null;

  const runs = colourRuns(samples, scheme);
  // Every point that will actually be stroked, in order — including the boundary samples
  // `colourRuns` repeats into the run they open, which are harmless for the one thing this is
  // read for below: a duplicate cannot change where the curve starts or ends.
  const drawn = runs.flatMap((run) => run.points);
  const first = drawn.at(0);
  const last = drawn.at(-1);
  // `colourRuns` returns `[]` below two usable samples, which is the "nothing to draw" case in
  // full: no samples, one sample, or a series whose depths it had to reject.
  if (first === undefined || last === undefined) return null;

  // ONE x domain for both series — the full RECORDED series' time extent, its first sample's
  // own offset to its last — not `drawn`'s (`colourRuns` may reject trailing samples over a
  // bad depth) and not the depth curve's alone: `consumptionSeries` below reads every sample
  // regardless of whether its depth could be banded, so a gas point can sit past whatever
  // `drawn` alone would call the end of the dive. Both series are subsets of ONE recorded
  // array, so reading the domain off that same array is what makes the axis mean one thing
  // rather than two — a depth curve that stops short of this domain's own right edge because
  // its trailing samples had no usable depth is the honest rendering of that, not a bug to
  // paper over. A series whose first and last sample share one instant has no time axis to
  // draw at all and is refused rather than divided by zero.
  const firstSample = samples.at(0);
  const lastSample = samples.at(-1);
  // `first`/`last` above already being defined means `colourRuns` found at least two bandable
  // samples IN `samples`, so both ends of the raw array exist too — `noUncheckedIndexedAccess`'s
  // claim, not a real possibility, exactly as `consumption.ts`'s own `start`/`end` narrowing.
  if (firstSample === undefined || lastSample === undefined) return null;
  const startS = firstSample[0];
  const endS = lastSample[0];
  if (!(endS > startS)) return null;

  const styles = makeStyles(scheme);
  const theme = themeFor(scheme);

  // The deepest sample, as an INDEX into the recorded series, because the mark and the
  // untouched readout are one fact and the scrub's own state is an index (`deepestSampleIndex`,
  // domain/profile.ts, which is where the tie rule and the `isDisplayableDepth` filter are
  // stated).
  const deepestIndex = deepestSampleIndex(samples);
  const deepestSample = deepestIndex === null ? undefined : samples[deepestIndex];
  // `first`/`last` being defined means `colourRuns` accepted at least two samples' depths, and
  // this function scans for exactly those — so this is `noUncheckedIndexedAccess`'s claim
  // again, narrowed explicitly for the same reason `firstSample` above is.
  if (deepestIndex === null || deepestSample === undefined) return null;
  const deepest: ProfilePoint = { t: deepestSample[0], v: deepestSample[1] };
  // `isDisplayableDepth`, not `?? 0`: a stored maximum that is null, NaN or negative is not a
  // scale, and `format/display.ts` is the one owner of that question (§4.1). Whichever of the
  // two is deeper wins, so a header that disagrees with its own series can never scale the
  // plot shallower than the curve it has to contain.
  const storedMaxM = isDisplayableDepth(dive.maxDepthM) ? dive.maxDepthM : 0;
  const axis = depthAxis(Math.max(storedMaxM, deepest.v));

  const x = (seconds: number): number => round(((seconds - startS) / (endS - startS)) * PLOT_WIDTH);
  // Inset by `PROFILE_PLOT_INSET_Y` at both ends (theme/styles.ts, where its own docblock is)
  // so a value at either extreme — 0 m, or a deepest sample sitting exactly on `axis.max` — has
  // room for its own stroke width or marker radius inside the viewport instead of sitting on
  // the edge. The axis column beside the plot is laid out from that same constant, which is
  // what puts each label on the line it names.
  const yDepth = (metres: number): number =>
    round(
      PROFILE_PLOT_INSET_Y + (metres / axis.max) * (PROFILE_PLOT_HEIGHT - 2 * PROFILE_PLOT_INSET_Y),
    );

  // The main cylinder — see this component's docblock for why that is the first and why it is
  // not `derived.ts`'s whole-dive read. `consumptionSeries` decides for itself whether the
  // tank and the series can support a curve at all, and answers `[]` when they cannot.
  const tank = dive.tanks.at(0);
  const gas = tank === undefined ? [] : gasSegments(consumptionSeries(samples, tank));
  const gasDrawn = gas.flat();
  const gasMax = gasDrawn.length > 0 ? axisMax(Math.max(...gasDrawn.map((point) => point.v))) : 0;
  // Inverted (rate 0 at the bottom, gasMax at the top) and inset exactly like `yDepth` above —
  // the same edge either scale could sit on is the same viewBox, so it takes the same margin.
  const yGas = (rate: number): number =>
    round(
      PROFILE_PLOT_HEIGHT -
        PROFILE_PLOT_INSET_Y -
        (rate / gasMax) * (PROFILE_PLOT_HEIGHT - 2 * PROFILE_PLOT_INSET_Y),
    );

  // ── The readout, and the pan that moves it ──────────────────────────────────────────────
  // Review round 2, Finding 5: `samples[scrubbed] ?? deepestSample` only HALF survives
  // `samples` changing under a mounted instance. A replacement series shorter than `scrubbed`
  // makes `samples[scrubbed]` `undefined` and the `??` recovers to the default — but a
  // same-length-or-longer replacement finds a real sample sitting at that index and reads it
  // as the diver's own scrub, hairline included, though no finger ever touched it. That gap is
  // real, and left open deliberately rather than closed by storing the scrubbed TIME instead of
  // its index (which would recover either way): `app/dive/[id].tsx` mounts the dive detail on
  // the dive's own id, so moving from one dive to another is a fresh push and a fresh component
  // instance — a fresh `useState`, `scrubbed` back at `null` — never this same instance's
  // `samples` prop changing under it. `scrubbedSample` is also what says whether a finger has
  // been on the plot at all: the hairline is drawn for it and not for the default, because
  // before a touch there is no touch point to mark and §0.4's dot already marks what the row
  // is describing.
  const scrubbedSample = scrubbed === null ? undefined : samples[scrubbed];
  const reading = scrubbedSample ?? deepestSample;
  // Both figures go through `format/display.ts` like every other figure in the app, so the
  // diver's m/ft and l/min/cu ft/min follow them here (§4.1) — and both fall back to the same
  // `NO_FIGURE` the Stats screen's counters use, for the reason that constant records: this row
  // is a fixed pair of slots that may never close up, so an absent figure is a dash rather than
  // a gap that moves the other one. A depth reaches the dash only when the series recorded one
  // this app cannot show (negative, NaN); the gas half reaches it wherever the trace is not
  // drawn, which is the ordinary case rather than the exception.
  const readingDepth = formatDepth(reading[1], units) ?? NO_FIGURE;
  const readingGas = formatRmv(gasAt(gas, reading[0]), units) ?? NO_FIGURE;

  // Inset from both edges so a scrub that runs to either end of the dive still draws a
  // full-weight line rather than half of one — `PLOT_INSET_X`, this plot's only stroke laid
  // along x rather than across it.
  const hairlineX = Math.min(PLOT_WIDTH - PLOT_INSET_X, Math.max(PLOT_INSET_X, x(reading[0])));

  // **The mark's horizontal radius, narrowed by exactly what the column is about to stretch it
  // by** — the only place this drawing reads its own measurement (see `PLOT_WIDTH`). The
  // viewBox is written at a phone's content width and the `<Svg>` stretches to fill whatever it
  // is given, so on `DivesScreen`'s wide layout — a `flex: 1` detail column beside a fixed
  // 360 pt list — the horizontal scale reaches ~1.8 on a 1024 pt iPad and ~2.9 on a 1366 pt
  // one, which draws the mark as a dash rather than a dot. Every stroke is `non-scaling-stroke`
  // and so cannot be distorted at all; the mark is the one shape that can be, and §0.4 makes it
  // the one shape that has to be right, since it is the app's only claim about where the device
  // actually was.
  //
  // **No usable measurement, no correction.** Before `onLayout` there is no scale to counteract
  // and assuming one would distort the mark on the phone this viewBox is written for; a
  // reported width of zero (or a NaN) is not a scale either, and dividing by it would hand the
  // element an infinite radius. This is `scrubbedIndexAt`'s own guard (domain/profile.ts) for
  // the identical question about the identical number — written here as the positive
  // complement, `plotWidth !== null && plotWidth > 0`, because this branch wants the scale and
  // that one wants the refusal. The two admit exactly the same inputs, `NaN` included, which is
  // what stops them coming to different answers about what "measured" means. The measurement
  // arriving redraws the mark and nothing else.
  const markScale = plotWidth !== null && plotWidth > 0 ? PLOT_WIDTH / plotWidth : 1;
  const markRx = round(PROFILE_DEEPEST_MARK_RADIUS * markScale);

  const scrubTo = (touchX: number) => {
    const index = scrubbedIndexAt(touchX, plotWidth, samples);
    // `null` is "this touch cannot be mapped yet" — an unmeasured plot — and doing nothing is
    // the answer (`scrubbedIndexAt`'s own docblock).
    if (index !== null) setScrubbed(index);
  };
  // `onStart` as well as `onUpdate`: with `activeOffsetX` the pan does not activate until the
  // finger has already travelled, so the activation itself carries a position the diver chose
  // and the readout should be there before the next move event arrives. Deliberately NOT
  // `onBegin`, which fires on touch-down before the threshold has been cleared — scrubbing
  // there would move the readout under a finger that was only ever going to scroll the page.
  //
  // And nothing on `onEnd`: **lifting the finger leaves the readout where the diver put it**,
  // which is the whole point of putting the numbers above the plot instead of under the hand
  // that is covering them. Snapping back to the deepest sample on release would mean the one
  // moment a diver can actually read the row is the one moment it stops saying what they chose.
  const scrub = Gesture.Pan()
    .withTestId(PROFILE_PLOT_TEST_ID)
    .runOnJS(true)
    .activeOffsetX([-SCRUB_ACTIVATION_X, SCRUB_ACTIVATION_X])
    .failOffsetY([-SCRUB_FAIL_Y, SCRUB_FAIL_Y])
    .onStart((event) => scrubTo(event.x))
    .onUpdate((event) => scrubTo(event.x));

  // The caption describes the STORED series, not the subset that survived to be stroked: it
  // says what the device recorded and how often, and both halves have to be read off the same
  // array or they would describe two different things.
  const caption = [formatSampleCount(samples.length), formatSampleInterval(medianIntervalS(samples))]
    .filter((part): part is string => part !== null)
    .join(METADATA_SEPARATOR);

  // Start, midpoint, end of the domain above (spec §3) — `startS`, not `0`: the axis now
  // starts at the series' own first sample, so its start label has to read the same instant
  // the curve's own left edge does. `formatDuration` cannot fail for a finite positive span,
  // but it is nullable by contract and this app does not assert past a contract.
  const timeLabels = [startS, (startS + endS) / 2, endS]
    .map((seconds) => formatDuration(seconds / 60))
    .filter((label): label is string => label !== null);

  return (
    <View style={styles.profileCard}>
      <View style={styles.profileHeader}>
        <Text style={styles.profileTitle}>{t('group.profile')}</Text>
        {/* `numberOfLines={1}` for the reason the readout below already carries it, and the
            review found it missing here: `profileMeta` shrinks, and a `Text` that shrinks with
            nowhere left to grow wraps rather than truncates. On a narrow phone in Czech,
            `Hloubkový profil` beside `222 vzorků · 120 s` did exactly that — a two-line caption
            growing this baseline-aligned header and pushing the whole plot down. */}
        <Text style={styles.profileMeta} numberOfLines={1}>{caption}</Text>
      </View>
      {/* §5's readout, above the plot rather than under the finger. Always both figures, always
          real data or the dash — and the row's own style is what keeps a changing figure from
          moving its neighbour. */}
      <View style={styles.profileReadout}>
        <View style={styles.profileReadoutFigure}>
          <Text style={styles.profileReadoutLabel} numberOfLines={1}>{t('profile.depth')}</Text>
          <Text style={styles.profileReadoutValue} numberOfLines={1}>{readingDepth}</Text>
        </View>
        <View style={styles.profileReadoutFigure}>
          <Text style={styles.profileReadoutLabel} numberOfLines={1}>{t('profile.gas')}</Text>
          <Text style={styles.profileReadoutValue} numberOfLines={1}>{readingGas}</Text>
        </View>
      </View>
      <View style={styles.profilePlotRow}>
        <View style={styles.profileDepthAxis}>
          {/* `formatDepthBoundary`, not `formatDepth`: a gridline is a whole number of metres
              by construction, and "0.0 m" beside "10.0 m" would claim a decimetre of
              significance an axis tick has never had — that formatter's own argument, one
              figure over. In imperial the ticks are still the stored 10 m steps, converted,
              so the labels read 0/33/66/98 ft: honest, and the same thing the first-run depth
              legend does with §0.1's own band boundaries. */}
          {axis.ticks.map((tick) => (
            <Text key={tick} style={styles.profileAxisLabel}>
              {formatDepthBoundary(tick, units)}
            </Text>
          ))}
        </View>
        {/* The pan is attached to the SAME view whose width is measured, and it has to be: a
            touch's `x` arrives relative to the view the detector wraps, so mapping it through
            any other box's width would be wrong by exactly the difference. That view is the
            plot column — `PROFILE_PLOT_HEIGHT` of drawing plus the time axis under it, so more
            than 140 pt tall, and the full width of what the card has left. §0.5's 48 pt floor
            is not in question either way. */}
        <GestureDetector gesture={scrub}>
          <View
            style={styles.profilePlot}
            testID={PROFILE_PLOT_TEST_ID}
            onLayout={(event) => setPlotWidth(event.nativeEvent.layout.width)}
          >
            <Svg
              width="100%"
              height={PROFILE_PLOT_HEIGHT}
              viewBox={`0 0 ${PLOT_WIDTH} ${PROFILE_PLOT_HEIGHT}`}
              // The drawing fills the column rather than letterboxing inside it. Nothing is
              // distorted by that: every stroke below is `non-scaling-stroke`, and the one
              // shape a horizontal-only scale could stretch is the mark, which narrows itself
              // by that scale (`markRx`) — on a phone, where it is about 1, and on the wide
              // layout's iPad column, where it is not (see `PLOT_WIDTH`).
              preserveAspectRatio="none"
            >
              {axis.ticks.map((tick) => (
                <Line
                  key={tick}
                  x1={0}
                  y1={yDepth(tick)}
                  x2={PLOT_WIDTH}
                  y2={yDepth(tick)}
                  stroke={theme.border}
                  strokeWidth={GRID_STROKE_WIDTH}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {gasDrawn.length > 0 && (
                <Path
                  d={multiPathOf(
                    gas.map((segment) => segment.map((point) => ({ x: x(point.t), y: yGas(point.v) }))),
                  )}
                  stroke={theme.fgMuted}
                  strokeWidth={GAS_STROKE_WIDTH}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {runs.map((run, index) => (
                <Path
                  key={index}
                  d={pathOf(run.points.map((point) => ({ x: x(point.t), y: yDepth(point.v) })))}
                  stroke={run.colour}
                  strokeWidth={PROFILE_DEPTH_STROKE_WIDTH}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {/* Only once a finger has been on the plot: before that there is no touch point to
                  mark, and the mark below already says what the readout is describing. */}
              {scrubbedSample !== undefined && (
                <Line
                  x1={hairlineX}
                  y1={0}
                  x2={hairlineX}
                  y2={PROFILE_PLOT_HEIGHT}
                  stroke={theme.fg}
                  strokeWidth={HAIRLINE_STROKE_WIDTH}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* An `Ellipse` rather than a `Circle`, and it is drawn round: `rx` counteracts
                  the column's own horizontal stretch (see `markRx`) while `ry` stays the
                  radius, so the mark is a dot at every width this card is laid out at rather
                  than only at the one its viewBox is written for. */}
              <Ellipse
                cx={x(deepest.t)}
                cy={yDepth(deepest.v)}
                rx={markRx}
                ry={PROFILE_DEEPEST_MARK_RADIUS}
                fill={depthColor(deepest.v, scheme)}
              />
            </Svg>
            <View style={styles.profileTimeAxis}>
              {timeLabels.map((label, index) => (
                <Text key={index} style={styles.profileAxisLabel}>
                  {label}
                </Text>
              ))}
            </View>
          </View>
        </GestureDetector>
        {/* The consumption axis, stated once at its top: the value the trace's own ceiling
            stands for, with the unit that says what the second series is. It runs to zero at
            the plot's floor, which the trace itself shows. Absent with the trace. */}
        {gasDrawn.length > 0 && (
          <Text style={styles.profileGasAxisLabel}>{formatRmv(gasMax, units)}</Text>
        )}
      </View>
    </View>
  );
}

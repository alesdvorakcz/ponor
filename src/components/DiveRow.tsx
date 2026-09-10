import { memo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { isSparkDrawable, type ProfilePoint } from '../domain/profile';
import { type Dive } from '../domain/types';
import { t, useT } from '../i18n';
import {
  diveSiteLabel,
  formatDepth,
  formatDiveDate,
  formatDuration,
  formatTimeRange,
  METADATA_SEPARATOR,
} from '../format/display';
import { type UnitSystem } from '../format/units';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { DepthValue } from './DepthValue';
// The drawn rating (§0.6), which this row used to own outright. It moved to its own module
// in M1h when the dive form grew an editable rating: the form needs each dot inside its own
// 48 dp target, so it cannot render this row's `RatingDots` — but a second `●●●○○` written
// there would be §4.1's defining defect, one rule in two places, on the exact rule §0.6
// bothered to specify. `RatingDot` is the shared unit; `RATING_MAX` and `filledDotCount`
// are the shared arithmetic.
import { RatingDots } from './RatingDots';
// Task 6's row sparkline. `ProfileSparkline` is the one owner of "does this series draw a
// shape at all" (too short, or none) and of hiding itself from a screen reader — this row
// decides only WHERE the shape goes, never whether one is drawn.
import { ProfileSparkline } from './ProfileSparkline';

interface DiveRowProps {
  dive: Dive;
  /** Chronological dive number, or `undefined` for a planned dive (§2.4: no number until completed). */
  number: number | undefined;
  scheme: ColorScheme;
  /**
   * The diver's unit system (§3), for the depth this row shows **and for the accessibility
   * label that speaks it**. Both, always: the label is composed from `formatDepth`'s own
   * output rather than from a second reading of the same field, so a screen reader can
   * never announce a depth in metres beside a screen showing feet.
   */
  units: UnitSystem;
  onPress: (id: string) => void;
  /**
   * Overrides the depth value's own slot at the row's trailing edge, in place of
   * rendering `<DepthValue />` there — the seam ReorderControls uses (M1c task 6,
   * DESIGN.md §0.6) to put its arrows exactly where the depth value normally sits, so
   * entering hand-ordering mode does not change the row's height. `undefined` (every
   * caller but ReorderControls) renders `<DepthValue />` exactly as this row always has;
   * this stays optional so it defaults to that unchanged behaviour rather than asking
   * every other call site to pass it. Kept on `DiveRow` itself, rather than duplicated as
   * a second copy of this row's number/site/metadata layout inside ReorderControls —
   * this rendering has exactly one owner, the same reasoning `DepthValue`'s own docblock
   * already gives for why colour lives there and nowhere else.
   */
  depthSlot?: ReactNode;
  /**
   * **Whether something above this row already states the day** (M3n). Default `false` — the
   * row states its own date — because that is true of every caller but one.
   *
   * This row used to withhold a logged dive's date outright, keyed on status, for a reason
   * that belongs to a single screen: `DivesScreen` puts a `TripHeader` above its rows
   * ("BLUE HOLE · 16–18 Aug 2026"), so a date on each row beneath is the same fact twice. But
   * `SearchScreen`, the map's site sheet, `DiveSiteScreen` and `DiveCenterScreen` render this
   * component with no such header, and inherited the silence: searching a site dived twice
   * returned two identical rows differing only by number and time of day, with the one fact
   * that tells them apart missing from the screen entirely.
   *
   * So the assumption became a prop, and the DEFAULT is the safe answer rather than the
   * convenient one — a caller that says nothing gets a date, and the next screen to reuse this
   * row cannot inherit the fault by omission. `DivesScreen` is the only caller that passes it.
   */
  datedByContext?: boolean;
  /**
   * **The dive's recorded depth profile, already downsampled to its sparkline points** (Task
   * 6, spec §6) — `useDiveSampleShapes()`'s map, threaded exactly as `number` already is: a
   * screen reads `numbers.get(dive.id)` for one prop and `shapes.get(dive.id)` for this one,
   * and both simply come back `undefined` for the (still ordinary) case of a dive nothing was
   * ever imported for.
   *
   * **Points, not raw samples.** `toDiveSampleShapes` (db/diveSamples.ts) downsamples once per
   * query run instead of `ProfileSparkline` (below) calling `sparklinePoints` on a ~250-sample
   * series itself, per row, on every render — that function's own docblock has the reasoning,
   * and, since a later review, the one thing that move does not fix (the raw series stays
   * resident regardless, for a reason that belongs to `useDiveSampleShapes`, not to this prop).
   * This row still decides nothing about how a shape is drawn, or draws one itself — it asks
   * `isSparkDrawable` (domain/profile.ts), the identical test `ProfileSparkline` draws by, only
   * to decide whether reserving a bottom row for one is worth it at all (`showBottomRow`
   * below). Otherwise it hands the prop on unchanged (`?? null`, since `ProfileSparkline`'s own
   * "no series" spelling is `null`, matching `DepthProfile`'s and `useDiveSamples`', not
   * `undefined`).
   *
   * Optional, unlike `number`: every screen this row already had before Task 6 renders it with
   * no opinion about a series at all, and making this required would have turned every one of
   * those pre-existing renders into a type error for a prop they have nothing to pass.
   */
  points?: ProfilePoint[];
}

/**
 * Review task 7, Important #4: a screen reader announces a `Pressable`'s child text nodes
 * as disconnected fragments unless something ties them into one sentence — `Pressable`
 * does not supply `accessibilityRole` on its own, and this row's number/site/depth sit in
 * three separate `Text` nodes. Composed from the same pieces the row renders, in the same
 * order, omitting whichever one the row itself omits: no number for a planned dive (§2.4),
 * no depth for a dive that never recorded one (§1 — no form-shaming), no planned date for a
 * logged dive (its trip header already states the day — see `plannedDate` below). Time,
 * duration and rating are left out on purpose — they're the row's secondary chips, not what
 * a diver needs to pick the right dive out of a list.
 *
 * `plannedDate` (M1c closing fixes, Minor carried from task 3's review): task 3 put a
 * planned dive's date on screen ("Up next" pins planned dives "with their date", §3) but
 * never added it here, so two planned dives at the same site on different dates announced
 * identically to a screen reader even though the two rows read differently. Placed last,
 * after depth — matching where it sits on screen, the metadata line's own leading chip,
 * below the number/site/depth line the first three pieces come from.
 */
function accessibilityLabelFor(
  number: number | undefined,
  site: string,
  depth: string | null,
  dateChip: string | null,
): string {
  return [number !== undefined ? t('dives.diveNumber', { number }) : null, site, depth, dateChip]
    .filter((part): part is string => part !== null)
    .join(', ');
}

/**
 * One row of the dive list (§3: "row = number, site, depth · time chips, rating").
 *
 * Every field but `dive.date` may be null, and a dive with nothing else set is
 * legitimate (§6) — every optional piece below is omitted outright rather than
 * rendered as a placeholder, so a logged row degrades to just a number and a
 * site, and a planned one to `planned`, a site, and its date (§3 — see
 * `plannedDate` below).
 *
 * **A sparkline, beside the metadata, for the one case §0.4 always meant to allow**: a dive
 * that carries a real recorded sample series (`points`, Task 6) gets a small monochrome shape
 * of it there; every other dive — still almost all of them — gets exactly the row this always
 * drew. Nothing here decides that for itself: `ProfileSparkline` is the one owner of "does
 * this series draw a shape at all", so this row cannot invent one from data that was never
 * measured, which is the promise §0.4 always made.
 *
 * This is the only route into a dive (DivesScreen.tsx renders nothing else that opens
 * one), so it carries `accessibilityRole="button"` and a composed `accessibilityLabel`
 * (see `accessibilityLabelFor` above) rather than relying on `Pressable`'s default.
 */
function DiveRowComponent({
  dive,
  number,
  scheme,
  units,
  onPress,
  depthSlot,
  datedByContext = false,
  points,
}: DiveRowProps) {
  // **This component is `memo`'d, which is why the subscription matters here more than
  // anywhere else** (src/i18n). Its words come from `format/display.ts` and from `t` below,
  // neither of which is a prop, so without a hook of its own a row would keep drawing the old
  // language until one of its props happened to change. `scheme` and `units` stay props for
  // the reason they always were: a caller may legitimately want either, and a test wants to
  // render both.
  useT();
  const styles = makeStyles(scheme);
  // `diveSiteLabel` (format/display.ts), never an inline `siteName ?? centerName ?? ...`
  // here: this row and the dive's own detail hero must call a dive the same thing, and the
  // one time they each owned the rule they drifted — the row said "Unnamed site" where the
  // detail screen showed no heading at all.
  const site = diveSiteLabel(dive);
  const depth = formatDepth(dive.maxDepthM, units);
  const timeRange = formatTimeRange(dive.timeIn, dive.durationMin);
  const duration = formatDuration(dive.durationMin);
  // **When a dive happened, shown unless something above the row already said so** (M3n —
  // see `datedByContext`, which is the whole of that condition).
  //
  // This used to read `dive.status === 'planned'`, and the status was standing in for a fact
  // about the SCREEN: §3 pins planned dives under "Up next" "with their date", while a logged
  // dive sat under a trip header that stated the day. Both halves were true on `DivesScreen`
  // and the second was false everywhere else this row is rendered, so four screens showed a
  // dive with no date at all — most visibly search, where two results at one site are told
  // apart by nothing else.
  //
  // `dive.date` is required (never null, §6), so this is never itself the reason a row renders
  // with no metadata line at all.
  const dateChip = datedByContext ? null : formatDiveDate(dive.date);
  // M1c closing fixes, Important #4: DESIGN.md §0.6 specifies this line as "Time · duration
  // · rating, middot-separated" — the same joined form `heroSubline` (DiveDetailScreen.tsx)
  // already uses for its own number/date/centre sub-line — but the row used to space its
  // chips with a bare flex `gap` and render no middot at all. `metaText` is every text-only
  // chip this row can carry (plannedDate, timeRange, duration — mutually exclusive per the
  // comment above, but joined generically regardless) filtered and joined the same way
  // `heroSubline`/`accessibilityLabelFor` already do, so the separator can never appear
  // beside a chip that isn't actually there. `dive.rating` stays out of this join: §0.6
  // draws rating as circles, not text (task 7's `RatingDots`), so it is added as a fourth,
  // separately middot-joined element below rather than folded into one string.
  const metaText = [dateChip, timeRange, duration].filter((part): part is string => part !== null).join(METADATA_SEPARATOR);
  const hasMetaText = metaText !== '';
  const hasMeta = hasMetaText || dive.rating !== null;
  // Task 6: the bottom row is where the sparkline lives too, so a dive whose ONLY metadata is
  // a real sample series still gets a row to put it in — `isSparkDrawable(points)` on top of
  // `hasMeta` rather than folded into it, since `hasMeta`'s own name and every existing reader
  // of it are about the text/rating chips specifically. In practice this rarely changes
  // anything: every dive that carries a series was imported from a dive computer, and every
  // importer in this app fills in `timeIn` from the device's own log, which already makes
  // `hasMeta` true on its own (`DiveRow.test.tsx`'s "still shows the sparkline..." test pins
  // the one case it does change — a series with no other metadata at all).
  //
  // **Asks `isSparkDrawable` (domain/profile.ts) rather than testing `points !== undefined`.**
  // A review found that presence check safe for all six of today's callers — every one passes
  // `shapes.get(id)`, and `toDiveSampleShapes` already filters to series with a drawable point
  // — but not safe for the prop itself, which is public: a caller handing this row a one-point
  // array directly, bypassing that map entirely, would still reserve an empty bottom row —
  // `diveRowBottom`, and the `gap: 6` `diveRow` spends reaching it — for a shape that could
  // never draw. `isSparkDrawable` is the exact question `ProfileSparkline` itself asks
  // before drawing, so this can never reserve a row `ProfileSparkline` then leaves empty, nor
  // the reverse (`DiveRow.test.tsx`'s "reserves no bottom row..." test pins the case that
  // mattered: no OTHER metadata, and a points array too short to draw).
  const showBottomRow = hasMeta || isSparkDrawable(points);

  return (
    <Pressable
      style={styles.diveRow}
      onPress={() => onPress(dive.id)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelFor(number, site, depth, dateChip)}
    >
      <View style={styles.diveRowTop}>
        <View style={styles.diveRowMain}>
          {/* Always rendered, never conditioned on `number !== undefined` alone: a planned
              dive has no number to show, but the label slot above the site name should say
              so rather than sit empty (§2.4 — no number until completed). */}
          <Text style={styles.diveNumber}>
            {number !== undefined ? `#${number}` : t('dives.planned')}
          </Text>
          <Text style={styles.diveSite} numberOfLines={2}>
            {site}
          </Text>
        </View>
        {depthSlot !== undefined ? depthSlot : <DepthValue metres={dive.maxDepthM} scheme={scheme} units={units} />}
      </View>
      {showBottomRow && (
        <View style={styles.diveRowBottom}>
          {hasMetaText && <Text style={styles.diveChip}>{metaText}</Text>}
          {/* The one separator `.join(METADATA_SEPARATOR)` above can't supply: RatingDots is a row of
              drawn circles (§0.6: "drawn, not typed", task 7), not a string, so it can't
              join into `metaText` the way the three text chips do. Rendered only when both
              sides actually exist, so the line never opens or closes on a stray middot. */}
          {hasMetaText && dive.rating !== null && <Text style={styles.diveChip}>{METADATA_SEPARATOR}</Text>}
          {dive.rating !== null && <RatingDots rating={dive.rating} scheme={scheme} />}
          {/* Task 6: `undefined` (no screen has this dive's series, which is most dives) becomes
              `null`, `ProfileSparkline`'s own "nothing to draw" spelling — the same conversion
              `DepthProfile`'s own caller (`useDiveSamples`) never has to make, because that hook
              already answers in `null`. A `Map.get` does not. */}
          <ProfileSparkline points={points ?? null} scheme={scheme} />
        </View>
      )}
    </Pressable>
  );
}

// makeStyles(scheme) hands back the same object by reference per scheme (styles.ts) so
// that memoisation here is worth something — a fresh sheet every render would make
// `styles` a new prop identity each time and defeat this on every row of a long list.
export const DiveRow = memo(DiveRowComponent);

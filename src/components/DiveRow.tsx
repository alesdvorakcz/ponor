import { memo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { type Dive } from '../domain/types';
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
  plannedDate: string | null,
): string {
  return [number !== undefined ? `Dive ${number}` : null, site, depth, plannedDate]
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
 * No sparkline, bar, or any other graphic (§0.4): no dive in this version carries a
 * real sample series, and an invented shape would read as recorded data.
 *
 * This is the only route into a dive (DivesScreen.tsx renders nothing else that opens
 * one), so it carries `accessibilityRole="button"` and a composed `accessibilityLabel`
 * (see `accessibilityLabelFor` above) rather than relying on `Pressable`'s default.
 */
function DiveRowComponent({ dive, number, scheme, units, onPress, depthSlot }: DiveRowProps) {
  const styles = makeStyles(scheme);
  // `diveSiteLabel` (format/display.ts), never an inline `siteName ?? centerName ?? ...`
  // here: this row and the dive's own detail hero must call a dive the same thing, and the
  // one time they each owned the rule they drifted — the row said "Unnamed site" where the
  // detail screen showed no heading at all.
  const site = diveSiteLabel(dive);
  const depth = formatDepth(dive.maxDepthM, units);
  const timeRange = formatTimeRange(dive.timeIn, dive.durationMin);
  const duration = formatDuration(dive.durationMin);
  // §3: "Up next" pins planned dives "with their date" — the one fact that section exists
  // to show. Scoped to `status === 'planned'` rather than to `number === undefined` (the
  // two happen to coincide, per diveNumber.ts's `assignDiveNumbers`, which numbers only
  // `status: 'logged'` dives) because it is the dive's status, not the presence of a
  // number, that decides whether the date belongs here. A logged dive never gets one: its
  // trip header (TripHeader.tsx) already states the day — "BLUE HOLE · 16–18 Aug 2026" —
  // so repeating it on every row beneath would be redundant noise in the common case.
  // `dive.date` is required (never null, §6), so this is never itself the reason a planned
  // row renders with no metadata line at all.
  const plannedDate = dive.status === 'planned' ? formatDiveDate(dive.date) : null;
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
  const metaText = [plannedDate, timeRange, duration].filter((part): part is string => part !== null).join(METADATA_SEPARATOR);
  const hasMetaText = metaText !== '';
  const hasMeta = hasMetaText || dive.rating !== null;

  return (
    <Pressable
      style={styles.diveRow}
      onPress={() => onPress(dive.id)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelFor(number, site, depth, plannedDate)}
    >
      <View style={styles.diveRowTop}>
        <View style={styles.diveRowMain}>
          {/* Always rendered, never conditioned on `number !== undefined` alone: a planned
              dive has no number to show, but the label slot above the site name should say
              so rather than sit empty (§2.4 — no number until completed). */}
          <Text style={styles.diveNumber}>{number !== undefined ? `#${number}` : 'planned'}</Text>
          <Text style={styles.diveSite} numberOfLines={2}>
            {site}
          </Text>
        </View>
        {depthSlot !== undefined ? depthSlot : <DepthValue metres={dive.maxDepthM} scheme={scheme} units={units} />}
      </View>
      {hasMeta && (
        <View style={styles.diveRowBottom}>
          {hasMetaText && <Text style={styles.diveChip}>{metaText}</Text>}
          {/* The one separator `.join(METADATA_SEPARATOR)` above can't supply: RatingDots is a row of
              drawn circles (§0.6: "drawn, not typed", task 7), not a string, so it can't
              join into `metaText` the way the three text chips do. Rendered only when both
              sides actually exist, so the line never opens or closes on a stray middot. */}
          {hasMetaText && dive.rating !== null && <Text style={styles.diveChip}>{METADATA_SEPARATOR}</Text>}
          {dive.rating !== null && <RatingDots rating={dive.rating} scheme={scheme} />}
        </View>
      )}
    </Pressable>
  );
}

// makeStyles(scheme) hands back the same object by reference per scheme (styles.ts) so
// that memoisation here is worth something — a fresh sheet every render would make
// `styles` a new prop identity each time and defeat this on every row of a long list.
export const DiveRow = memo(DiveRowComponent);

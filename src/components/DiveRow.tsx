import { memo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { type Dive } from '../domain/types';
import { formatDepth, formatDiveDate, formatDuration, formatTimeRange } from '../format/display';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { DepthValue } from './DepthValue';

interface DiveRowProps {
  dive: Dive;
  /** Chronological dive number, or `undefined` for a planned dive (§2.4: no number until completed). */
  number: number | undefined;
  scheme: ColorScheme;
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

const RATING_MAX = 5;
const RATING_FILLED = '●';
const RATING_EMPTY = '○';

/**
 * `rating` is `number | null` rather than `1|2|3|4|5` on purpose (DESIGN.md §10: no DB
 * CHECK constraint, so a future client's out-of-range value is a runtime reality this
 * type cannot rule out). Clamped and rounded here so that reality can never turn into a
 * negative `repeat()` count and crash a render.
 */
function ratingMarks(rating: number): string {
  const filled = Math.min(RATING_MAX, Math.max(0, Math.round(rating)));
  return RATING_FILLED.repeat(filled) + RATING_EMPTY.repeat(RATING_MAX - filled);
}

/**
 * Review task 7, Important #4: a screen reader announces a `Pressable`'s child text nodes
 * as disconnected fragments unless something ties them into one sentence — `Pressable`
 * does not supply `accessibilityRole` on its own, and this row's number/site/depth sit in
 * three separate `Text` nodes. Composed from the same three pieces the row renders, in the
 * same order, omitting whichever one the row itself omits: no number for a planned dive
 * (§2.4), no depth for a dive that never recorded one (§1 — no form-shaming). Time, duration
 * and rating are left out on purpose — they're the row's secondary chips, not what a diver
 * needs to pick the right dive out of a list.
 */
function accessibilityLabelFor(number: number | undefined, site: string, depth: string | null): string {
  return [number !== undefined ? `Dive ${number}` : null, site, depth]
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
function DiveRowComponent({ dive, number, scheme, onPress, depthSlot }: DiveRowProps) {
  const styles = makeStyles(scheme);
  const site = dive.siteName ?? dive.centerName ?? 'Unnamed site';
  const depth = formatDepth(dive.maxDepthM);
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
  const hasMeta = plannedDate !== null || timeRange !== null || duration !== null || dive.rating !== null;

  return (
    <Pressable
      style={styles.diveRow}
      onPress={() => onPress(dive.id)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelFor(number, site, depth)}
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
        {depthSlot !== undefined ? depthSlot : <DepthValue metres={dive.maxDepthM} scheme={scheme} />}
      </View>
      {hasMeta && (
        <View style={styles.diveRowBottom}>
          {/* Leads the line when present, ahead of the time/duration/rating chips a logged
              dive can also carry — see `plannedDate` above for why the two never coexist. */}
          {plannedDate !== null && <Text style={styles.diveChip}>{plannedDate}</Text>}
          {timeRange !== null && <Text style={styles.diveChip}>{timeRange}</Text>}
          {duration !== null && <Text style={styles.diveChip}>{duration}</Text>}
          {dive.rating !== null && <Text style={styles.diveRating}>{ratingMarks(dive.rating)}</Text>}
        </View>
      )}
    </Pressable>
  );
}

// makeStyles(scheme) hands back the same object by reference per scheme (styles.ts) so
// that memoisation here is worth something — a fresh sheet every render would make
// `styles` a new prop identity each time and defeat this on every row of a long list.
export const DiveRow = memo(DiveRowComponent);

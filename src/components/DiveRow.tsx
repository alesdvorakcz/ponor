import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { type Dive } from '../domain/types';
import { formatDepth, formatDuration, formatTimeRange } from '../format/display';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
import { DepthValue } from './DepthValue';

interface DiveRowProps {
  dive: Dive;
  /** Chronological dive number, or `undefined` for a planned dive (§2.4: no number until completed). */
  number: number | undefined;
  scheme: ColorScheme;
  onPress: (id: string) => void;
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
 * rendered as a placeholder, so that row degrades to just a number and a site.
 *
 * No sparkline, bar, or any other graphic (§0.4): no dive in this version carries a
 * real sample series, and an invented shape would read as recorded data.
 *
 * This is the only route into a dive (DivesScreen.tsx renders nothing else that opens
 * one), so it carries `accessibilityRole="button"` and a composed `accessibilityLabel`
 * (see `accessibilityLabelFor` above) rather than relying on `Pressable`'s default.
 */
function DiveRowComponent({ dive, number, scheme, onPress }: DiveRowProps) {
  const styles = makeStyles(scheme);
  const site = dive.siteName ?? dive.centerName ?? 'Unnamed site';
  const depth = formatDepth(dive.maxDepthM);
  const timeRange = formatTimeRange(dive.timeIn, dive.durationMin);
  const duration = formatDuration(dive.durationMin);
  const hasMeta = timeRange !== null || duration !== null || dive.rating !== null;

  return (
    <Pressable
      style={styles.diveRow}
      onPress={() => onPress(dive.id)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelFor(number, site, depth)}
    >
      <View style={styles.diveRowTop}>
        {number !== undefined && <Text style={styles.diveNumber}>{`#${number}`}</Text>}
        <Text style={styles.diveSite} numberOfLines={2}>
          {site}
        </Text>
        <DepthValue metres={dive.maxDepthM} scheme={scheme} />
      </View>
      {hasMeta && (
        <View style={styles.diveRowBottom}>
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

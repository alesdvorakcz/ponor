import { Text, View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface TripHeaderProps {
  /** The trip's place (`Trip.title` from domain/trips.ts), or `'Up next'` for
   * the planned-dives section DivesScreen.tsx pins above the trips. */
  title: string;
  /** `Trip.dateRange`, e.g. `'16 Aug 2026'` or `'16–18 Aug 2026'` — empty for
   * the "Up next" section, which has no single date range to show. */
  dateRange: string;
  scheme: ColorScheme;
}

/**
 * Sticky section header for the Dives list (DESIGN.md §3): a trip's place and
 * date range, or "Up next" on its own above the planned dives.
 *
 * `dateRange` renders only when non-empty. An empty pill would sit in the
 * slot where a real date range goes and read, at a glance, as a value that
 * failed to load rather than a section that genuinely has none — the same
 * reasoning `DepthValue` gives for omitting rather than placeholding.
 *
 * `title` has no line cap: DESIGN.md §0.5 — Czech runs 20–30% longer than
 * English, so a site name wraps to a second line rather than truncating.
 */
export function TripHeader({ title, dateRange, scheme }: TripHeaderProps) {
  const styles = makeStyles(scheme);
  return (
    <View style={styles.tripHeader}>
      <Text style={styles.tripTitle}>{title}</Text>
      {dateRange !== '' && <Text style={styles.tripDateRange}>{dateRange}</Text>}
    </View>
  );
}

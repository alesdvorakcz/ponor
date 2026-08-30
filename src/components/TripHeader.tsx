import { Text, View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface TripHeaderProps {
  /** The trip's place (`Trip.title` from domain/trips.ts), or `'Up next'` for
   * the planned-dives section DivesScreen.tsx pins above the trips. */
  title: string;
  /** Whatever fills the header's one trailing slot: a trip's `Trip.dateRange`
   * (`'16 Aug 2026'`, `'16–18 Aug 2026'`), or "Up next"'s own dive count
   * (`formatDiveCount`, format/display.ts). One slot with one treatment — the
   * variant below decides how the header reads, never what goes in here. Empty
   * omits it. */
  trailing: string;
  /** Which kind of section this heads. A discriminator, deliberately not
   * inferred from `title`: that string is a label, about to be translated
   * (i18next, en + cs), and a rule that read `title === 'Up next'` would
   * silently stop firing the day it becomes `'Další v pořadí'`. */
  variant: 'trip' | 'upNext';
  scheme: ColorScheme;
}

/**
 * Sticky section header for the Dives list (DESIGN.md §3): a logged trip's place and date
 * range, or "Up next" above the planned dives.
 *
 * The two are NOT the same object and no longer render as though they were. A trip is an
 * archive heading — everything under it already happened — so it keeps §0.6's "uppercase,
 * tracked, muted" formula. "Up next" is a forward-looking queue of unnumbered planned dives
 * (§2.4), so its title takes full `fg` ink: muted reads as filed away, full ink reads as
 * live. Ink versus muted ink is the whole difference, because colour is not an available
 * lever here (§0.1 — colour encodes depth and nothing else) and neither is a new shape.
 *
 * `trailing` renders only when non-empty. An empty slot would sit exactly where a real date
 * range goes and read, at a glance, as a value that failed to load rather than a section
 * that genuinely has none — the same reasoning `DepthValue` gives for omitting rather than
 * placeholding. That is what "Up next" used to show; it now has something true to put there,
 * so the slot is filled rather than the rule relaxed.
 *
 * `title` has no line cap: DESIGN.md §0.5 — Czech runs 20–30% longer than English, so a
 * site name wraps to a second line rather than truncating.
 */
export function TripHeader({ title, trailing, variant, scheme }: TripHeaderProps) {
  const styles = makeStyles(scheme);
  return (
    <View style={styles.tripHeader}>
      <Text style={variant === 'upNext' ? [styles.tripTitle, styles.tripTitleUpNext] : styles.tripTitle}>
        {title}
      </Text>
      {trailing !== '' && <Text style={styles.tripDateRange}>{trailing}</Text>}
    </View>
  );
}

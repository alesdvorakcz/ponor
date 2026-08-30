import { Pressable, Text, View } from 'react-native';

import { formatDiveDate } from '../format/display';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

interface DayStripProps {
  /** The one calendar date this strip is for — one `sameDateGroups` (domain/trips.ts)
   * entry, already proven `canReorder`. DivesScreen.tsx is the only caller, and only for
   * a date where that already holds; this component does not re-check it. */
  date: string;
  /** How many dives share `date` — always ≥ 2 in real use (`canReorder`'s own floor). */
  count: number;
  /** Whether `date` is the one day currently in hand-ordering mode. DivesScreen.tsx holds
   * this as a single `string | null` across the whole screen, so at most one strip is
   * ever `active` at a time. */
  active: boolean;
  scheme: ColorScheme;
  /** Toggles hand-ordering mode for `date` — DivesScreen.tsx flips its single active date
   * between `date` and `null`. Takes no argument: this component already knows which date
   * it is, and a caller juggling several strips only ever needs "the one I was pressed
   * on", which the closure it hands each strip already captures. */
  onToggle: () => void;
}

/**
 * States why one day's dives can be reordered by hand, and toggles that mode — DESIGN.md
 * §0.6: "Hand-ordering lives on a day strip, not a row." A trip can span several days
 * ("Blue Hole, 16–18 Aug" is three) but only one of them may qualify — every dive on it
 * carries no entry time, §2.5's own condition, owned by `canReorder` (domain/trips.ts) and
 * never restated here — so a control on the trip header would be ambiguous about which
 * day it meant. The day is the thing being reordered, so the affordance belongs to a day,
 * and DivesScreen.tsx renders one of these above each date group `canReorder` allows.
 *
 * The sentence — `18 Aug 2026 · 2 dives, no times` — is not decoration. Without it, a
 * diver who later fills in an entry time watches the control silently vanish (`canReorder`
 * turning false) with no way to know why; stating the rule up front is what makes that
 * later disappearance make sense instead of reading as a bug.
 *
 * Entering the mode must not change any row's height (this task's own main point — see
 * ReorderControls.tsx and DiveRow.tsx's `depthSlot`): this strip is a new row of its own,
 * sitting above the day's dives, rather than something that grows a row that already
 * exists.
 */
export function DayStrip({ date, count, active, scheme, onToggle }: DayStripProps) {
  const styles = makeStyles(scheme);
  const formattedDate = formatDiveDate(date);
  const diveWord = count === 1 ? 'dive' : 'dives';

  return (
    <View style={[styles.dayStrip, active && styles.dayStripActive]}>
      <Text style={styles.dayStripText}>
        {formattedDate} · {count} {diveWord}, no times
      </Text>
      <Pressable
        style={styles.dayStripAction}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={active ? `Done reordering ${formattedDate}` : `Reorder ${formattedDate}`}
      >
        {/* §0.6: "a bordered pill in tracked uppercase... small, quiet, unmistakably
            pressable" — nested inside the Pressable above rather than replacing it, so the
            48 dp touch target (`dayStripAction`'s own minHeight/minWidth) stays exactly as
            it was; this pill is only the smaller visual mark centred inside it. */}
        <View style={styles.dayStripActionPill}>
          <Text style={styles.dayStripActionLabel}>{active ? 'Done' : 'Reorder'}</Text>
        </View>
      </Pressable>
    </View>
  );
}

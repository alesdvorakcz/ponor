import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import {
  calendarDateToLocalDate,
  localDateToCalendarDate,
  localDateToTimeOfDay,
  normaliseTimeOfDay,
  timeOfDayToLocalDate,
} from '../domain/datetime';
import { formatDiveDate } from '../format/display';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

export interface DateTimeFieldProps {
  /** Wraps rather than truncates, same as `FormField`'s (DESIGN.md §0.5, Czech). */
  label: string;
  /**
   * The **stored string**, never a `Date`: `YYYY-MM-DD` for `mode="date"`, `HH:MM` for
   * `mode="time"`, and `''`/null for a field the diver has not recorded. DESIGN.md §10 is
   * explicit that the string form stays the one representation — "the domain, the database
   * and the sync protocol all speak the string form" — so the `Date` a picker deals in
   * exists only between this component and `domain/datetime.ts`, and never leaves either.
   */
  value: string | null;
  /** Always a string, and always `''` for "cleared" — the same contract `FormField.onChange`
   * carries, so `diveFormSchema.ts`'s `optionalText` turns an untouched field into `null`. */
  onChange: (value: string) => void;
  mode: 'date' | 'time';
  scheme: ColorScheme;
  /** What a field holding nothing at all reads as. Given even for a required field, whose
   * value should never be empty but whose control must still say something if it ever is —
   * an empty box reads as a control that failed to load rather than as an empty field. */
  placeholder?: string;
  /**
   * Fired with `''` when the diver taps the `×`, exactly as `FormField.onClear` is — see
   * that component for why the literal empty string and never a value derived from what the
   * field currently holds. Omitted for a required field, which then shows no `×` at all:
   * an affordance that clears a field the form will refuse to save without is worse than no
   * affordance.
   */
  onClear?: (value: string) => void;
  /**
   * `mode="time"` only: the dive's own `YYYY-MM-DD`, which is the day this time falls on.
   *
   * It decides what the picker OPENS on and nothing else — the stored value stays the
   * `HH:MM` string. Without it `timeOfDayToLocalDate` puts the time on today, and a
   * wall-clock time is not independent of its day: on a spring-forward date 02:30 does not
   * exist, so the seed normalises to 03:30 and confirming the picker unchanged rewrites the
   * dive's entry time by an hour (Android). Seeded from today, that hit any dive edited on
   * one of the two transition Sundays; seeded from the dive's own date it can only ever
   * affect a dive whose recorded time its own day genuinely did not have.
   *
   * Optional, and unread for `mode="date"`: a date picker is seeded from the value itself.
   */
  day?: string | null;
}

/**
 * 48 dp (§0.5) around the `×`, via `hitSlop` rather than a bigger visible box — the same
 * split `FormField`'s own `CLEAR_HIT_SLOP` documents, and the same numbers, because it is
 * the same chip in the same label row. Read that one for why the vertical slop needs
 * `formFieldHeader`'s `minHeight: 48` to be delivered at all, and why the horizontal slop
 * reaches inward only: a chip at the header's trailing edge has no ancestor to its right,
 * so slop spent there is spent on nothing. The 21 dp to the left lands over the field's own
 * label, which is not a control, and brings this `×` to 48 dp wide.
 */
const CLEAR_HIT_SLOP = { top: 14, bottom: 14, left: 21, right: 0 };

/**
 * A form row whose value comes from the platform's own date/time picker instead of the
 * keyboard (DESIGN.md §10, M1d: "Date and time are pickers, so an invalid value cannot be
 * entered"). The owner's call, and it resolves a real tension rather than splitting it:
 * `date` carried this form's only blocking rule, so a mistyped date was the one thing that
 * could refuse a save — squarely against §1 — and a control that cannot produce `31.8.2026`
 * removes the case instead of adjudicating it. `timeIn` gets the same treatment for the
 * quieter version of the same defect: a typo there does not block the save, it silently
 * drops the dive out of time-ordering and voids its surface interval.
 *
 * **The stored value is the string, start to finish.** The `Date` the picker hands back is
 * converted by `domain/datetime.ts` — the single owner of the `YYYY-MM-DD` / `HH:MM` forms
 * (§10) — and specifically NOT by `toISOString()`, which is UTC and would file a dive
 * picked late on the 31st under the 30th east of Greenwich. Nothing in this file builds or
 * parses either string itself; it only calls that module.
 *
 * **The trigger is ours; the picker is the OS's.** On iOS the native `compact` display is
 * itself a small tappable control, and it is 34 pt tall with no way to enlarge its hit
 * area — under §0.5's "tap targets never below 48 dp, wet hands, one thumb" that is not a
 * control this app may ship, and it would also draw the value in the OS's own format rather
 * than through `formatDiveDate`, this codebase's single owner of diver-facing date text. So
 * the field itself is an ordinary 48 dp row that looks like every other field on the form,
 * and tapping it opens the platform picker: on iOS the `inline` calendar (the same view
 * `compact` expands to, reached in one tap instead of two) and the `spinner` clock, both
 * rendered under the field; on Android the platform's own modal dialogs.
 *
 * **No `minimumDate` and no `maximumDate`, deliberately.** §2.4 logs are half-written in
 * advance, so a dive's date is routinely in the future, and divers backfill decades of
 * paper logbooks, so it is routinely far in the past. A clamp to "today" would make
 * planning a dive impossible; there is no range to enforce here.
 */
export function DateTimeField({ label, value, onChange, mode, scheme, placeholder, onClear, day }: DateTimeFieldProps) {
  const styles = makeStyles(scheme);
  const [open, setOpen] = useState(false);

  const stored = value ?? '';
  // "Recorded" is about whether the field HOLDS something, not about whether this app can
  // read it — deliberately, and they are not the same question. A value that is real but
  // unreadable here (a hand-edited row, an M2 sync from a client spelling dates its own way)
  // is still a value the diver put somewhere, so it is shown as it stands, next to whatever
  // the schema has to say about it, rather than replaced by "not recorded" — which would be
  // this component quietly claiming a field is empty when it is not.
  const recorded = stored.trim() !== '';

  // What the diver reads. Neither branch formats anything here: a date goes through
  // `formatDiveDate` (format/display.ts owns turning a stored date into "31 Aug 2026"), and
  // a time through `normaliseTimeOfDay` (datetime.ts owns what a time string is), whose
  // canonical `HH:MM` already IS the diver-facing form — 24-hour, the way a dive slate and
  // every other time in this app reads. Both hand back an unreadable value unchanged rather
  // than inventing one, which is the same never-invent stance `formatDiveDate` documents.
  const displayText = recorded
    ? mode === 'date'
      ? formatDiveDate(stored)
      : (normaliseTimeOfDay(stored) ?? stored)
    : (placeholder ?? '');

  // Seeded with the stored value, or with now when there is none to read — never with an
  // invented value the field would then be showing without having stored it. A time is
  // seeded onto the DIVE's day (`day`), not onto today: see that prop for the hour a
  // spring-forward date used to cost.
  const picked =
    mode === 'date'
      ? calendarDateToLocalDate(stored)
      : timeOfDayToLocalDate(stored, calendarDateToLocalDate(day) ?? undefined);
  const seed = picked ?? new Date();

  const commit = (chosen: Date | undefined) => {
    const next = mode === 'date' ? localDateToCalendarDate(chosen) : localDateToTimeOfDay(chosen);
    // A picker that hands back nothing (dismissed, or an invalid `Date`) leaves the field
    // exactly as it was. It never writes `''` on the way out: clearing is the `×`, which is
    // a different gesture with a different meaning, and closing a picker is not a request to
    // erase what was already recorded.
    if (next !== null) onChange(next);
    // iOS renders the picker inline, under the field, and the diver closes it by tapping the
    // field again — closing on the first change would pull a spinner out from under a thumb
    // still turning it, since `onValueChange` fires on every wheel movement. Android's is a
    // modal dialog that has already dismissed itself by the time this runs, so leaving it
    // mounted would leave a dead dialog in the tree.
    if (Platform.OS !== 'ios') setOpen(false);
  };

  return (
    <View style={styles.formField}>
      <View style={styles.formFieldHeader}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        {onClear !== undefined && recorded && (
          <Pressable
            style={styles.formFieldClear}
            // `''`, never a value derived from what this field currently holds — see
            // `FormField.onClear`'s own docblock, and DESIGN.md §10's coercion contract.
            onPress={() => onClear('')}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={CLEAR_HIT_SLOP}
          >
            <Text style={styles.formFieldClearLabel}>×</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        style={styles.formFieldPicker}
        onPress={() => setOpen((wasOpen) => !wasOpen)}
        accessibilityRole="button"
        // Same `label: value` shape `OptionChips` already uses on this form, so a screen
        // reader announces what the field currently holds rather than only what it is for.
        accessibilityLabel={`${label}: ${displayText}`}
        accessibilityState={{ expanded: open }}
      >
        <Text style={recorded ? styles.formFieldPickerText : styles.formFieldPickerTextUnset}>{displayText}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={seed}
          mode={mode}
          display={Platform.OS === 'ios' ? (mode === 'date' ? 'inline' : 'spinner') : 'default'}
          // `onValueChange`/`onDismiss`, not the single `onChange` this library deprecated in
          // v9 — that one warns on every render in dev and folds "chose a value" and
          // "dismissed without choosing" into one callback that has to re-read `event.type`.
          onValueChange={(_event, date) => commit(date)}
          onDismiss={() => setOpen(false)}
          // The one place OS chrome exposes colour to us. Both come from the tokens, never a
          // literal — §0.1 spends every hue in this app on depth, and iOS's default blue
          // accent inside a form would be a second thing colour means.
          textColor={styles.formFieldPickerInk.color}
          accentColor={styles.formFieldPickerAccent.color}
          themeVariant={scheme}
          // 24-hour, matching the `HH:MM` this app stores and every other time it prints.
          // Android only; iOS follows the device locale, which is what a diver there expects.
          is24Hour
          style={styles.formFieldPickerControl}
        />
      )}
    </View>
  );
}

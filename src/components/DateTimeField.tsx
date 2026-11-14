import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Keyboard, Platform, Pressable, Text, View } from 'react-native';

import {
  calendarDateToLocalDate,
  localDateToCalendarDate,
  localDateToTimeOfDay,
  normaliseTimeOfDay,
  timeOfDayToLocalDate,
} from '../domain/datetime';
import { formatDiveDate } from '../format/display';
import { t } from '../i18n';
import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';
// The one control that empties a form row (§4.1). This file used to draw its own chip and its
// own mono `×`, held to §0.5's floor by a `hitSlop` constant shared with the carried chip —
// two copies of one control, with the shared half being the only part that had been unified.
// Read `ClearFieldControl.tsx` for the whole account, including the part that is specifically
// about THIS row: the picker's own trigger sits immediately to the control's left, so a target
// that reached back over it would draw "clear the field" across "open the picker".
import { ClearFieldControl } from './ClearFieldControl';

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
    // **Whether choosing also closes is a question about the CONTROL, not about the
    // platform** (M3m, found by the owner using the form).
    //
    // Android's picker is a modal dialog that has already dismissed itself by the time this
    // runs, so leaving it mounted would leave a dead dialog in the tree. That half never
    // changed. What did is the iOS half, which used to be a flat "never close" and is really
    // two different controls with two different ways of being finished with:
    //
    // A **spinner** (`mode="time"`) is finished with by coming to rest, and `onValueChange`
    // fires on every wheel movement — so closing on the first one would pull the control out
    // from under a thumb still turning it. It stays up, and the row's own trigger closes it.
    //
    // A **calendar** (`mode="date"`) is finished with by one tap on one day: the choice is
    // complete the moment it arrives, so the pick IS the dismissal. Leaving it open cost the
    // owner a silently re-dated dive — he picked the 7th, reached for the field below, and
    // hit the 17th, because the calendar was still standing where that field had been.
    if (Platform.OS !== 'ios' || mode === 'date') setOpen(false);
  };

  return (
    // The same row every other field on this form is (§0.6, M1d design pass) — label
    // leading, value trailing, hairline on the top edge — with the picker itself in the slot
    // §0.6 gives a field's second line, "directly under the focused row."
    //
    // **`open` is this field's focus.** A picker field has no keyboard focus to read, and
    // being open is exactly the state a text field's focus marks: this is the row the diver is
    // working in. So it draws the same focus, from the same styles — since 2026-11-14 a card
    // around the row, with the picker below it on the ground the way a text field's
    // suggestions sit below its card — rather than the form having two ways of saying it.
    <View style={[styles.formField, open && styles.formFieldFocused]}>
      <View style={[styles.formFieldRow, styles.formFieldCard, open && styles.formFieldCardFocused]}>
        <Text style={styles.formFieldLabel}>{label}</Text>
        <Pressable
          style={styles.formFieldPicker}
          onPress={() =>
            setOpen((wasOpen) => {
              // **Opening a picker is the diver saying they have finished typing** (M3m), and
              // it became worth saying out loud when the dive form's root gained a
              // `KeyboardAvoidingView`: an open keyboard used to be drawn OVER this row's
              // picker, and now compresses the scroll it opens inside, so a calendar reached
              // from a focused number field was clipped at the third week.
              //
              // Dismissed here rather than by the form, because this row is the only thing
              // that knows a picker is about to be shown — and it holds on any layout, since
              // no field can see whether the screen above it lifts. Only on the way IN: the
              // keyboard is already gone by the time it closes, and asking again would be a
              // second call with nothing to answer.
              if (!wasOpen) Keyboard.dismiss();
              return !wasOpen;
            })
          }
          accessibilityRole="button"
          // Same `label: value` shape `OptionChips` already uses on this form, so a screen
          // reader announces what the field currently holds rather than only what it is for.
          accessibilityLabel={t('field.labelValue', { label, value: displayText })}
          accessibilityState={{ expanded: open }}
        >
          <Text style={recorded ? styles.formFieldPickerText : styles.formFieldPickerTextUnset}>{displayText}</Text>
        </Pressable>
        {onClear !== undefined && recorded && (
          <ClearFieldControl
            // `''`, never a value derived from what this field currently holds — see
            // `FormField.onClear`'s own docblock, and DESIGN.md §10's coercion contract.
            onPress={() => onClear('')}
            // No "carried" here, and the difference is real rather than a wording choice:
            // `timeIn` is fresh every dive (§2.1), so nothing on this row was ever inherited
            // — this control unsets an optional field, where `FormField`'s throws away a
            // value the previous dive supplied. Same control, two true sentences.
            //
            // **One ring, two appearance rules and two outcomes, and the second half is the
            // one a diver sees.** Here it is drawn whenever the field HOLDS something and
            // leaves nothing behind; on a carried row it is drawn only while the value is
            // still the previous dive's, and leaves `— cleared`. Both follow from the same
            // sentence rather than from two policies: the tag says *you threw away something
            // you inherited*, and there is nothing on this row to inherit — a `timeIn` a
            // diver never entered and one they unset are the same absence, where a carried
            // buddy discarded and a buddy never carried are not. The control is shared
            // because emptying a row is one gesture; the treatment around it belongs to
            // carry-over, and this row has none.
            accessibilityLabel={t('field.clear', { label })}
            scheme={scheme}
          />
        )}
      </View>
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

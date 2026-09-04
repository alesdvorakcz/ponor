import { Text, View } from 'react-native';

import { makeStyles } from '../theme/styles';
import { type ColorScheme } from '../theme/tokens';

/**
 * The line of text under a field that has something to say about its own value, or nothing
 * at all when it has not. Shared by every controlled field on the dive form and by §3's
 * cylinder-preset editor, rather than written out in each, so "a field speaks next to the
 * control it belongs to" is one rule in one place.
 *
 * **It lives here rather than inside `DiveFormScreen.tsx` for the reason `OptionChips`
 * does**: two screens now ask the same question, and §0.6's answer is a rule with a shipped
 * defect behind it — "**A field error is text, not a field.** Muted, trailing, under the row
 * it belongs to. Shipped once as a white rounded box the same height as an input, which read
 * as a second empty field rather than as a message." A second copy of that is free to become
 * the box again.
 *
 * It carries three different kinds of sentence, and the difference is worth stating because
 * the treatment is identical.
 *
 * **A refusal.** `date` is the one field on the dive form that can still stop a save, and
 * when it does `handleSubmit` refuses to call `onValid` for the WHOLE form. Before this
 * existed that refusal was completely silent: type `31.8.2026`, the Czech spelling of a real
 * date in an app that ships `cs`, tap Save, and nothing happened. Since M1d's pickers the
 * field can no longer *produce* an unreadable value, and it should never fire for anything a
 * diver does there; it stays because the schema is the domain's guarantee rather than one
 * form's, and carry-over prefills that form from rows M2 sync delivered. The preset editor's
 * own refusals — an empty name, a name another preset already has, cylinders emptied to
 * nothing — take the same slot, next to the row each is about.
 *
 * **A note.** The fixed-choice fields no longer refuse anything at all (DESIGN.md §10,
 * settled after M1d: "a value outside the expected range is saved and can be flagged; it is
 * not refused"). A value from a newer client is kept and saved, and `unknownOptionNote`
 * (diveFormSchema.ts) says so here — where a refusal used to be a dead Save button and,
 * before that, silence. A second helper, `unknownBooleanNote`, said the same for a yes/no
 * field until M1h replaced `hood`/`gloves`/`boots` with the `equipment` token set and left
 * a dive with no boolean field at all.
 *
 * That sentence comes from `diveFormSchema.ts` rather than from a caller, for the same
 * reason: what a value means is that file's rule to state, and a copy at a screen would
 * drift the first time the rule changed.
 *
 * **A report about something outside the form** (M2l). The dive form's GPS row asks the device
 * where it is, and a device can decline in four different ways — Location Services off, the
 * permission refused, no fix in time, a fix too rough to be a dive site. Each owes the diver a
 * different sentence and every one of them lands here, under the row it is about, because §1
 * forbids any of it reaching the save: a diver who cannot get a pin logs the dive without one.
 * The row is where it belongs for the reason above — it is a message, not a field — and the
 * treatment is identical to the two kinds already described, which is the point.
 */
export function FieldNote({ message, scheme }: { message: string | undefined; scheme: ColorScheme }) {
  const styles = makeStyles(scheme);
  if (message === undefined) return null;
  return (
    <View style={styles.formFieldError}>
      <Text style={styles.formFieldErrorText}>{message}</Text>
    </View>
  );
}

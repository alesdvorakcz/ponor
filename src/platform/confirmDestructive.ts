import { Alert } from 'react-native';

export interface DestructiveConfirmation {
  /** The question, in the dialog's own title slot. */
  title: string;
  /** What is about to happen, under the title. */
  body: string;
  /** The label on the button that goes through with it. */
  confirmLabel: string;
  /** The label on the button that backs out. */
  cancelLabel: string;
  /** Run only if the diver confirms. Never called otherwise. */
  onConfirm: () => void;
}

/**
 * **The one owner of "ask before something is destroyed."** Deleting a dive is the only
 * action in the app that removes anything, so today it has exactly one caller
 * (`DiveDetailScreen.tsx`); it is its own module anyway because *where the confirmation is
 * drawn* is a platform question and the screen must not have to know the answer.
 *
 * DESIGN.md §10, unchanged and the whole reason this shape exists: "**A destructive
 * confirmation is OS chrome; the app's own control stays muted.**" §0.1 reserves colour for
 * depth, which leaves the app nothing to make *Delete dive* look destructive — so the weight
 * goes into a dialog the app does not draw, whose danger signal comes from the platform the
 * same way the keyboard's colours do. That reasoning is about *chrome the app does not own*,
 * not about the specific `Alert` API, which is what lets it survive into a browser
 * (`confirmDestructive.web.ts`) with the rule intact.
 *
 * This file is the native half and it is the pre-existing call, moved and not rewritten:
 * the same `Alert.alert`, the same two buttons in the same order, the same `style:
 * 'cancel'` / `style: 'destructive'`. `DiveDetailScreen.test.tsx` still spies on
 * `Alert.alert` itself and reads the button list off that spy, which is the check that this
 * really is a move.
 */
export function confirmDestructive({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: DestructiveConfirmation): void {
  Alert.alert(title, body, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

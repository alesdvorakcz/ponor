import type {
  confirmDestructive as NativeConfirmDestructive,
  DestructiveConfirmation,
} from './confirmDestructive';

/**
 * The browser's destructive confirmation. Web only; Metro picks this file over
 * `confirmDestructive.ts` for `--platform web`, and Jest's platforms are iOS-only, so
 * nothing here reaches a device build or a test run.
 *
 * It exists because `react-native-web`'s `Alert` is literally `class Alert { static alert()
 * {} }` — an empty function. On the spike build, *Delete dive* registered its press, opened
 * no dialog, deleted nothing and reported nothing; the click machinery was fine, the dialog
 * simply did not exist. A browser has no equivalent of the OS alert sheet iOS draws.
 *
 * **`window.confirm` keeps DESIGN.md §10's reasoning rather than working around it.** The
 * rule there is not "use `Alert`" — it is that a destructive confirmation belongs to chrome
 * the app does not draw, so §0.1 never has to be broken to make the app's own control look
 * dangerous. `window.confirm` is exactly that chrome in a browser: drawn by the browser
 * outside the page, unstyleable, and unmistakably a system dialog rather than part of the
 * app. *Delete dive* therefore stays the same muted label it is on iOS, here as there.
 *
 * The alternative was an in-app modal, and it is worse on both counts §10 weighs. It would
 * be the app drawing the danger signal — with no colour available to draw it in — and it
 * would put a second, hand-built confirmation dialog in shared code for the one platform
 * that is explicitly *a testing target, not a supported platform* (§9).
 *
 * **What the browser does not give us:** button labels. `window.confirm` draws the
 * browser's own *OK* / *Cancel*, so `confirmLabel` and `cancelLabel` are accepted and
 * ignored here — the same delegation `DateTimeField.web.tsx` makes when it lets the browser
 * spell the date. The title and body are joined into the one string the dialog takes.
 *
 * **It fails closed.** A browser that suppresses dialogs (the "prevent this page from
 * creating additional dialogs" checkbox, or a sandboxed frame) makes `confirm` return
 * `false`, and a falsy answer deletes nothing. The failure mode is a delete that does not
 * happen, never one that happens unasked.
 */
export function confirmDestructive({ title, body, onConfirm }: DestructiveConfirmation): void {
  if (window.confirm(`${title}\n\n${body}`)) onConfirm();
}

type Assert<T extends true> = T;

/**
 * Type-level proof that the browser's confirmation is still substitutable for the native
 * one — the same device `WebDateTimeFieldMatchesNative` (DateTimeField.web.tsx) and
 * `TankFormFieldsMatchTank` (diveFormSchema.ts) use. `DiveDetailScreen` imports one name and
 * must not be able to tell which implementation it got.
 *
 * **What it catches:** this file narrowing the contract — its own options interface, or a
 * required field the native one leaves optional. **What it does not catch:** a field *added*
 * to `DestructiveConfirmation`, since both files read the same type, so a new field
 * type-checks in both and this file would simply ignore it. That is the same blind spot
 * `DateTimeField.web.tsx` records, and it is worth naming rather than implying coverage
 * that is not there.
 *
 * The import above is `import type`, so Babel erases it: TypeScript reads
 * `./confirmDestructive` as the native file (it does not apply Metro's platform
 * extensions), while the web bundle never resolves the specifier and cannot import itself.
 */
export type WebConfirmDestructiveMatchesNative = Assert<
  typeof confirmDestructive extends typeof NativeConfirmDestructive ? true : false
>;

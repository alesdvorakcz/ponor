import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * **Handing a file this app has just written to whatever the platform shares with** — the one
 * place that decides how, and what happens where it cannot (DESIGN.md §4.1, on
 * `openWebsite.ts`'s precedent: the rule about giving something to the outside world has an
 * owner, and it is the seam a screen's test mocks).
 *
 * §8's export has to *arrive somewhere*. On a phone that is the share sheet — Files, AirDrop,
 * Mail, the diver's cloud drive — and `expo-sharing` is how it is opened. The file itself goes
 * to the **cache** directory rather than to documents: the diver's copy is the one the share
 * sheet puts wherever they chose, and a second copy accumulating inside the app on every press
 * is storage this app took without being asked. The system reclaims a cache; it does not
 * reclaim documents.
 *
 * ── Where sharing is unavailable ──────────────────────────────────────────────────────────
 *
 * `isAvailableAsync()` is asked **first, before anything is written**, and a `false` answer
 * ends the attempt with `'unavailable'` rather than an error. This is not hypothetical: §9
 * keeps the browser a testing target, and there `expo-sharing` resolves to `navigator.share`,
 * which most desktop browsers do not have. Writing a file the platform has no way to hand over
 * would leave a diver looking at a control that did something invisible — the dead-control
 * shape §0.6 has recorded three times — so the caller is given a distinct outcome to say a
 * sentence about, and nothing is written at all.
 *
 * ── A failed write leaves nothing behind ──────────────────────────────────────────────────
 *
 * §1's rule for this milestone is that "a failed write must say so rather than producing a
 * truncated file", and **a partial export that looks complete is the worst outcome available
 * here** — worse than no export, because a diver keeps it and discards the original. So the
 * write is one call with the whole document already in hand, and a failure deletes whatever
 * reached the disk before the error reaches the caller. Nothing is shared that was not fully
 * written, because the share is the line after the write.
 *
 * The clean-up is deliberately **not** applied to a failed *share*. By then the file is whole
 * and correct, and on iOS the sheet's own consumer may still be reading it after `shareAsync`
 * settles — deleting it there would break an AirDrop to save a cache entry the system clears
 * anyway.
 */

/** How an attempt ended. `'unavailable'` is an answer, not a failure — see the docblock. */
export type ShareOutcome = 'shared' | 'unavailable';

/**
 * What each file this app shares is, told to the platform in the two vocabularies it asks in:
 * a Uniform Type Identifier on iOS and a MIME type on Android.
 *
 * Keyed by extension and stated here rather than left to the platform to guess, because the
 * guess is what decides whether Mail offers to attach the file and whether Files gives it the
 * right icon — and an unrecognised `.csv` arriving as `public.data` is a file a diver cannot
 * open from the sheet they just used to send it.
 */
const FILE_TYPES: Record<string, { readonly uti: string; readonly mimeType: string }> = {
  '.csv': { uti: 'public.comma-separated-values-text', mimeType: 'text/csv' },
  '.json': { uti: 'public.json', mimeType: 'application/json' },
};

/** The fallback for an extension nothing above names: plain text, which every platform can at
 * least carry. Not an error — refusing to share a file over its own suffix would be this
 * module deciding something it has no stake in. */
const PLAIN_TEXT = { uti: 'public.plain-text', mimeType: 'text/plain' };

/** Deletes a file, and never reports failing to. The only caller is the recovery path below,
 * where there is nothing further to do about it and the error worth raising is the one that
 * got us here. */
function discard(file: File): void {
  try {
    file.delete();
  } catch {
    // Either it was never created or it cannot be removed; neither changes what the caller is
    // told, which is why the write failed.
  }
}

/**
 * Writes `text` to a cache file called `name` and opens the platform's share sheet on it.
 *
 * Rejects when the file cannot be written or the sheet cannot be opened; resolves
 * `'unavailable'` when this platform has no sharing at all. `text` is written as UTF-8, which
 * is `expo-file-system`'s default and is what `format/csv.ts`'s byte-order mark is a mark for.
 */
export async function shareTextFile(name: string, text: string): Promise<ShareOutcome> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';

  const file = new File(Paths.cache, name);
  try {
    file.create({ overwrite: true, intermediates: true });
    file.write(text);
  } catch (error) {
    discard(file);
    throw error;
  }

  const type = FILE_TYPES[file.extension.toLowerCase()] ?? PLAIN_TEXT;
  await Sharing.shareAsync(file.uri, {
    UTI: type.uti,
    mimeType: type.mimeType,
    dialogTitle: name,
  });
  return 'shared';
}

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { type ImportFile } from '../db/importDives';

/**
 * **Where a file comes in from outside this app** — the mirror of `shareFile.ts`, which owns
 * files going out. `db/importDives.ts` decides what to do with the bytes; this file's only job
 * is producing them, for whichever files a diver hands over.
 *
 * ── The same three-state shape `shareFile.ts` uses, and for the same reason ───────────────
 *
 * `'cancelled'` and `'unavailable'` are answers, not failures — a screen that had to wrap this
 * call in a `try`/`catch` for a diver simply backing out of the picker would be handling an
 * exception for something ordinary, which is the shape `shareFile.ts`'s own docblock argues
 * against.
 *
 * **`'unavailable'` is reached differently here, because this library offers no
 * `isAvailableAsync` to ask first.** `expo-sharing` can be asked *before* doing anything; this
 * module cannot ask, only try — the single call that would show the picker is the only thing
 * there is to test, so failing it is how "there is no picker on this device" is told apart from
 * "the diver's own file is unreadable". That leaves one gap `shareFile.ts`'s check does not
 * have: a native module missing entirely fails at import time, before this function ever runs,
 * and no `try` inside it can catch that. Nothing short of a dynamic `import()` on every call
 * would close that gap, and this app has no other seam written that way — see Step 1's own
 * note that a rebuilt dev client is what this module actually depends on.
 *
 * ── What is deliberately left to reject ───────────────────────────────────────────────────
 *
 * A chosen file's bytes failing to read is **not** folded into `'unavailable'`. By that point
 * the picker worked and the diver made a choice; a read failing on a file the OS just copied
 * into this app's own cache directory is a genuine, unexpected failure, not an ordinary one —
 * `shareFile.ts` draws the identical line around a write that does not complete, and leaves it
 * to reject rather than reporting a named outcome for it.
 */
export type PickImportFilesOutcome = ImportFile[] | 'cancelled' | 'unavailable';

/**
 * Opens the system file picker for any number of files and reads each one's bytes.
 *
 * **No `type` filter.** `domain/import/registry.ts` recognises a format by its content, never
 * by name or MIME type — two of §9's formats already share the `.json` extension — so
 * narrowing this picker by type could hide a file this app can read.
 *
 * **`copyToCacheDirectory: true`** (the library's own default, named here rather than left
 * implicit) is what makes the plain `File(uri).bytes()` below reliable: without it, a uri
 * outside this app's sandbox — iCloud Drive, a content provider on Android — may need the kind
 * of access this app never otherwise asks for.
 */
export async function pickImportFiles(): Promise<PickImportFilesOutcome> {
  let result: DocumentPicker.DocumentPickerResult;
  try {
    result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  } catch {
    return 'unavailable';
  }
  if (result.canceled) return 'cancelled';

  return Promise.all(
    result.assets.map(async (asset): Promise<ImportFile> => ({
      name: asset.name,
      bytes: await new File(asset.uri).bytes(),
    })),
  );
}

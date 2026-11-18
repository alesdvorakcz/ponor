import { and, eq } from 'drizzle-orm';

import { importerFor } from '../domain/import/registry';
import { hasDiveSamplesRow, putDiveSamples } from './diveSamples';
import { createDive } from './dives';
import { dives } from './schema';
import { type Db } from './types';

export interface ImportFile {
  name: string;
  bytes: Uint8Array;
}

export interface ImportOutcome {
  /** Dives written. */
  imported: number;
  /** Dives already present under the same (source, id) and left untouched. */
  alreadyThere: number;
  /**
   * **Files**, not dives — a file that failed yielded none to count. Three reasons, and they
   * are three different sentences for the diver, not one failure with a footnote:
   *
   * - `unrecognised` — no importer claimed the file. The diver picked the wrong one: a
   *   fixable mistake.
   * - `unreadable` — an importer claimed the file and still could not read it. The file
   *   itself is damaged or malformed.
   * - `unwritable` — the file was read in full and the dives it held were fine; *saving* one
   *   to this device failed. Not folded into `unreadable`: that reason means the diver's
   *   file was the problem, and here it was not — this device's save was.
   */
  failed: { name: string; reason: 'unrecognised' | 'unreadable' | 'unwritable' }[];
}

/**
 * **Writes whatever an importer read, whichever importer read it.**
 *
 * Dedupe, completing a dive whose profile failed to save (#9) and counting live here and
 * nowhere else, so adding §9's UDDF or FIT touches `domain/import/` alone. Nothing in this file
 * knows what a Suunto file looks like.
 */
export async function importFiles(db: Db, files: readonly ImportFile[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: 0, alreadyThere: 0, failed: [] };

  for (const file of files) {
    const importer = importerFor(file.bytes);
    // Two sentences, because they are two different things for the diver: an unrecognised
    // file is a fixable mistake, a refused one is not.
    if (!importer) {
      outcome.failed.push({ name: file.name, reason: 'unrecognised' });
      continue;
    }

    let parsed;
    try {
      parsed = importer.parse(file.bytes);
    } catch {
      // ImportRefusal is expected; anything else is a bug in an importer, and either way it
      // must not take the batch down — DESIGN.md §7's "sync failures never block logging",
      // one door over.
      //
      // Deliberately silent, and deliberately not `console`: §9 wires Sentry in M3 and turns
      // console output into breadcrumbs, and `cloud/auth.ts` records why nothing in this app
      // writes one on a path a diver's own data travels — an imported file is exactly such a
      // path. `outcome.failed.push` below already carries the failure to the diver, which is
      // what "must not swallow the failure" actually requires.
      outcome.failed.push({ name: file.name, reason: 'unreadable' });
      continue;
    }

    let fileFailed = false;
    for (const { importId, dive, series } of parsed) {
      try {
        // **Skipped, never overwritten.** The file is immutable — a dive that happened in
        // February does not change — but the diver's copy does: they may have added the site, a
        // buddy or notes since. Re-running the same folder must not destroy that.
        //
        // The SELECT is **deliberately not scoped to live dives** — it finds a dive even if the
        // diver has since soft-deleted it. Deleting an imported dive *is* the diver's work; a
        // re-import that silently resurrected it would be the overwrite this skip exists to
        // prevent (and would contradict the import spec's §6, "the file is immutable, the
        // diver's copy is not").
        const [existing] = await db
          .select({ id: dives.id, deletedAt: dives.deletedAt })
          .from(dives)
          .where(and(eq(dives.importSource, importer.source), eq(dives.importId, importId)));
        if (existing) {
          // **The one thing a re-import still writes: a profile that failed to save** (#9).
          // `createDive` and `putDiveSamples` below are two writes, not one transaction —
          // Drizzle's transactions are synchronous on both drivers and these writers are not —
          // so a throw between them keeps the dive without its curve and names the file as
          // `unwritable`, whose sentence tells the diver to try again. This is what makes trying
          // again work. Only the profile is written, never the dive, so the skip above still
          // holds for everything the diver may have changed.
          //
          // Only for a live dive, and only when no series row exists at all. A deleted dive
          // stays deleted with nothing written behind it, and a tombstoned series is a deletion
          // §7 is carrying, which `putDiveSamples`' un-tombstoning would undo
          // (`hasDiveSamplesRow`). Counted as imported: the earlier run did not count this dive,
          // so this is the run that reports it.
          if (series && existing.deletedAt === null && !(await hasDiveSamplesRow(db, existing.id))) {
            await putDiveSamples(db, existing.id, series);
            outcome.imported += 1;
          } else {
            outcome.alreadyThere += 1;
          }
          continue;
        }

        // Per dive, not per batch: one malformed file must not roll back the fourteen before it.
        //
        // **This writer stamps `importSource` and `importId` itself, overriding whatever `dive`
        // carries**, rather than trusting an importer to have set them correctly (DESIGN.md
        // §4.1 — one owner per rule). `ImportedDive.dive`'s own type no longer even offers an
        // importer those two keys, but the override stays explicit here too: this is the one
        // line where a silent `undefined` on either key would otherwise reach `createDive` and,
        // through its own `withoutUndefinedFields`, become a `null` column — which the SELECT
        // two lines up can never match again, so every future re-import of that dive would
        // duplicate it rather than skip it.
        const written = await createDive(db, { ...dive, importSource: importer.source, importId });
        if (series) await putDiveSamples(db, written.id, series);
        outcome.imported += 1;
      } catch {
        // **A throw here is a save failure, not a read failure** — the file was parsed in
        // full; the SELECT, createDive or putDiveSamples that followed it did not complete (a
        // full disk, a SQLite error, a bug in one of them). The import spec's §6 promises the
        // batch never aborts on a failure, and that promise runs one dive deep, not one file
        // deep: a dive whose
        // write throws must not stop the dives beside it, in this file or the next — the same
        // "per dive, not per batch" reasoning just above, one level up.
        //
        // **Recorded once per file, not once per failing dive**, and the dives already written
        // are kept rather than rolled back. A file yielding five dives that fails writing the
        // third still names that one file, once, in `failed` — the diver sees "this file had a
        // problem" alongside the two real, saved dives that came before it. Undoing those to
        // make the file all-or-nothing would destroy work that already succeeded, to buy a
        // consistency no diver asked for and this app's own per-dive writes never promised.
        if (!fileFailed) {
          fileFailed = true;
          outcome.failed.push({ name: file.name, reason: 'unwritable' });
        }
      }
    }
  }

  return outcome;
}

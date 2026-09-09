import { and, eq } from 'drizzle-orm';

import { importerFor } from '../domain/import/registry';
import { ImportRefusal } from '../domain/import/types';
import { putDiveSamples } from './diveSamples';
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
  /** **Files**, not dives — a file that failed yielded none to count. */
  failed: { name: string; reason: 'unrecognised' | 'unreadable' }[];
}

/**
 * **Writes whatever an importer read, whichever importer read it.**
 *
 * Dedupe, transactions and counting live here and nowhere else, so adding §9's UDDF or FIT
 * touches `domain/import/` alone. Nothing in this file knows what a Suunto file looks like.
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
    } catch (error) {
      // ImportRefusal is expected; anything else is a bug in an importer and must still not
      // take the batch down — §1's "a failure never blocks the rest", one door over.
      outcome.failed.push({ name: file.name, reason: 'unreadable' });
      if (!(error instanceof ImportRefusal)) console.warn('importer threw', error);
      continue;
    }

    for (const { importId, dive, series } of parsed) {
      // **Skipped, never overwritten.** The file is immutable — a dive that happened in
      // February does not change — but the diver's copy does: they may have added the site, a
      // buddy or notes since. Re-running the same folder must not destroy that.
      const [existing] = await db
        .select({ id: dives.id })
        .from(dives)
        .where(and(eq(dives.importSource, importer.source), eq(dives.importId, importId)));
      if (existing) {
        outcome.alreadyThere += 1;
        continue;
      }

      // Per dive, not per batch: one malformed file must not roll back the fourteen before it.
      const written = await createDive(db, dive);
      if (series) await putDiveSamples(db, written.id, series);
      outcome.imported += 1;
    }
  }

  return outcome;
}

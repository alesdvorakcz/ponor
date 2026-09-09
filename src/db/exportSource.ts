import { isOwnCatalogueRow, type ExportSource } from '../domain/dataExport';
import { todayCalendarDate } from '../domain/datetime';
import { listDiveCenters, listDiveSites } from './catalogue';
import { listCertifications } from './certifications';
import { listDiveSamples } from './diveSamples';
import { listDives } from './dives';
import { listGearPresets } from './gearPresets';
import { divesBeforeQuery, readDivesBefore } from './settings';
import type { Db } from './types';

/**
 * **Everything §8's export is made of, read once** — the read half of M3i, where
 * `domain/dataExport.ts` is the deciding half.
 *
 * It is `cloud/localLogbook.ts`'s shape read backwards: that module is a *write* across every
 * repository in an order it owns, and this is a *read* across the same ones. Nothing here
 * selects a row itself. Every list below is the repository's own reader (§4.1), which is what
 * makes the export see exactly what the app sees — the tombstone filter on the private tables
 * and `pickable`'s active-and-live filter on the catalogue, applied here because they are
 * applied everywhere.
 *
 * ── One rejection loses the whole export, deliberately ────────────────────────────────────
 *
 * The seven reads go out together and **a single failure rejects all of them**. There is no
 * per-table `catch`, no "export what we could", and no partial result: a file that is missing
 * a diver's certifications but looks like a complete logbook is worse than no file at all,
 * because they keep it and throw away the original. §1's "never block" binds on the *logging*
 * path; an export that cannot be complete must say so instead.
 *
 * ── The three things this decides ─────────────────────────────────────────────────────────
 *
 * · **Which community rows are the diver's** — `isOwnCatalogueRow` (domain/dataExport.ts) owns
 *   the rule and this applies it. Everything else in `dive_sites` and `dive_centers` is
 *   everybody's.
 * · **What an unreadable `dives_before` means.** `readDivesBefore` rather than
 *   `getDivesBefore`, because that one *throws* on a stored value it cannot read — correct for
 *   a screen that can offer the diver a way to fix it, and wrong for an export, where it would
 *   turn one bad settings row into "you may not have a copy of your dives". The raw value goes
 *   through unchanged and `assignDiveNumbers` degrades it to an offset of 0, which is exactly
 *   what the dive list already shows for the same row.
 * · **When the export was taken** — the instant for the JSON's own header, and the diver's
 *   local calendar date (`todayCalendarDate`, §4.1's owner) for the two file names. Two
 *   values rather than one because slicing a date out of an ISO instant is UTC, and §4.1 bans
 *   exactly that outside `domain/datetime.ts`.
 *
 * **`diveSamples` rides beside `dives` rather than nested onto it** — `listDiveSamples`
 * (db/diveSamples.ts) is its own repository read, exactly like every table above, and
 * `domain/dataExport.ts`'s own docblock says why the shape stays a sibling collection rather
 * than a field grafted onto a `Dive` that has never had one. Filtered through the same
 * tombstone rule as everything else here: a dive the diver deleted took its profile with it
 * (`softDeleteDive` tombstones both), so this needs no extra join to keep the two in step.
 */
export async function readExportSource(db: Db, ownerId: string | null): Promise<ExportSource> {
  const [dives, diveSamples, gearPresets, certifications, diveSites, diveCenters, divesBeforeRows] =
    await Promise.all([
      listDives(db),
      listDiveSamples(db),
      listGearPresets(db),
      listCertifications(db),
      listDiveSites(db),
      listDiveCenters(db),
      divesBeforeQuery(db),
    ]);
  return {
    dives,
    diveSamples,
    gearPresets,
    certifications,
    diveSites: diveSites.filter((site) => isOwnCatalogueRow(site, ownerId)),
    diveCenters: diveCenters.filter((center) => isOwnCatalogueRow(center, ownerId)),
    divesBefore: readDivesBefore(divesBeforeRows),
    exportedAt: new Date().toISOString(),
    exportedOn: todayCalendarDate(),
  };
}

import { suuntoJsonImporter } from './suunto';
import { type DiveImporter } from './types';

/**
 * **Every format Ponor can read**, in the order they are tried.
 *
 * A plain array on purpose: no dynamic registration, no plugin loading. Adding §9's UDDF,
 * Subsurface, FIT or PADI is a new file beside this one and a new entry here — and, because
 * detection is by content, no UI change at all.
 */
export const IMPORTERS: readonly DiveImporter[] = [suuntoJsonImporter];

/**
 * **Which importer owns this file, decided by its contents.**
 *
 * Never by extension, and that is needed today rather than later: §9's PADI migration is also
 * JSON, so two formats will share `.json` and the file name cannot decide between them.
 */
export function importerFor(file: Uint8Array): DiveImporter | null {
  return IMPORTERS.find((importer) => importer.recognises(file)) ?? null;
}

/** The formats a diver is told Ponor understands — read off the registry, so a format added
 * without a label cannot leave the Settings caption quietly out of date. */
export function importerLabels(): string[] {
  return IMPORTERS.map((importer) => importer.label());
}

/**
 * **What to call the format a stored dive came from**, looked up by the `import_source` the
 * writer stamped on it (`db/importDives.ts`).
 *
 * The dive detail's `Imported from` row (spec §7) is the caller. It names the device where the
 * dive carries one and reads this where it does not — which is not a defensive fallback but the
 * permanent state of every dive imported before `import_device` existed: dedupe skips a dive
 * already held, so re-running the same files cannot backfill the column.
 *
 * `null` for a source nothing in the registry claims — a row written by a version of the app
 * that read a format this one does not, or a format since removed. The caller draws no row for
 * it, which is better than showing a diver the raw `suunto-app-json` they never chose to see.
 */
export function importerLabelFor(source: string): string | null {
  return IMPORTERS.find((importer) => importer.source === source)?.label() ?? null;
}

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

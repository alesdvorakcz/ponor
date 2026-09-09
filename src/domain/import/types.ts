import { type NewDiveInput } from '../../db/dives';
import { type DiveSample } from '../../db/schema';

/** One dive an importer read out of a file, in Ponor's own shape and units. */
export interface ImportedDive {
  /** Stable per source dive — see the Suunto importer for why it is normalised. */
  importId: string;
  /**
   * Everything else about the dive, in Ponor's own shape and units — **except**
   * `importSource` and `importId`, which are not this importer's to set.
   *
   * `db/importDives.ts` is the one writer, and it stamps both fields itself on every dive an
   * importer yields — `importSource` from `DiveImporter.source` below, `importId` from the
   * field right above — regardless of what `dive` carries. That is DESIGN.md §4.1, one owner
   * per rule, aimed at the exact failure it warns about: the Suunto importer used to set both
   * fields itself too, by a literal that merely happened to agree with `source`, tied to it
   * by nothing the compiler could check. An importer that copied that pattern and forgot one
   * field would hand the writer a dive whose dedupe column comes out `null` — the writer's
   * own SELECT can never match `null`, so every re-import of that file would duplicate the
   * dive it already has, silently and with no failing test. Omitting the keys from this type
   * is what makes that mistake impossible to make, rather than merely undocumented.
   */
  dive: Omit<NewDiveInput, 'importSource' | 'importId'>;
  /** `null` for a dive the source recorded without a profile. */
  series: DiveSample[] | null;
}

/**
 * **One file format Ponor can read.** The whole contract is *bytes → normalised dives*;
 * dedupe, transactions, counting and the UI are written once, downstream of this
 * (`db/importDives.ts`).
 *
 * **`Uint8Array`, not `string`.** Three of §9's four named formats are text, but FIT is binary
 * — its sniff is bytes 8–11 equal to `.FIT`. Taking bytes costs text importers one shared
 * decode and saves reshaping this contract when a binary format arrives.
 */
export interface DiveImporter {
  /** Written to `dives.import_source` by the writer (`db/importDives.ts`), and half of the
   * dedupe key — see `ImportedDive.dive`'s own docblock for why this importer never writes
   * the column itself. */
  readonly source: string;
  /** What a diver reads in the Settings caption. A function, not a constant: a constant's
   * value is fixed before any diver has chosen a language (see `unnamedSite`). */
  label(): string;
  /** A cheap look at the bytes. Must not throw, whatever it is handed. */
  recognises(file: Uint8Array): boolean;
  /** Throws `ImportRefusal` when the file is this format and still cannot be read. */
  parse(file: Uint8Array): ImportedDive[];
}

/**
 * **A file this importer owns and still cannot read.**
 *
 * Distinct from "no importer recognised it", and the two produce different sentences for the
 * diver: an unrecognised file is a fixable mistake (wrong file), where a refusal is not.
 */
export class ImportRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ImportRefusal';
  }
}

/** Decodes bytes as UTF-8 for the text formats. Returns `''` for bytes that are not text,
 * so a `recognises` built on substring matching answers `false` instead of throwing. */
export function decodeUtf8(file: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(file);
  } catch {
    return '';
  }
}

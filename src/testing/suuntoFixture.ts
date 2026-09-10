import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type DiveSample } from '../db/schema';
import { suuntoJsonImporter } from '../domain/import/suunto';
import { type ImportedDive } from '../domain/import/types';

/**
 * **The committed reference dive, run through the real importer** — the profile spec's plan
 * calls the series half of this `FIXTURE`. `DepthProfile.test.tsx` (which additionally builds
 * the `Dive` half around it, via its own `fixture()`), `ProfileSparkline.test.tsx` and
 * `DiveRow.test.tsx` all need exactly this parse.
 *
 * **Task 6 review, Finding 4: this used to be three separate copies of the same read-and-parse,
 * two of which carried a docblock claiming to be "reused by the same approach rather than a
 * second copy" — which is what a second copy is.** Extracted here so all three genuinely share
 * one implementation instead of three that happen to agree today.
 *
 * A hand-rolled series would miss the exact shapes the real file has — an event-only first
 * sample (no `Depth`, dropped by the importer, so the series starts at the second row), a
 * non-zero first offset (0.57 s, not 0), a header maximum deeper than any sample (24.33 m
 * against a deepest sample of 24.29 m) — and DESIGN.md's own testing facts forbid asserting a
 * number from memory of a fuller dive, so every one of these tests reads the committed,
 * trimmed five-sample fixture instead of a hand-built one.
 */
export function fixtureImportedDive(): ImportedDive {
  const bytes = new Uint8Array(
    readFileSync(join(__dirname, '..', 'domain', 'import', '__fixtures__', 'suunto-d5.json')),
  );
  const [imported] = suuntoJsonImporter.parse(bytes);
  if (!imported) throw new Error('suunto-d5 fixture yielded no dive');
  return imported;
}

/**
 * Just the series half of `fixtureImportedDive` — what `ProfileSparkline.test.tsx` and
 * `DiveRow.test.tsx` need, and what `DepthProfile.test.tsx`'s own `fixture()` (which also needs
 * the `Dive` half) builds its own `series` field from too, through the same parse rather than a
 * second one.
 */
export function fixtureSeries(): DiveSample[] {
  return fixtureImportedDive().series ?? [];
}

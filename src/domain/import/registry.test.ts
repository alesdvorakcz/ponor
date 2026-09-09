// src/domain/import/registry.test.ts
import { importerFor, importerLabels, IMPORTERS } from './registry';

const bytesOf = (text: string) => new TextEncoder().encode(text);

// The case that matters most for this seam — that a real dive-computer export is recognised
// by its *content*, never by its file name — has no importer to prove it against yet. Task 5
// adds `suuntoJsonImporter`; that test belongs beside it, not stubbed here against an importer
// that does not exist (see the controller ruling on this task).

it('recognises nothing in a JSON file that is simply not a dive export', async () => {
  // The case that makes extension-matching wrong: §9's PADI migration is also JSON, so the
  // file name can never decide which importer owns a `.json`.
  expect(importerFor(bytesOf('{"hello":"world"}'))).toBeNull();
});

it('recognises nothing in a file that is not text at all', async () => {
  expect(importerFor(new Uint8Array([0x00, 0x01, 0x02, 0xff]))).toBeNull();
});

it('names every format it knows, from the registry rather than from a second list', async () => {
  // The Settings caption is generated from this, so a format added without a label is a
  // caption that quietly stops naming everything the app can read.
  expect(importerLabels()).toHaveLength(IMPORTERS.length);
  expect(importerLabels().every((l) => l.length > 0)).toBe(true);
});

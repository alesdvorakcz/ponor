// src/domain/import/registry.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { importerFor, importerLabels, IMPORTERS } from './registry';

const bytesOf = (text: string) => new TextEncoder().encode(text);

it('picks an importer by what a file contains, never by what it is called', () => {
  // The case that matters most for this seam — a real dive-computer export, named however a
  // diver's phone happened to name it, is recognised by its *content*. §9's PADI migration is
  // also JSON, so two formats will one day share the extension and only this can tell them apart.
  const suuntoBytes = new Uint8Array(
    readFileSync(join(__dirname, '__fixtures__', 'suunto-d5.json')),
  );
  expect(importerFor(suuntoBytes)?.source).toBe('suunto-app-json');
});

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

// src/db/importDives.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as registryModule from '../domain/import/registry';
import { type DiveImporter } from '../domain/import/types';
import { getDiveSamples } from './diveSamples';
import * as divesModule from './dives';
import { listDives, softDeleteDive, updateDive } from './dives';
import { importFiles, type ImportFile } from './importDives';
import { createTestDb, type TestDb } from './testDb';

/**
 * Mirrors the `fixture()` helper in `domain/import/suunto.test.ts` — same fixtures, read the
 * same way — but from this file's own `../domain/import/__fixtures__`, one directory over.
 * This module is the shared writer's own test, not an importer's, so it reads the fixtures as
 * raw bytes rather than reaching for anything Suunto-specific: see this task's "must not know"
 * rule below.
 */
const fixtureBytes = (name: string) =>
  new Uint8Array(
    readFileSync(join(__dirname, '..', 'domain', 'import', '__fixtures__', `${name}.json`)),
  );

const file = (name: string, bytes: Uint8Array): ImportFile => ({ name, bytes });

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

// Only the write-failure test below spies on `./dives`; restored here rather than inline so a
// failed assertion can never skip the restore and leak a rejecting mock into the next test.
afterEach(() => {
  jest.restoreAllMocks();
});

it('imports a dive and its profile together', async () => {
  const out = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);
  expect(out).toMatchObject({ imported: 1, alreadyThere: 0, failed: [] });
  const [dive] = await listDives(db);
  expect(dive?.maxDepthM).toBe(24.33);
  expect(await getDiveSamples(db, dive!.id)).not.toBeNull();
});

it('skips a dive it already has, and never overwrites the diver’s edits', async () => {
  // The whole reason duplicates are skipped: the file is immutable, the diver's copy is not.
  await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);
  const [before] = await listDives(db);
  await updateDive(db, before!.id, { siteName: 'Kotelna', buddy: 'Jana' });

  const out = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);

  expect(out).toMatchObject({ imported: 0, alreadyThere: 1, failed: [] });
  const [after] = await listDives(db);
  expect(after?.siteName).toBe('Kotelna');
  expect(after?.buddy).toBe('Jana');
});

it('keeps going past a bad file and names the one that failed', async () => {
  const out = await importFiles(db, [
    file('good.json', fixtureBytes('suunto-d5')),
    file('junk.json', new TextEncoder().encode('{"hello":"world"}')),
    file('other.json', fixtureBytes('suunto-d5-no-transmitter')),
  ]);
  expect(out.imported).toBe(2);
  expect(out.failed).toEqual([{ name: 'junk.json', reason: 'unrecognised' }]);
  expect(await listDives(db)).toHaveLength(2);
});

it('tells an unrecognised file apart from one it recognised and could not read, alongside a successful import', async () => {
  const out = await importFiles(db, [
    file('good.json', fixtureBytes('suunto-d5')),
    file('junk.json', new TextEncoder().encode('{"hello":"world"}')),
    file('broken.json', new TextEncoder().encode('{"DeviceLog":{"Header":{"DateTime":')),
  ]);
  expect(out.imported).toBe(1);
  expect(out.failed).toEqual([
    { name: 'junk.json', reason: 'unrecognised' },
    { name: 'broken.json', reason: 'unreadable' },
  ]);
});

it('keeps going past a dive that fails to write, and still imports the files after it', async () => {
  // The SELECT/createDive/putDiveSamples sequence, not importer.parse: this file was read
  // fine, the save is what throws — a full disk, a SQLite error, a bug in createDive itself.
  // Spied rather than injected, for the reason `db/dirty.test.ts` imports `* as divesModule`
  // from this same directory: `createDive` is a named import in importDives.ts, and a real
  // test database underneath is what the other tests here already use, so the seam is the
  // one function call, not the whole module.
  jest.spyOn(divesModule, 'createDive').mockRejectedValueOnce(new Error('disk full'));

  const out = await importFiles(db, [
    file('bad.json', fixtureBytes('suunto-d5')),
    file('good.json', fixtureBytes('suunto-d5-no-transmitter')),
  ]);

  expect(out).toMatchObject({
    imported: 1,
    alreadyThere: 0,
    failed: [{ name: 'bad.json', reason: 'unwritable' }],
  });
  expect(await listDives(db)).toHaveLength(1);
});

it('dedupes correctly even when an importer’s dive omits importSource and importId', async () => {
  // The writer must own both halves of the dedupe key (DESIGN.md §4.1). This fake importer
  // stands in for a second importer whose author sets `source` and forgets to also put
  // `importSource`/`importId` on the dive it returns — which is exactly the case the SELECT
  // above cannot protect against by itself: it queries `importer.source`, but the write used
  // to trust whatever `dive.importSource`/`dive.importId` happened to hold, `undefined` here.
  const fakeImporter: DiveImporter = {
    source: 'fake-format',
    label: () => 'Fake',
    recognises: () => true,
    parse: () => [{ importId: 'fixed-id-1', series: null, dive: { date: '2026-01-01' } }],
  };
  jest.spyOn(registryModule, 'importerFor').mockReturnValue(fakeImporter);

  const first = await importFiles(db, [file('fake.bin', new Uint8Array())]);
  expect(first).toMatchObject({ imported: 1, alreadyThere: 0, failed: [] });

  const second = await importFiles(db, [file('fake.bin', new Uint8Array())]);
  expect(second).toMatchObject({ imported: 0, alreadyThere: 1, failed: [] });

  const [dive] = await listDives(db);
  expect(dive?.importSource).toBe('fake-format');
  expect(dive?.importId).toBe('fixed-id-1');
});

it('leaves a previously-imported dive deleted when re-importing after the diver has soft-deleted it', async () => {
  // A dive the importer read is immutable — it happens at a fixed depth on a date, not again.
  // But the diver's copy is not: they add the site, buddy, notes. Deleting an imported dive is
  // that work. Re-importing the same file must not resurrect it — the file's immutability is
  // not a reason to overwrite a deletion that is the diver's own.
  const { imported: beforeCount } = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);
  expect(beforeCount).toBe(1);

  const [imported] = await listDives(db);
  expect(imported).toBeDefined();

  // Delete the dive.
  await softDeleteDive(db, imported!.id);
  expect(await listDives(db)).toEqual([]);

  // Re-import the same file.
  const out = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);

  // The dive stays deleted. It still exists in the database — tombstoned, for sync — but the
  // importer found it when scanning for duplicates and skipped it rather than restoring it.
  expect(out).toMatchObject({ imported: 0, alreadyThere: 1, failed: [] });
  expect(await listDives(db)).toEqual([]);
});

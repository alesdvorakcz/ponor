// src/db/importDives.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getDiveSamples } from './diveSamples';
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

it('tells an unrecognised file apart from one it recognised and could not read', async () => {
  const out = await importFiles(db, [
    file('junk.json', new TextEncoder().encode('{"hello":"world"}')),
    file('broken.json', new TextEncoder().encode('{"DeviceLog":{"Header":{"DateTime":')),
  ]);
  expect(out.failed).toEqual([
    { name: 'junk.json', reason: 'unrecognised' },
    { name: 'broken.json', reason: 'unreadable' },
  ]);
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

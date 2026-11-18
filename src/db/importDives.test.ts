// src/db/importDives.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as registryModule from '../domain/import/registry';
import { type DiveImporter } from '../domain/import/types';
import * as diveSamplesModule from './diveSamples';
import { getDiveSamples, tombstoneDiveSamples } from './diveSamples';
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

// Only the write-failure tests below spy on `./dives` and `./diveSamples`; restored here rather
// than inline so a failed assertion can never skip the restore and leak a rejecting mock into
// the next test.
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

// #9: `createDive` and `putDiveSamples` are two writes. When the second throws, the dive is kept
// without its curve and the file is named as `unwritable` ("Try again"). Trying again has to
// work: the re-import finds the dive by its import key and writes the profile it is missing,
// and nothing else about the dive, so the diver's edits made in between survive.
it('completes a dive whose profile failed to save when the same file is imported again', async () => {
  const samplesWrite = jest
    .spyOn(diveSamplesModule, 'putDiveSamples')
    .mockRejectedValueOnce(new Error('disk full'));

  const first = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);
  expect(first).toMatchObject({ imported: 0, alreadyThere: 0, failed: [{ name: 'a.json', reason: 'unwritable' }] });
  const [kept] = await listDives(db);
  expect(await getDiveSamples(db, kept!.id)).toBeNull();
  await updateDive(db, kept!.id, { siteName: 'Kotelna' });

  const second = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);

  expect(second).toMatchObject({ imported: 1, alreadyThere: 0, failed: [] });
  const after = await listDives(db);
  expect(after).toHaveLength(1);
  expect(after[0]?.id).toBe(kept!.id);
  expect(after[0]?.siteName).toBe('Kotelna');
  expect(await getDiveSamples(db, kept!.id)).not.toBeNull();

  // Once whole, the dive is simply already there: a third run writes nothing.
  const callsBefore = samplesWrite.mock.calls.length;
  const third = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);
  expect(third).toMatchObject({ imported: 0, alreadyThere: 1, failed: [] });
  expect(samplesWrite.mock.calls.length).toBe(callsBefore);
});

it('leaves a dive deleted when its profile had failed to save and the file comes again', async () => {
  // The completion is for a dive the diver still has. One they deleted stays deleted, with no
  // profile written behind it (the soft-delete test above, for a dive that never got its curve).
  jest.spyOn(diveSamplesModule, 'putDiveSamples').mockRejectedValueOnce(new Error('disk full'));
  await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);
  const [kept] = await listDives(db);
  await softDeleteDive(db, kept!.id);

  const out = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);

  expect(out).toMatchObject({ imported: 0, alreadyThere: 1, failed: [] });
  expect(await listDives(db)).toEqual([]);
  expect(await diveSamplesModule.listDiveSamples(db)).toEqual([]);
});

it('does not bring back a profile that was removed from a dive the diver still has', async () => {
  // A tombstoned series is a deletion that travels by sync, not a write that failed: only a dive
  // with no series row at all is missing its profile. `putDiveSamples` would un-tombstone it.
  await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);
  const [dive] = await listDives(db);
  await tombstoneDiveSamples(db, dive!.id);

  const out = await importFiles(db, [file('a.json', fixtureBytes('suunto-d5'))]);

  expect(out).toMatchObject({ imported: 0, alreadyThere: 1, failed: [] });
  expect(await getDiveSamples(db, dive!.id)).toBeNull();
});

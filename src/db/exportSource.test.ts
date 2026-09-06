import { sql } from 'drizzle-orm';

import { todayCalendarDate } from '../domain/datetime';
import { applyPulledDiveCenters, applyPulledDiveSites, createDiveCenter, createDiveSite, type PulledCenter, type PulledSite } from './catalogue';
import { createCertification } from './certifications';
import { createDive, softDeleteDive } from './dives';
import { readExportSource } from './exportSource';
import { createGearPreset } from './gearPresets';
import { setDivesBefore } from './settings';
import { settings } from './schema';
import { createTestDb, type TestDb } from './testDb';

/**
 * **What §8's export is made of, read against a real database.**
 *
 * Every seed below goes in through the repository that owns the table, so what this suite
 * observes is what the app would actually export rather than rows a test inserted by hand.
 *
 * The case that matters most is the last one: **one read failing must lose the whole export**.
 * It is exercised by removing a table from the database rather than by mocking a module, so
 * the failure travels the real path — a `catch` added anywhere between the repository and the
 * caller turns it red.
 */

// **What day it is, faked so the file names can be asserted against a known one** — and, more
// to the point, so this suite witnesses that the export asks §4.1's owner of that question
// instead of slicing a date out of an ISO instant, which is UTC and is what that rule exists to
// forbid. `requireActual` keeps every other date rule real, including the ones `db/dives.ts`
// applies at its own write boundary.
jest.mock('../domain/datetime', () => ({
  ...jest.requireActual('../domain/datetime'),
  todayCalendarDate: jest.fn(() => '2026-09-06'),
}));

const mockToday = todayCalendarDate as jest.Mock;

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
  mockToday.mockImplementation(() => '2026-09-06');
});

const STAMP = '2026-09-01T08:00:00.000Z';

const pulledSite = (over: Partial<PulledSite>): PulledSite => ({
  id: 'site-1',
  name: 'Blue Hole',
  country: 'EG',
  latitude: null,
  longitude: null,
  salinity: null,
  waterBody: null,
  entry: null,
  maxDepthM: null,
  createdBy: null,
  status: 'active',
  mergedInto: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
  ...over,
});

const pulledCenter = (over: Partial<PulledCenter>): PulledCenter => ({
  id: 'center-1',
  name: 'Dahab Divers',
  country: 'EG',
  latitude: null,
  longitude: null,
  website: null,
  createdBy: null,
  status: 'active',
  mergedInto: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
  ...over,
});

describe('readExportSource', () => {
  it('collects the diver’s own four private tables', async () => {
    await createDive(db, { date: '2026-08-16', siteName: 'Kotelna' });
    await createGearPreset(db, { name: 'twin 12 steel' });
    await createCertification(db, { agency: 'SSI', course: 'Open Water' });

    const source = await readExportSource(db, null);

    expect(source.dives).toHaveLength(1);
    expect(source.dives[0]?.siteName).toBe('Kotelna');
    expect(source.gearPresets.map((preset) => preset.name)).toEqual(['twin 12 steel']);
    expect(source.certifications.map((card) => card.agency)).toEqual(['SSI']);
  });

  it('leaves out a dive the diver deleted', async () => {
    const kept = await createDive(db, { date: '2026-08-16' });
    const gone = await createDive(db, { date: '2026-08-17' });
    await softDeleteDive(db, gone.id);

    const source = await readExportSource(db, null);

    expect(source.dives.map((row) => row.id)).toEqual([kept.id]);
  });

  it('exports the community rows this diver created and no others', async () => {
    await applyPulledDiveSites(db, [
      pulledSite({ id: 'mine', name: 'Kotelna', createdBy: 'me' }),
      pulledSite({ id: 'theirs', name: 'Blue Hole', createdBy: 'someone-else' }),
      pulledSite({ id: 'orphan', name: 'Nameless', createdBy: null }),
    ]);
    await applyPulledDiveCenters(db, [
      pulledCenter({ id: 'centre-mine', name: 'Ponorka', createdBy: 'me' }),
      pulledCenter({ id: 'centre-theirs', name: 'Dahab Divers', createdBy: 'someone-else' }),
    ]);

    const source = await readExportSource(db, 'me');

    expect(source.diveSites.map((site) => site.id)).toEqual(['mine']);
    expect(source.diveCenters.map((center) => center.id)).toEqual(['centre-mine']);
  });

  it('exports a site created on this device that has not been pushed yet', async () => {
    // `created_by` is the server's (db/catalogue.ts's SERVER_AUTHORED), so this row has none —
    // and it is the one an export would most obviously lose.
    const local = await createDiveSite(db, { name: 'Divoká Šárka' });
    await createDiveCenter(db, { name: 'Nový Klub' });
    await applyPulledDiveSites(db, [pulledSite({ id: 'theirs', createdBy: 'someone-else' })]);

    const source = await readExportSource(db, 'me');

    expect(source.diveSites.map((site) => site.id)).toEqual([local.id]);
    expect(source.diveCenters.map((center) => center.name)).toEqual(['Nový Klub']);
  });

  it('reads the pre-Ponor count from settings', async () => {
    await setDivesBefore(db, 247);
    expect((await readExportSource(db, null)).divesBefore).toBe(247);
  });

  it('does not refuse the export over a pre-Ponor count it cannot read', async () => {
    // `getDivesBefore` throws on this, and is right to for a screen that can offer a fix.
    // Refusing an export over it would turn one bad settings row into "you may not have a copy
    // of your dives", so the raw value goes through and `assignDiveNumbers` degrades it.
    await db.insert(settings).values({ key: 'dives_before', value: '0x10' });
    await expect(readExportSource(db, null)).resolves.toEqual(
      expect.objectContaining({ divesBefore: NaN }),
    );
  });

  it('says when it was taken, in the diver’s own calendar day', async () => {
    const source = await readExportSource(db, null);
    expect(source.exportedOn).toBe('2026-09-06');
    expect(mockToday).toHaveBeenCalled();
    // An instant, in the same spelling every stamped row in this database carries.
    expect(source.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('fails as a whole when any one of its reads fails', async () => {
    await createDive(db, { date: '2026-08-16' });
    await createGearPreset(db, { name: 'twin 12 steel' });
    // A real failure on a real path: the certifications read has nothing to read from. Nothing
    // here mocks a module, so a `catch` added anywhere between the repository and the caller —
    // the "export what we could" that produces a file missing a diver's cards while looking
    // complete — is what this goes red over.
    db.run(sql`drop table certifications`);

    await expect(readExportSource(db, null)).rejects.toThrow();
  });
});

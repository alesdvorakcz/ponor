import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A migration run against a device that already holds rows — the case `createTestDb` never
 * meets, because it migrates an empty database. SQLite refuses a NOT NULL `ADD` without a default
 * only on a table that has rows (M2d; 0001's header records it), so #31's JSON-array columns are
 * checked here on a catalogue that is not empty (§6).
 */

const MIGRATIONS = path.join(__dirname, 'migrations');

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
  entries: JournalEntry[];
};

const sqlOf = (entry: JournalEntry) => fs.readFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), 'utf8');

/** Runs one migration the way Drizzle's migrator does: statement by statement, on its breakpoints. */
function apply(sqlite: Database.Database, entry: JournalEntry) {
  for (const statement of sqlOf(entry).split('--> statement-breakpoint')) {
    if (statement.trim() !== '') sqlite.exec(statement);
  }
}

function columnsOf(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
}

describe('upgrading a device that already holds a catalogue (§6)', () => {
  it('adds #31’s columns to a device that already holds a site and a centre', () => {
    const target = journal.entries.findIndex((entry) => sqlOf(entry).includes('`site_types`'));
    expect(target).toBeGreaterThan(0);

    const sqlite = new Database(':memory:');
    for (const entry of journal.entries.slice(0, target)) apply(sqlite, entry);

    const stamp = '2026-11-17T09:00:00.000Z';
    sqlite.exec(
      `insert into dive_sites (id, name, status, created_at, updated_at, dirty)
         values ('s1', 'Vrak Teti', 'active', '${stamp}', '${stamp}', 0)`,
    );
    sqlite.exec(
      `insert into dive_centers (id, name, status, created_at, updated_at, dirty)
         values ('c1', 'Nautica Vis', 'active', '${stamp}', '${stamp}', 0)`,
    );
    const sitesBefore = columnsOf(sqlite, 'dive_sites');
    const centersBefore = columnsOf(sqlite, 'dive_centers');

    const upgrade = journal.entries[target];
    if (upgrade === undefined) throw new Error('no migration adds site_types');
    expect(() => apply(sqlite, upgrade)).not.toThrow();

    // The new columns are read off the table, before and after, so the expectation below is a
    // statement about exactly what the upgrade added — a column it missed or invented fails it.
    const added = (table: string, before: string[]) => {
      const columns = columnsOf(sqlite, table).filter((column) => !before.includes(column));
      return sqlite.prepare(`select ${columns.join(', ')} from ${table}`).get();
    };

    expect(added('dive_sites', sitesBefore)).toEqual({
      site_types: '[]',
      suitable_for: null,
      alt_names: '[]',
      description: null,
      wreck_name: null,
      wreck_sunk_year: null,
    });
    expect(added('dive_centers', centersBefore)).toEqual({
      address: null,
      phone: null,
      email: null,
      opening_hours: null,
      services: '[]',
      agencies: '[]',
      description: null,
    });
  });
});

describe('upgrading a device whose sites hold one entry each (§6, #31)', () => {
  /**
   * A site's `entry` became a set in place, under its old name (§10): the column was one text
   * value or null, and is now a JSON array, NOT NULL and `'[]'` when nothing is known. A
   * rebuild that copied the old values across as they were would fail on the null and leave a
   * bare `shore` that no reader can take for a set — so each row has to arrive as a set. Asked
   * from both states a device can be in: what `main` holds, and what a build of #31 before this
   * change holds.
   */
  const target = journal.entries.findIndex((entry) => sqlOf(entry).includes('`site_types`'));

  it.each([
    ['before #31', target],
    ['after #31’s first columns', target + 1],
  ])('turns each stored entry into a set, from %s', (_state, upTo) => {
    expect(target).toBeGreaterThan(0);
    const sqlite = new Database(':memory:');
    for (const entry of journal.entries.slice(0, upTo)) apply(sqlite, entry);

    const stamp = '2026-11-17T09:00:00.000Z';
    const insert = sqlite.prepare(
      `insert into dive_sites (id, name, entry, status, created_at, updated_at, dirty)
         values (?, ?, ?, 'active', '${stamp}', '${stamp}', 0)`,
    );
    insert.run('s1', 'Vrak Teti', 'shore');
    insert.run('s2', 'Kamena vrata', null);
    insert.run('s3', 'Kut', '');
    insert.run('s4', 'Stone Gate', '["boat"]');

    for (const entry of journal.entries.slice(upTo)) apply(sqlite, entry);

    expect(sqlite.prepare('select id, name, entry from dive_sites order by id').all()).toEqual([
      { id: 's1', name: 'Vrak Teti', entry: '["shore"]' },
      { id: 's2', name: 'Kamena vrata', entry: '[]' },
      { id: 's3', name: 'Kut', entry: '[]' },
      { id: 's4', name: 'Stone Gate', entry: '["boat"]' },
    ]);
    // And the column is a set's from here on: a row written without one holds `[]`, never null.
    sqlite.exec(
      `insert into dive_sites (id, name, status, created_at, updated_at, dirty)
         values ('s5', 'Nautica', 'active', '${stamp}', '${stamp}', 0)`,
    );
    expect(sqlite.prepare(`select entry from dive_sites where id = 's5'`).get()).toEqual({ entry: '[]' });
    expect(() => sqlite.exec(`update dive_sites set entry = null where id = 's5'`)).toThrow(/NOT NULL/);
  });
});

describe('upgrading a device whose sites have no altitude yet (§6, #31)', () => {
  it('adds a nullable altitude and leaves every stored site as it was', () => {
    const target = journal.entries.findIndex((entry) => sqlOf(entry).includes('`altitude_m`'));
    expect(target).toBeGreaterThan(0);

    const sqlite = new Database(':memory:');
    for (const entry of journal.entries.slice(0, target)) apply(sqlite, entry);
    const stamp = '2026-11-17T09:00:00.000Z';
    sqlite.exec(
      `insert into dive_sites (id, name, max_depth_m, status, created_at, updated_at, dirty)
         values ('s1', 'Vrak Teti', 32, 'active', '${stamp}', '${stamp}', 0)`,
    );

    for (const entry of journal.entries.slice(target)) apply(sqlite, entry);

    // No data step: the new column is null, and the neighbouring depth is untouched.
    expect(sqlite.prepare('select max_depth_m, altitude_m from dive_sites').get()).toEqual({
      max_depth_m: 32,
      altitude_m: null,
    });
  });
});

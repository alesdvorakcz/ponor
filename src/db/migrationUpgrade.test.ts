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

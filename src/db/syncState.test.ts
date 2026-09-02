import { sql } from 'drizzle-orm';

import { syncState } from './schema';
import { getLastPulledAt, lastPulledAtQuery, readLastPulledAt, recordPull } from './syncState';
import { createTestDb, type TestDb } from './testDb';

/**
 * §7.3's watermark: "`last_pulled_at` comes from the server's response, never the phone's
 * clock — divers change time zones constantly."
 *
 * Two failures are worth defending against and only one of them is survivable. A watermark
 * that is **lost** costs one full pull, which §7 makes free because the upsert is idempotent.
 * A watermark that is **invented** — a local clock, a normalised spelling, a plausible
 * fallback — skips every row the server changed inside the gap, on that device, permanently,
 * with nothing raised. So everything here degrades toward "pull everything" and nothing here
 * manufactures a value.
 */

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});

describe('the watermark', () => {
  it('is absent on a device that has never pulled', async () => {
    expect(await getLastPulledAt(db)).toBeNull();
  });

  it('comes back exactly as the server sent it', async () => {
    await recordPull(db, '2026-09-02T09:00:00.000Z');
    expect(await getLastPulledAt(db)).toBe('2026-09-02T09:00:00.000Z');
  });

  it('is stored unread — nothing here parses it, normalises it or invents one', async () => {
    // A spelling this build does not recognise is still the server's answer, and the only
    // authority on what it means is the server that issued it. A client that "corrected" it —
    // or refused it — would stop syncing rather than lose an hour of overlap.
    await recordPull(db, 'whatever the server said');
    expect(await getLastPulledAt(db)).toBe('whatever the server said');
  });

  it('keeps one row, so a second pull moves the watermark rather than adding one', async () => {
    await recordPull(db, '2026-09-02T09:00:00.000Z');
    await recordPull(db, '2026-09-02T10:00:00.000Z');

    expect(await getLastPulledAt(db)).toBe('2026-09-02T10:00:00.000Z');
    const rows = await db.select().from(syncState);
    expect(rows).toHaveLength(1);
  });

  it('refuses an empty watermark rather than storing a second way to say "never"', async () => {
    // An empty string and an absent row are the same fact, and storing the first would make
    // `readLastPulledAt` answer one question two ways — §6's own reason for `tanks` being NOT
    // NULL. A server that returned nothing is a bug worth hearing about, not one to record.
    await expect(recordPull(db, '')).rejects.toThrow(/refusing to store an empty one/);
    await expect(recordPull(db, '   ')).rejects.toThrow(/refusing to store an empty one/);
    expect(await getLastPulledAt(db)).toBeNull();
  });

  it('reads through the same query a live screen would', async () => {
    await recordPull(db, '2026-09-02T09:00:00.000Z');
    expect(readLastPulledAt(await lastPulledAtQuery(db))).toBe('2026-09-02T09:00:00.000Z');
  });
});

describe('what an unreadable row degrades to (db/settings.ts draws the same line)', () => {
  it('reads a null column as never pulled', async () => {
    await db.insert(syncState).values({ id: 'sync_state', lastPulledAt: null });
    expect(await getLastPulledAt(db)).toBeNull();
  });

  it('reads a blank column as never pulled', async () => {
    await db.run(sql`insert into sync_state (id, last_pulled_at) values ('sync_state', '   ')`);
    expect(await getLastPulledAt(db)).toBeNull();
  });

  it('ignores a row that is not the one row this table has', async () => {
    // The id is what makes "one row" true at runtime. A reader taking whatever came first
    // would answer differently depending on SQLite's storage order the moment a second row
    // existed — and a watermark from the wrong row is the invented kind.
    await db.run(sql`insert into sync_state (id, last_pulled_at) values ('other', '2099-01-01T00:00:00.000Z')`);
    expect(await getLastPulledAt(db)).toBeNull();

    await recordPull(db, '2026-09-02T09:00:00.000Z');
    expect(await getLastPulledAt(db)).toBe('2026-09-02T09:00:00.000Z');
  });

  it('never throws on rows a live query might hand it', () => {
    // `useLiveQuery`'s `.data` is `unknown[]`, and a screen composing this during a render must
    // degrade rather than crash — `db/settings.ts`'s readers take the same shape for the same
    // reason.
    expect(readLastPulledAt([])).toBeNull();
    expect(readLastPulledAt([null])).toBeNull();
    expect(readLastPulledAt(['not a row'])).toBeNull();
    expect(readLastPulledAt([{}])).toBeNull();
    expect(readLastPulledAt([{ lastPulledAt: 42 }])).toBeNull();
    expect(readLastPulledAt(undefined as unknown as unknown[])).toBeNull();
  });
});

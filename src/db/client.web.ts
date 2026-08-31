import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import migrations from './migrations/migrations';
import * as schema from './schema';

/**
 * The browser's copy of `client.ts` — same exports, same types, opened a different way.
 * Web only; Metro picks this file over `client.ts` for `--platform web` and Jest (iOS-only
 * haste platforms) never sees it, so nothing here can affect a device build.
 *
 * **Why this file exists at all.** On web `expo-sqlite` is not SQLite in the app's process:
 * it is wa-sqlite compiled to wasm, running in a dedicated Worker, with the *synchronous*
 * API bridged across by a `SharedArrayBuffer` and a spin loop on the main thread
 * (`expo-sqlite/web/WorkerChannel.ts`). `openDatabaseSync` therefore does two things in one
 * breath: it creates the Worker, and it immediately blocks the main thread waiting for that
 * Worker's first answer.
 *
 * That deadlocks, and not for the reason the spin loop's own error message suggests. A
 * dedicated worker's script is fetched and started **by its parent's event loop**, so a main
 * thread sitting in a busy loop is a main thread that never gets around to booting the worker
 * it is waiting for. Measured in Chrome 141 against this bundle: with the main thread
 * spinning from the first instruction, the worker had still not answered after 20 seconds and
 * 134 million iterations. Raising the loop's budget cannot fix it — there is nothing to wait
 * for. Yielding once is all it takes: after a single async round-trip the same worker answers
 * `open` in ~12 ms and every synchronous call after that works normally.
 *
 * So the browser opens the database with `openDatabaseAsync` and the app waits. That is the
 * whole difference from native. Once `ready` resolves, the shared data layer above this file
 * is untouched: Drizzle's expo-sqlite session is entirely synchronous (`prepareSync`,
 * `executeSync`, `getAllSync`) and stays that way here.
 */

/** Resolves with the browser's database once its worker has booted. */
const opening: Promise<SQLiteDatabase> = openDatabaseAsync('ponor.db', { enableChangeListener: true });

let opened: SQLiteDatabase | null = null;
const ready: Promise<SQLiteDatabase> = opening.then((database) => {
  opened = database;
  return database;
});

/**
 * Stands in for the `SQLiteDatabase` until the worker has booted.
 *
 * Deliberately a **loud** stand-in and not a quiet one. Every property access is forwarded to
 * the real database the moment there is one, and throws before then — it holds no rows, fakes
 * no reads and returns no empty list that a screen could render as "you have no dives". A
 * browser showing an empty logbook backed by nothing is a worse outcome than a browser
 * showing an error, because only one of the two is distinguishable from the truth.
 *
 * Nothing should ever see the throw: `useMigrations` below reports `success: false` until
 * `ready` resolves, and `app/_layout.tsx` renders nothing at all while that is false, so no
 * screen — and therefore no query — exists before the database does. The throw is the guard
 * for that claim being wrong, not a path anything is expected to take.
 *
 * Drizzle only ever calls `prepareSync` on this object (`drizzle-orm/expo-sqlite/session.js`),
 * but the proxy forwards everything rather than shimming that one method, so a future caller
 * reaching for `execSync` or `withTransactionAsync` gets the real thing rather than a gap.
 */
const client = new Proxy({} as SQLiteDatabase, {
  get(_target, property, receiver) {
    if (opened === null) {
      throw new Error(
        `The browser database is still opening — read '${String(property)}' after useMigrations() reports success.`,
      );
    }
    const value = Reflect.get(opened, property, receiver);
    return typeof value === 'function' ? value.bind(opened) : value;
  },
});

/** The app's database. Tests never touch this — they build their own (see testDb.ts). */
export const db = drizzle(client, { schema });

/**
 * Applies any pending migrations. Returns `{ success, error }`, same shape as native's.
 *
 * Not `drizzle-orm/expo-sqlite/migrator`'s own `useMigrations`: that one migrates in a
 * `useEffect` on mount, and on web there is nothing to migrate yet at that point. This waits
 * for the open first and then hands off to the same `migrate` the native hook uses, so the
 * migration itself is not a second implementation — only the waiting is.
 */
export function useMigrations(): { success: boolean; error: Error | undefined } {
  const [state, setState] = useState<{ success: boolean; error: Error | undefined }>({
    success: false,
    error: undefined,
  });

  useEffect(() => {
    let live = true;
    ready
      .then(() => migrate(db, migrations))
      .then(() => {
        if (live) setState({ success: true, error: undefined });
      })
      .catch((cause: unknown) => {
        if (live) setState({ success: false, error: cause instanceof Error ? cause : new Error(String(cause)) });
      });
    return () => {
      live = false;
    };
  }, []);

  return state;
}

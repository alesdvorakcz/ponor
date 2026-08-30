// Manual Jest mock for the native `expo-sqlite` package.
//
// This exists for exactly one reason: src/db/client.ts calls
// `openDatabaseSync` at MODULE SCOPE to build the app's one real database
// singleton. expo-sqlite is a native module (see src/db/testDb.ts's own
// docblock — "expo-sqlite is a native module and cannot run under Jest"),
// so under Jest that call throws ("ExpoSQLite.NativeDatabase is not a
// constructor") the instant anything imports client.ts — even a module that
// never touches the database at all.
//
// src/db/useDives.ts is that module: its `composeDives` export is pure and
// unit-tested without a renderer or a real database (src/db/useDives.test.ts),
// but it lives in the same file as the `useDives` hook, which does need the
// app's real `db` — so the file imports client.ts regardless of which export
// a test actually wants. ES imports are eager, so there is no way to load
// `composeDives` alone without client.ts's module body running too.
//
// This mock only has to make that module body not throw. It is never asked
// to run a real query: every test that exercises actual SQL uses
// src/db/testDb.ts's in-memory better-sqlite3 database instead, exactly as
// every other repository module already does. Do not extend this into a
// working fake database — that would just be testDb.ts's job, done worse.
module.exports = {
  openDatabaseSync: () => ({}),
  openDatabaseAsync: async () => ({}),
};

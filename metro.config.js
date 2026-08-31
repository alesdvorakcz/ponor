const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Watchman is installed and healthy, but it refuses to start under the reduced macOS
// QoS class that some automated shells run commands at: it checks its own priority and
// bails with "running at a lower than normal priority (nice_value=5)". Metro probes
// watchman through checkWatchmanCapabilities, which has NO timeout, so that refusal
// hangs the bundler instead of falling back to the Node crawler.
//
// If `watchman version` returns promptly in your own terminal, watchman works for you and
// this line only costs you speed — delete it. Metro's Node crawler is fine at this size.
// Verified 2026-08-29: same binary and state dir start instantly under
// `taskpolicy -d default`, so this is about priority, not a broken install.
config.resolver.useWatchman = false;

// Drizzle ships migrations as .sql files that must be bundled, not read from disk —
// there is no filesystem to read them from on a device.
//
// This line is believed REDUNDANT and is kept deliberately. babel-plugin-inline-import
// resolves the one .sql import in the tree itself (require-resolve + readFileSync, never
// consulting Metro's resolver) and replaces the whole ImportDeclaration with a string
// literal — and Metro collects dependencies from the post-Babel AST, so by the time
// sourceExts could matter there is no .sql specifier left to resolve. Verified by running
// the project's own babel.config.js over src/db/migrations/migrations.js: no .sql specifier
// survives, and the exported iOS bundle carries the migration SQL inlined with no .sql
// module path. It was never sufficient on its own either — before inline-import it made
// the file resolve and then fail to parse, since Babel has no idea what to do with SQL.
//
// Kept because the mechanism was proven but the counterfactual was never observed (removing
// it and re-exporting), and being wrong here means the app cannot migrate its database at
// startup — a catastrophic downside against a three-line cosmetic upside. Do not read it as
// load-bearing, and do not delete it without running that experiment.
config.resolver.sourceExts.push('sql');

// expo-sqlite's web build imports `wa-sqlite.wasm`, and Metro will not resolve a .wasm
// specifier unless it is registered as an asset. Without this line `expo export --platform
// web` dies at "Unable to resolve module ./wa-sqlite/wa-sqlite.wasm" — the file DOES ship
// inside expo-sqlite, it simply cannot be required. Harmless on native: nothing in the
// native graph imports a .wasm, and the iOS bundle is unchanged — same Metro content hash
// (`entry-4e6eb16d…`) before and after. Not "byte-for-byte": three iOS exports of identical
// source produce three different `.hbc` files, so the content hash is the identity to check.
//
// The host also has to send cross-origin isolation headers (COOP: same-origin, COEP:
// require-corp) — wa-sqlite needs `SharedArrayBuffer`. That is a deployment requirement, not
// a code one, and `dev/coopserve.py` is not in this repo: see .superpowers/sdd/
// web-spike-report.md for the server used to test it.
//
// The rest of what web needs lives in `src/db/client.web.ts` (why `openDatabaseSync` cannot
// be the browser's entry point) and `patches/expo-sqlite+57.0.2.patch` (why any sync result
// over 255 bytes came back truncated). This line only makes the bundle build.
//
// It is here now because it was not before: 6350908 committed eighteen lines of comment
// explaining this fix and never committed the fix, so `expo export --platform web` went on
// dying at exactly the error the comment said it prevented, while the comment, the commit
// message and DESIGN.md §9 all described a repo state that did not exist. If a comment tells
// you something is verified, check that the code under it is there.
config.resolver.assetExts.push('wasm');

module.exports = config;

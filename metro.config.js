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

module.exports = config;

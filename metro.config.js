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
config.resolver.sourceExts.push('sql');

module.exports = config;

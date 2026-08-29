const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Watchman's daemon will not start on this machine — the binary runs, but it never
// creates its socket and writes no log, so `watchman version` hangs indefinitely.
// Metro probes watchman through checkWatchmanCapabilities, which has NO timeout, so a
// wedged daemon hangs the bundler rather than falling back. Metro's own Node crawler is
// fine at this project's size.
//
// This is a workaround for a host problem, not a preference: remove it once watchman
// works, since watchman is faster on a healthy machine.
config.resolver.useWatchman = false;

module.exports = config;

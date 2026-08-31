'use strict';

const NodeEnvironment = require('jest-environment-node').TestEnvironment;

/**
 * A Jest environment that runs one test file in a chosen IANA time zone.
 *
 * `domain/datetime.ts`'s picker boundary converts a JS `Date` to and from this app's
 * `YYYY-MM-DD` / `HH:MM` strings using LOCAL calendar components, because the obvious
 * spellings (`toISOString().slice(0, 10)`, `new Date('2026-08-31')`) are UTC and silently
 * store or display the wrong day everywhere else — DESIGN.md §10 records that class of bug
 * twice over. A test for that is only worth anything if it runs somewhere that is not UTC,
 * and CI machines are UTC by default, so the zone has to be forced rather than inherited.
 *
 * It has to be forced from HERE specifically. Setting `process.env.TZ` inside a test file
 * does nothing: Jest hands the sandbox a plain copy of `process`, so the assignment never
 * reaches Node's real `env` setter and V8 never drops its cached zone — verified on this
 * repo, where the first draft of those tests silently went on running in Europe/Prague. An
 * environment module runs in the worker's own context BEFORE the sandbox exists, where
 * `process.env` is the real one and the assignment does invalidate the cache.
 *
 * Per-file, and restored on teardown, so this moves one suite's zone rather than the whole
 * 29-suite run — a `globalSetup` would put every other test in a zone it never asked for,
 * and could only ever offer one zone where the point is to check both sides of UTC.
 *
 * Used through a docblock at the top of a test file:
 *
 *     /** @jest-environment ./jest/timeZoneEnvironment.js *\/
 *     /** @jest-environment-options {"timeZone": "Pacific/Kiritimati"} *\/
 */
class TimeZoneEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    const timeZone = config.projectConfig.testEnvironmentOptions.timeZone;
    if (typeof timeZone !== 'string' || timeZone === '') {
      throw new Error(
        'timeZoneEnvironment: pass a zone, e.g. /** @jest-environment-options {"timeZone": "Pacific/Niue"} */',
      );
    }
    this.previousTimeZone = process.env.TZ;
    process.env.TZ = timeZone;
  }

  async teardown() {
    // Test files share a worker process, so a zone left set here would leak into whichever
    // suite that worker picks up next.
    if (this.previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = this.previousTimeZone;
    await super.teardown();
  }
}

module.exports = TimeZoneEnvironment;

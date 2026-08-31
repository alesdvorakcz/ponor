# patches/

- `expo-modules-jsi+57.0.6.patch` removes two `SWIFT_RETURNS_RETAINED` annotations from
  `RuntimeScheduler`'s constructors so Expo SDK 57 compiles under Xcode 26.3. Upstream:
  https://github.com/expo/expo/issues/47539.
- Risk: Swift may now treat the constructor as +0 when it is actually +1, which could
  leak one scheduler object - not a crash.
- Remove this patch once Expo compiles under Xcode 26.3 unaided.

- `expo-sqlite+57.0.2.patch` fixes the length header of the **web** synchronous worker
  bridge (`web/WorkerChannel.ts`). `sendWorkerResult` recorded the payload length with
  `resultArray.set(new Uint32Array([length]), 0)`, and `set` on a `Uint8Array` converts each
  source element to one byte — so a four-byte header was written as one, the length arrived
  mod 256, and `invokeWorkerSync` read it back as a full uint32. Every synchronous result of
  256 bytes or more came back truncated to `length % 256`; in Ponor that surfaced as
  `SyntaxError: Unexpected end of JSON input` on the first `INSERT ... RETURNING`, i.e. on
  saving any dive at all. Measured in Chrome: results at 266, 296, … 566 bytes all reported
  lengths of 10, 40, … 54.
- Risk: none on iOS or Android. `web/WorkerChannel.ts` is reachable only from
  `build/ExpoSQLite.web.js`; the native module goes through `requireNativeModule`, and the
  iOS export's bundle content hash is unchanged with the patch applied.
- Remove this patch once expo-sqlite writes that header as four bytes upstream. Not yet
  reported to expo/expo — see `.superpowers/sdd/web-spike-report.md`.

# patches/

- `expo-modules-jsi+57.0.6.patch` removes two `SWIFT_RETURNS_RETAINED` annotations from
  `RuntimeScheduler`'s constructors so Expo SDK 57 compiles under Xcode 26.3. Upstream:
  https://github.com/expo/expo/issues/47539.
- Risk: Swift may now treat the constructor as +0 when it is actually +1, which could
  leak one scheduler object - not a crash.
- Remove this patch once Expo compiles under Xcode 26.3 unaided.

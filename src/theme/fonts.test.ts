import { iosFonts } from './fonts';
import { WEB_FONT_SOURCES } from './loadFonts.web';
import { fonts as androidFonts, fontFiles } from './tokens';

// iOS and Android resolve fonts by two different naming schemes (see fonts.ts),
// kept as two separately maintained maps. Nothing at the type level stops them
// from drifting as faces are added or renamed, so that is what this suite guards.
describe('fonts', () => {
  it('has the same set of keys on iOS as on Android', () => {
    expect(Object.keys(iosFonts).sort()).toEqual(Object.keys(androidFonts).sort());
  });

  it('gives every iOS value a PostScript name, not an @expo-google-fonts file name', () => {
    for (const value of Object.values(iosFonts)) {
      expect(value).not.toContain('_');
    }
  });

  it('gives every Android value an @expo-google-fonts file name, not a PostScript name', () => {
    for (const value of Object.values(androidFonts)) {
      expect(value).not.toContain('-');
    }
  });
});

// The third list of faces, and the one nothing else can tie.
//
// `app.config.ts`'s .ttf paths are DERIVED from tokens.js's `fonts` map (`fontFiles`), so
// those two cannot drift. `loadFonts.web.ts` cannot be derived the same way: Metro resolves
// `import` specifiers statically, so the browser's six assets have to be written out as real
// imports, and a path built from `fontFiles` at runtime would bundle nothing. §4.1's rule for
// exactly that case is "derive, or tie" — this is the tie.
//
// It is a data assertion, not a behavioural one, and that is the point: `loadFonts.web.ts` is
// web-only code and Jest's one platform is iOS (jest-expo's stock preset), so nothing here can
// observe an @font-face being injected, and a test pretending to would be the fake coverage
// this repo's own history warns about. What CAN be observed from iOS is which faces that file
// bundles, which is the half that actually goes wrong — a weight added to tokens.js and
// forgotten here renders serif in a browser and nothing anywhere reports it.
//
// Imported by its literal `.web` path because Metro's platform resolution never runs under
// Jest; the import costs six asset-module ids and pulls in no browser machinery.
describe('web font sources', () => {
  it('bundles a .ttf for every family the app renders with, and none it does not', () => {
    // tokens.js keys `fontFiles` by family name, which is `fonts`' distinct values — exactly
    // the set of names that must resolve in a browser.
    expect(Object.keys(WEB_FONT_SOURCES).sort()).toEqual(Object.keys(fontFiles).sort());
  });

  it('resolves each of those to a real bundled asset rather than an undefined import', () => {
    // A subpath import that stopped existing (a renamed @expo-google-fonts folder) yields
    // `undefined`, which `loadAsync` rejects at runtime in a browser and nowhere else. Every
    // value is Metro's own asset-module id, hence a number.
    for (const [name, source] of Object.entries(WEB_FONT_SOURCES)) {
      expect(`${name}: ${typeof source}`).toBe(`${name}: number`);
    }
  });
});

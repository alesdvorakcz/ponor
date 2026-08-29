import { iosFonts } from './fonts';
import { fonts as androidFonts } from './tokens';

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

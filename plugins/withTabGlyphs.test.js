const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TAB_GLYPHS,
  parseGlyph,
  toIosSvg,
  iosContents,
  toVectorDrawable,
  writeIosGlyphs,
  writeAndroidGlyphs,
} = require('./withTabGlyphs');

const ROOT = path.join(__dirname, '..');
const read = (entry) => fs.readFileSync(path.join(ROOT, entry.svg), 'utf8');

// The bar asks the platform for each glyph BY NAME, and a name it cannot find is a tab with no
// glyph — nothing throws. So the names are the contract: Android resource names allow only
// lowercase letters, digits and underscores, and iOS takes the same string, so one name serves
// both. `navigation/tabs.test.ts` ties these names to the tabs that ask for them.
it('names every glyph in the one spelling both platforms accept', () => {
  for (const entry of TAB_GLYPHS) {
    expect(entry.name).toMatch(/^[a-z][a-z0-9_]*$/);
  }
  expect(new Set(TAB_GLYPHS.map((entry) => entry.name)).size).toBe(TAB_GLYPHS.length);
});

it.each(TAB_GLYPHS)('reads $svg as a 28 pt glyph drawn in the 22-unit canvas grid', (entry) => {
  const glyph = parseGlyph(read(entry));
  expect(glyph.size).toEqual({ width: 28, height: 28 });
  expect(glyph.viewBox).toEqual({ width: 22, height: 22 });
  expect(glyph.shapes.length).toBeGreaterThan(0);
});

// Every shape in the source must arrive on both platforms: a converter that dropped one would
// draw a two-stroke mark as a one-stroke mark on Android only, where nobody here can look.
it.each(TAB_GLYPHS)('converts every shape of $svg for both platforms', (entry) => {
  const glyph = parseGlyph(read(entry));
  const ios = toIosSvg(glyph);
  const android = toVectorDrawable(glyph);
  expect(ios.match(/<path /g)).toHaveLength(glyph.shapes.length);
  expect(android.match(/<path /g)).toHaveLength(glyph.shapes.length);
  expect(ios).toContain('width="28" height="28"');
  expect(android).toContain('android:width="28dp"');
  expect(android).toContain('android:viewportWidth="22"');
});

it('keeps the mark two strokes with round ends, and the sliders four filled shapes', () => {
  const mark = parseGlyph(read(TAB_GLYPHS.find((entry) => entry.name === 'tab_mark')));
  expect(mark.shapes.map((s) => [s.stroke, s.cap, s.join])).toEqual([
    [true, 'round', 'round'],
    [true, 'round', 'round'],
  ]);
  // The wave thinner than the profile: the canvas subordinates it by width (DESIGN.md §0.6).
  expect(mark.shapes.map((s) => s.width)).toEqual([1.6, 2]);
  const sliders = parseGlyph(read(TAB_GLYPHS.find((entry) => entry.name === 'tab_sliders')));
  expect(sliders.shapes).toHaveLength(4);
  expect(sliders.shapes.every((s) => s.stroke === false && s.d.endsWith('Z'))).toBe(true);
});

it('turns a rounded rect into a closed path with its corners', () => {
  const glyph = parseGlyph(
    '<svg viewBox="0 0 22 22" width="28" height="28"><rect x="3" y="6" width="16" height="2" rx="1" fill="#FFFFFF"/></svg>',
  );
  expect(glyph.shapes[0].d).toBe('M4,6H18A1,1 0 0 1 19,7V7A1,1 0 0 1 18,8H4A1,1 0 0 1 3,7V7A1,1 0 0 1 4,6Z');
});

// The guard that keeps the two platforms one drawing: a shape the converter does not know,
// or a second ink, stops the prebuild rather than shipping a partial or coloured glyph.
it('refuses a shape it cannot convert, and any ink but the placeholder', () => {
  expect(() =>
    parseGlyph('<svg viewBox="0 0 22 22" width="28" height="28"><circle cx="1" cy="1" r="1" fill="#FFFFFF"/></svg>'),
  ).toThrow(/circle/);
  expect(() =>
    parseGlyph('<svg viewBox="0 0 22 22" width="28" height="28"><rect width="2" height="2" fill="#FF6B4A"/></svg>'),
  ).toThrow(/one ink/);
});

// What makes it a vector a tab bar tints, rather than a picture: kept as a vector, drawn as a
// template. Without the second, iOS would draw the placeholder white on the light theme's bar.
it('marks the iOS image set as a template vector', () => {
  expect(iosContents('tab_mark.svg')).toEqual({
    images: [{ filename: 'tab_mark.svg', idiom: 'universal' }],
    info: { author: 'xcode', version: 1 },
    properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
  });
});

it('writes an image set per glyph into the asset catalog, and a drawable per glyph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-glyphs-'));
  try {
    writeIosGlyphs(ROOT, path.join(dir, 'Images.xcassets'));
    writeAndroidGlyphs(ROOT, path.join(dir, 'drawable'));
    for (const { name } of TAB_GLYPHS) {
      const set = path.join(dir, 'Images.xcassets', `${name}.imageset`);
      expect(JSON.parse(fs.readFileSync(path.join(set, 'Contents.json'), 'utf8')).images[0].filename).toBe(`${name}.svg`);
      expect(fs.readFileSync(path.join(set, `${name}.svg`), 'utf8')).toMatch(/^<svg /);
      expect(fs.readFileSync(path.join(dir, 'drawable', `${name}.xml`), 'utf8')).toContain('<vector ');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

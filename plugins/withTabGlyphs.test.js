const fs = require('fs');
const os = require('os');
const path = require('path');

const withTabGlyphs = require('./withTabGlyphs');
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

// The guard that keeps the two platforms one drawing — and that drawing the source's: a shape
// the converter does not know, a second ink, or anything it would silently drop stops the
// prebuild rather than shipping a glyph that differs from its SVG.
const glyph = (inner) => `<svg viewBox="0 0 22 22" width="28" height="28">${inner}</svg>`;

it('refuses a shape it cannot convert, and any ink but the placeholder', () => {
  expect(() => parseGlyph(glyph('<circle cx="1" cy="1" r="1" fill="#FFFFFF"/>'))).toThrow(/circle/);
  expect(() => parseGlyph(glyph('<rect width="2" height="2" fill="#FF6B4A"/>'))).toThrow(/one ink/);
});

it.each([
  ['a transform', '<rect width="2" height="2" fill="#FFFFFF" transform="rotate(45 1 1)"/>', /transform/],
  ['an opacity', '<rect width="2" height="2" fill="#FFFFFF" opacity="0.5"/>', /opacity/],
  ['a style', '<rect width="2" height="2" style="fill:#FFFFFF"/>', /style/],
  ['an ry', '<rect width="2" height="2" rx="1" ry="0.5" fill="#FFFFFF"/>', /ry/],
  ['a stroke opacity', '<polyline points="0,0 1,1" fill="none" stroke="#FFFFFF" stroke-opacity="0.5"/>', /stroke-opacity/],
  ['both a stroke and a fill', '<rect width="2" height="2" fill="#FFFFFF" stroke="#FFFFFF"/>', /both stroked and filled/],
  ['no word on fill', '<polyline points="0,0 1,1" stroke="#FFFFFF"/>', /fill="none"/],
])('refuses %s rather than dropping it', (_what, inner, message) => {
  expect(() => parseGlyph(glyph(inner))).toThrow(message);
});

// Kept as a vector, so the accessibility magnifier enlarges a vector rather than a bitmap, and
// declared a template — which states what the image is for, though it is not what makes the
// bar tint it: expo-router and react-native-screens set the mode from the bar's `iconColor`
// (`NativeTabIcon` in src/navigation/tabs.ts; `tabs.test.ts` pins that colour on iOS).
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

// **Where the files land is the contract with Xcode and Gradle.** The tests above write into
// folders they choose; these run the mods the plugin actually registers, against a pretend
// prebuild, so a wrong path in them — a glyph written beside the asset catalog rather than in
// it, or outside `res/drawable` — fails here instead of as a tab with no glyph on a device.
describe('the registered prebuild mods', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tab-glyph-mods-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (platform, modRequest) =>
    withTabGlyphs({ name: 'Ponor', slug: 'ponor' }).mods[platform].dangerous({
      name: 'Ponor',
      slug: 'ponor',
      modRequest: { projectRoot: ROOT, platform, modName: 'dangerous', introspect: false, ...modRequest },
    });

  it('writes each glyph into the app target’s own asset catalog on iOS', async () => {
    await run('ios', { platformProjectRoot: path.join(dir, 'ios'), projectName: 'Ponor' });
    for (const { name } of TAB_GLYPHS) {
      const set = path.join(dir, 'ios', 'Ponor', 'Images.xcassets', `${name}.imageset`);
      expect(fs.existsSync(path.join(set, 'Contents.json'))).toBe(true);
      expect(fs.existsSync(path.join(set, `${name}.svg`))).toBe(true);
    }
  });

  it('stops the prebuild when the iOS project has no name to find its catalog by', async () => {
    await expect(run('ios', { platformProjectRoot: path.join(dir, 'ios') })).rejects.toThrow(/no name/);
    expect(fs.existsSync(path.join(dir, 'ios', 'Images.xcassets'))).toBe(false);
  });

  it('writes each glyph into the app module’s res/drawable on Android', async () => {
    await run('android', { platformProjectRoot: path.join(dir, 'android') });
    for (const { name } of TAB_GLYPHS) {
      expect(fs.existsSync(path.join(dir, 'android', 'app', 'src', 'main', 'res', 'drawable', `${name}.xml`))).toBe(true);
    }
  });
});
